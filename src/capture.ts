/**
 * Core trajectory capture command.
 *
 * @remarks
 * Executes prompts against a CLI agent and captures full trajectories.
 * This is the foundational command - all other views derive from its output.
 *
 * Output format is always full trajectory JSONL (`CaptureResultSchema`).
 * Use `summarize` command to derive compact views.
 *
 * @packageDocumentation
 */

import { appendFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { DEFAULT_HARNESS_TIMEOUT, HEAD_LINES, TAIL_LINES } from './constants.ts'
import { loadGrader } from './grader-loader.ts'
import { type HeadlessAdapterConfig, parseHeadlessConfig } from './headless.schemas.ts'
import type { ParsedUpdate } from './headless-output-parser.ts'
import { createSessionManager, type ProcessExitInfo, type PromptResult } from './headless-session-manager.ts'
import type { CaptureResult, Grader, PromptCase, TrajectoryRichness, TrajectoryStep } from './schemas.ts'
import { PromptCaseSchema, ToolInputSchema } from './schemas.ts'

// ============================================================================
// Types
// ============================================================================

/** Configuration for capture command */
export type CaptureConfig = {
  /** Path to prompts.jsonl file */
  promptsPath: string
  /** Path to agent schema JSON file */
  schemaPath: string
  /** Output file path (undefined for stdout) */
  outputPath?: string
  /** Working directory for agent */
  cwd?: string
  /** Timeout per prompt in milliseconds (overrides schema default) */
  timeout?: number
  /** Show progress to stderr */
  progress?: boolean
  /** Append to output file instead of overwriting */
  append?: boolean
  /** Optional grader function */
  grader?: Grader
  /** Enable debug mode for detailed output */
  debug?: boolean
}

// ============================================================================
// Helpers
// ============================================================================

/** Load prompts from JSONL file */
export const loadPrompts = async (path: string): Promise<PromptCase[]> => {
  const content = await Bun.file(path).text()
  return content
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try {
        return PromptCaseSchema.parse(JSON.parse(line))
      } catch (error) {
        throw new Error(`Invalid prompt at line ${index + 1}: ${error instanceof Error ? error.message : error}`)
      }
    })
}

/** Extract trajectory from parsed updates */
export const extractTrajectory = (updates: ParsedUpdate[], startTime: number): TrajectoryStep[] => {
  const trajectory: TrajectoryStep[] = []
  const toolCallMap = new Map<string, { start: number; step: TrajectoryStep & { type: 'tool_call' } }>()

  for (const update of updates) {
    const timestamp = Date.now() - startTime

    if (update.type === 'thought') {
      trajectory.push({
        type: 'thought',
        content: update.content ?? '',
        timestamp,
      })
    } else if (update.type === 'message') {
      trajectory.push({
        type: 'message',
        content: update.content ?? '',
        timestamp,
      })
    } else if (update.type === 'tool_call') {
      const toolCallId = update.title ?? `tool_${Date.now()}`
      const existing = toolCallMap.get(toolCallId)

      if (existing && update.status === 'completed') {
        // Update existing tool call with completion info
        existing.step.status = update.status
        existing.step.duration = timestamp - existing.start
      } else if (!existing) {
        // New tool call
        const step: TrajectoryStep & { type: 'tool_call' } = {
          type: 'tool_call',
          name: update.title ?? 'unknown',
          status: update.status ?? 'pending',
          timestamp,
        }
        toolCallMap.set(toolCallId, { start: timestamp, step })
        trajectory.push(step)
      }
    } else if (update.type === 'plan') {
      trajectory.push({
        type: 'plan',
        entries: [],
        timestamp,
      })
    }
  }

  return trajectory
}

/** Extract final text output from trajectory */
export const extractOutput = (trajectory: TrajectoryStep[]): string => {
  return trajectory
    .filter((step): step is TrajectoryStep & { type: 'message' } => step.type === 'message')
    .map((step) => step.content)
    .join('\n')
}

/** Check if any tool calls failed */
export const hasToolErrors = (trajectory: TrajectoryStep[]): boolean => {
  return trajectory.some((step) => step.type === 'tool_call' && step.status === 'failed')
}

/** Head/tail preview of content */
export const headTailPreview = (content: string, headLines = HEAD_LINES, tailLines = TAIL_LINES): string => {
  const lines = content.split('\n')
  if (lines.length <= headLines + tailLines) {
    return content
  }
  const head = lines.slice(0, headLines).join('\n')
  const tail = lines.slice(-tailLines).join('\n')
  const omitted = lines.length - headLines - tailLines
  return `${head}\n\n// ... ${omitted} lines omitted ...\n\n${tail}`
}

/** Extract file path from tool input if present */
export const extractFilePath = (input: unknown): string | undefined => {
  const result = ToolInputSchema.safeParse(input)
  if (!result.success) return undefined
  return result.data.file_path ?? result.data.path
}

/** Extract content from tool input if present */
export const extractContent = (input: unknown): string | undefined => {
  const result = ToolInputSchema.safeParse(input)
  if (!result.success) return undefined
  return result.data.content ?? result.data.new_string
}

/** Write output line (to stdout or file) */
const writeOutput = async (line: string, outputPath?: string, append?: boolean): Promise<void> => {
  if (outputPath) {
    if (append) {
      await appendFile(outputPath, `${line}\n`)
    } else {
      await Bun.write(outputPath, `${line}\n`)
    }
  } else {
    // biome-ignore lint/suspicious/noConsole: CLI stdout output
    console.log(line)
  }
}

/** Log progress to stderr (doesn't pollute stdout) */
const logProgress = (message: string, showProgress: boolean): void => {
  if (showProgress) {
    console.error(message)
  }
}

/** Resolve path relative to process.cwd() */
const resolvePath = (path: string): string => {
  if (path.startsWith('/')) return path
  return `${process.cwd()}/${path}`
}

/**
 * Detect trajectory richness level from captured steps.
 *
 * @remarks
 * Different adapters provide varying levels of detail:
 * - `full`: Has thoughts, tool calls, or plans (e.g., Claude Code)
 * - `messages-only`: Only message steps present
 * - `minimal`: Empty or unknown content
 *
 * Uses single-pass iteration with early exit for efficiency.
 */
export const detectTrajectoryRichness = (trajectory: TrajectoryStep[]): TrajectoryRichness => {
  let hasMessages = false

  for (const step of trajectory) {
    // Early exit: any of these means 'full' richness
    if (step.type === 'thought' || step.type === 'tool_call' || step.type === 'plan') {
      return 'full'
    }
    if (step.type === 'message') {
      hasMessages = true
    }
  }

  return hasMessages ? 'messages-only' : 'minimal'
}

/** Get preview text for input (handles string or array) */
const getInputPreview = (input: string | string[]): string => {
  if (Array.isArray(input)) {
    const first = input[0] ?? ''
    return `[${input.length} turns] ${first.slice(0, 40)}...`
  }
  return input.slice(0, 50)
}

// ============================================================================
// Capture Implementation
// ============================================================================

/**
 * Execute capture with configuration object.
 *
 * @remarks
 * Creates a fresh session for each JSONL entry to ensure isolation.
 * Supports multi-turn conversations via `input: string[]`.
 *
 * @param config - Capture configuration
 * @returns Array of capture results
 */
export const runCapture = async (config: CaptureConfig): Promise<CaptureResult[]> => {
  const {
    promptsPath,
    schemaPath,
    outputPath,
    cwd,
    timeout,
    progress = false,
    append = false,
    grader,
    debug = false,
  } = config

  // Load and validate schema
  const schemaFile = Bun.file(schemaPath)
  if (!(await schemaFile.exists())) {
    throw new Error(`Schema file not found: ${schemaPath}`)
  }

  let schema: HeadlessAdapterConfig
  try {
    const rawSchema = await schemaFile.json()
    schema = parseHeadlessConfig(rawSchema)
  } catch (error) {
    throw new Error(`Invalid schema: ${error instanceof Error ? error.message : String(error)}`)
  }

  // Load prompts
  const prompts = await loadPrompts(promptsPath)

  // Resolve output path
  const resolvedOutputPath = outputPath ? resolvePath(outputPath) : undefined

  // Determine effective timeout (CLI flag > schema default > harness default)
  const schemaTimeout = 'timeout' in schema ? schema.timeout : undefined
  const effectiveTimeout = timeout ?? schemaTimeout ?? DEFAULT_HARNESS_TIMEOUT

  // Log progress info
  logProgress(`Loaded ${prompts.length} prompts from ${promptsPath}`, progress)
  logProgress(`Schema: ${schema.name} (${schemaPath})`, progress)
  logProgress(`Timeout: ${effectiveTimeout}ms`, progress)
  if (resolvedOutputPath) {
    logProgress(`Output: ${resolvedOutputPath}`, progress)
  }
  if (debug) {
    logProgress(`Debug mode: enabled`, progress)
  }

  // Create session manager with schema
  const sessions = createSessionManager({
    schema,
    timeout: effectiveTimeout,
    verbose: progress,
    debug,
  })

  // Clear output file if not appending
  if (resolvedOutputPath && !append) {
    await Bun.write(resolvedOutputPath, '')
  }

  const workingDir = cwd ?? process.cwd()
  const results: CaptureResult[] = []
  let isFirstOutput = true

  // Run evaluations sequentially - fresh session per entry
  for (let i = 0; i < prompts.length; i++) {
    const promptCase = prompts[i]
    if (!promptCase) continue

    logProgress(`[${i + 1}/${prompts.length}] ${promptCase.id}: ${getInputPreview(promptCase.input)}...`, progress)

    const startTime = Date.now()
    let result: CaptureResult

    try {
      // Create fresh session for each entry (ensures isolation)
      const sessionStart = Date.now()
      const session = await sessions.create(workingDir)
      const sessionCreation = Date.now() - sessionStart
      logProgress(`  Session: ${session.id}`, progress)

      // Handle string or array input
      const inputs = Array.isArray(promptCase.input) ? promptCase.input : [promptCase.input]
      const turnCount = inputs.length

      // Collect all updates from all turns
      const allUpdates: ParsedUpdate[] = []
      let lastExitInfo: ProcessExitInfo | undefined
      let lastOutput = ''

      // TODO: Per-prompt timeout from promptCase.timeout is documented but not yet implemented
      // The session manager would need to accept timeout per-call to support this

      // Execute each turn sequentially in the same session
      for (const turnInput of inputs) {
        const turnResult: PromptResult = await sessions.prompt(session.id, turnInput)
        allUpdates.push(...turnResult.updates)
        lastExitInfo = turnResult.exitInfo
        lastOutput = turnResult.output
      }

      const endTime = Date.now()
      const trajectory = extractTrajectory(allUpdates, startTime)

      // Use last turn's output or extract from trajectory
      const output = lastOutput || extractOutput(trajectory)
      const toolErrors = hasToolErrors(trajectory) || (lastExitInfo?.timedOut ?? false)
      const trajectoryRichness = detectTrajectoryRichness(trajectory)

      result = {
        id: promptCase.id,
        input: promptCase.input, // Preserve original (string or array)
        output,
        ...(promptCase.hint && { hint: promptCase.hint }),
        trajectory,
        metadata: {
          ...promptCase.metadata,
          agent: schema.name,
          trajectoryRichness,
          turnCount,
          ...(lastExitInfo && {
            exitCode: lastExitInfo.exitCode,
            signal: lastExitInfo.signal,
            timedOut: lastExitInfo.timedOut,
          }),
        },
        timing: {
          start: startTime,
          end: endTime,
          firstResponse: trajectory.length > 0 ? trajectory[0]?.timestamp : undefined,
          sessionCreation,
          total: endTime - startTime,
        },
        toolErrors,
      }

      // Apply grader if provided
      if (grader) {
        result.score = await grader({
          input: promptCase.input,
          output,
          hint: promptCase.hint,
          trajectory,
        })
      }

      // Clean up session
      sessions.destroy(session.id)
    } catch (error) {
      const endTime = Date.now()
      const message = error instanceof Error ? error.message : String(error)
      const inputs = Array.isArray(promptCase.input) ? promptCase.input : [promptCase.input]

      result = {
        id: promptCase.id,
        input: promptCase.input,
        output: '',
        trajectory: [],
        metadata: {
          ...promptCase.metadata,
          agent: schema.name,
          trajectoryRichness: 'minimal' as TrajectoryRichness,
          turnCount: inputs.length,
        },
        timing: {
          start: startTime,
          end: endTime,
          sessionCreation: 0,
          total: endTime - startTime,
        },
        toolErrors: true,
        errors: [message],
      }
    }

    results.push(result)

    // Write result immediately
    const formatted = JSON.stringify(result)
    await writeOutput(formatted, resolvedOutputPath, !isFirstOutput)
    isFirstOutput = false

    const statusIcon = result.toolErrors ? '!' : '✓'
    const exitInfo = result.metadata?.timedOut
      ? ' - TIMEOUT'
      : result.metadata?.exitCode && result.metadata.exitCode !== 0
        ? ` - exit ${result.metadata.exitCode}`
        : ''
    logProgress(`  ${statusIcon} (${result.timing.total}ms)${exitInfo}`, progress)
  }

  logProgress('Done!', progress)
  return results
}

// ============================================================================
// CLI Entry Point
// ============================================================================

/**
 * Capture command CLI handler.
 *
 * @param args - Command line arguments (after 'capture')
 */
export const capture = async (args: string[]): Promise<void> => {
  const { values, positionals } = parseArgs({
    args,
    options: {
      schema: { type: 'string', short: 's' },
      output: { type: 'string', short: 'o' },
      cwd: { type: 'string', short: 'c' },
      timeout: { type: 'string', short: 't' },
      progress: { type: 'boolean', default: false },
      append: { type: 'boolean', default: false },
      grader: { type: 'string', short: 'g' },
      debug: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  })

  if (values.help) {
    // biome-ignore lint/suspicious/noConsole: CLI help output
    console.log(`
Usage: agent-eval-harness capture <prompts.jsonl> --schema <schema.json> [options]

Arguments:
  prompts.jsonl     Input file with evaluation prompts

Options:
  -s, --schema      Path to agent schema JSON file (required)
  -o, --output      Output file (default: stdout)
  -c, --cwd         Working directory for agent
  -t, --timeout     Request timeout in ms (overrides schema default)
  --progress        Show progress to stderr
  --append          Append to output file instead of overwriting
  -g, --grader      Path to grader (.ts/.js module or executable script)
  --debug           Enable debug mode (shows raw output, JSONPath matching)
  -h, --help        Show this help message

Output Format:
  Full trajectory JSONL with toolErrors indicator.
  Use 'agent-eval-harness summarize' to derive compact views.

Exit Info (in metadata):
  exitCode      Process exit code (null if killed/timed out)
  signal        Signal that killed process (if any)
  timedOut      true if process was killed due to timeout

Graders:
  TS/JS modules must export a 'grade' function.
  Executable scripts (Python, etc.) use stdin/stdout JSON protocol.

Examples:
  # Basic capture with schema
  agent-eval-harness capture prompts.jsonl --schema claude.json -o results.jsonl

  # With TypeScript grader
  agent-eval-harness capture prompts.jsonl -s claude.json --grader ./grader.ts -o results.jsonl

  # With debug mode
  agent-eval-harness capture prompts.jsonl -s claude.json --debug -o results.jsonl

  # With per-prompt timeout override (in prompts.jsonl):
  {"id": "slow-task", "input": "...", "timeout": 180000}
`)
    return
  }

  const promptsPath = positionals[0]
  if (!promptsPath) {
    console.error('Error: prompts.jsonl path is required')
    process.exit(1)
  }

  if (!values.schema) {
    console.error('Error: --schema is required')
    console.error('Example: agent-eval-harness capture prompts.jsonl --schema ./claude.json')
    process.exit(1)
  }

  // Load grader if specified
  let grader: Grader | undefined
  if (values.grader) {
    try {
      grader = await loadGrader(values.grader)
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : error}`)
      process.exit(1)
    }
  }

  await runCapture({
    promptsPath,
    schemaPath: values.schema,
    outputPath: values.output,
    cwd: values.cwd,
    timeout: values.timeout ? Number.parseInt(values.timeout, 10) : undefined,
    progress: values.progress ?? false,
    append: values.append ?? false,
    grader,
    debug: values.debug ?? false,
  })
}
