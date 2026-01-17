/**
 * Core trajectory capture command.
 *
 * @remarks
 * Executes prompts against an ACP agent and captures full trajectories.
 * This is the foundational command - all other views derive from its output.
 *
 * Output format is always full trajectory JSONL (`CaptureResultSchema`).
 * Use `summarize` command to derive compact views.
 *
 * @packageDocumentation
 */

import { appendFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import type { SessionNotification, ToolCall } from '@agentclientprotocol/sdk'
import { createACPClient } from './acp-client.ts'
import { createPrompt } from './acp-helpers.ts'
import { DEFAULT_HARNESS_TIMEOUT, HEAD_LINES, TAIL_LINES } from './constants.ts'
import type { CaptureResult, Grader, PromptCase, TrajectoryStep } from './schemas.ts'
import { McpServerSchema, PromptCaseSchema, ToolInputSchema } from './schemas.ts'

// ============================================================================
// Types
// ============================================================================

/** Configuration for capture command */
export type CaptureConfig = {
  /** Path to prompts.jsonl file */
  promptsPath: string
  /** ACP agent command (e.g., ['bunx', 'claude-code-acp']) */
  agentCommand: string[]
  /** Output file path (undefined for stdout) */
  outputPath?: string
  /** Working directory for agent */
  cwd?: string
  /** Timeout per prompt in milliseconds */
  timeout?: number
  /** Show progress to stderr */
  progress?: boolean
  /** Append to output file instead of overwriting */
  append?: boolean
  /** MCP server configurations */
  mcpServers?: unknown[]
  /** Optional grader function */
  grader?: Grader
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

/** Extract trajectory from session notifications */
export const extractTrajectory = (notifications: SessionNotification[], startTime: number): TrajectoryStep[] => {
  const trajectory: TrajectoryStep[] = []
  const toolCallMap = new Map<string, { start: number; step: TrajectoryStep & { type: 'tool_call' } }>()

  for (const notification of notifications) {
    const timestamp = Date.now() - startTime
    const update = notification.update

    if (update.sessionUpdate === 'agent_thought_chunk' && update.content.type === 'text') {
      trajectory.push({
        type: 'thought',
        content: update.content.text,
        timestamp,
      })
    } else if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
      trajectory.push({
        type: 'message',
        content: update.content.text,
        timestamp,
      })
    } else if (update.sessionUpdate === 'tool_call') {
      const toolCall = update as ToolCall
      const existing = toolCallMap.get(toolCall.toolCallId)

      if (existing) {
        // Update existing tool call with completion info
        existing.step.status = toolCall.status ?? 'pending'
        if (toolCall.content) {
          existing.step.output = toolCall.content
        }
        if (toolCall.rawOutput) {
          existing.step.output = toolCall.rawOutput
        }
        existing.step.duration = timestamp - existing.start
      } else {
        // New tool call
        const step: TrajectoryStep & { type: 'tool_call' } = {
          type: 'tool_call',
          name: toolCall.title,
          status: toolCall.status ?? 'pending',
          input: toolCall.rawInput,
          timestamp,
        }
        toolCallMap.set(toolCall.toolCallId, { start: timestamp, step })
        trajectory.push(step)
      }
    } else if (update.sessionUpdate === 'plan') {
      trajectory.push({
        type: 'plan',
        entries: update.entries,
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

// ============================================================================
// Capture Implementation
// ============================================================================

/**
 * Execute capture with configuration object.
 *
 * @param config - Capture configuration
 * @returns Array of capture results
 */
export const runCapture = async (config: CaptureConfig): Promise<CaptureResult[]> => {
  const {
    promptsPath,
    agentCommand,
    outputPath,
    cwd,
    timeout = DEFAULT_HARNESS_TIMEOUT,
    progress = false,
    append = false,
    mcpServers = [],
    grader,
  } = config

  // Parse MCP server configurations
  const parsedMcpServers = mcpServers.map((s) => McpServerSchema.parse(s))

  // Load prompts
  const prompts = await loadPrompts(promptsPath)

  // Resolve output path
  const resolvedOutputPath = outputPath ? resolvePath(outputPath) : undefined

  // Log progress info
  logProgress(`Loaded ${prompts.length} prompts from ${promptsPath}`, progress)
  logProgress(`Command: ${agentCommand.join(' ')}`, progress)
  if (resolvedOutputPath) {
    logProgress(`Output: ${resolvedOutputPath}`, progress)
  }
  if (parsedMcpServers.length > 0) {
    logProgress(`MCP Servers: ${parsedMcpServers.map((s) => s.name).join(', ')}`, progress)
  }

  // Create ACP client
  const client = createACPClient({
    command: agentCommand,
    cwd,
    timeout,
  })

  // Clear output file if not appending
  if (resolvedOutputPath && !append) {
    await Bun.write(resolvedOutputPath, '')
  }

  // Session params with MCP servers
  const sessionParams = {
    cwd: cwd ?? process.cwd(),
    mcpServers: parsedMcpServers,
  }

  const results: CaptureResult[] = []
  let isFirstOutput = true

  try {
    logProgress('Connecting to agent...', progress)
    await client.connect()
    logProgress('Connected!', progress)

    // Create session with MCP servers
    const session = await client.createSession(sessionParams)
    logProgress(`Session: ${session.id}`, progress)

    // Run evaluations sequentially
    for (let i = 0; i < prompts.length; i++) {
      const promptCase = prompts[i]
      if (!promptCase) continue

      logProgress(`[${i + 1}/${prompts.length}] ${promptCase.id}: ${promptCase.input.slice(0, 50)}...`, progress)

      const startTime = Date.now()
      let result: CaptureResult

      try {
        const prompt = createPrompt(promptCase.input)
        const { updates } = await client.promptSync(session.id, prompt)

        const endTime = Date.now()
        const trajectory = extractTrajectory(updates, startTime)
        const output = extractOutput(trajectory)
        const toolErrors = hasToolErrors(trajectory)

        result = {
          id: promptCase.id,
          input: promptCase.input,
          output,
          ...(promptCase.expected && { expected: promptCase.expected }),
          trajectory,
          metadata: {
            ...promptCase.metadata,
            agent: agentCommand.join(' '),
          },
          timing: {
            start: startTime,
            end: endTime,
            firstResponse: trajectory.length > 0 ? trajectory[0]?.timestamp : undefined,
          },
          toolErrors,
        }

        // Apply grader if provided
        if (grader) {
          result.score = await grader({
            input: promptCase.input,
            output,
            expected: promptCase.expected,
            trajectory,
          })
        }
      } catch (error) {
        const endTime = Date.now()
        const message = error instanceof Error ? error.message : String(error)

        result = {
          id: promptCase.id,
          input: promptCase.input,
          output: '',
          trajectory: [],
          metadata: {
            ...promptCase.metadata,
            agent: agentCommand.join(' '),
          },
          timing: {
            start: startTime,
            end: endTime,
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
      logProgress(`  ${statusIcon} (${result.timing.end - result.timing.start}ms)`, progress)
    }
  } finally {
    logProgress('Disconnecting...', progress)
    await client.disconnect()
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
      output: { type: 'string', short: 'o' },
      cwd: { type: 'string', short: 'c' },
      timeout: { type: 'string', short: 't', default: String(DEFAULT_HARNESS_TIMEOUT) },
      progress: { type: 'boolean', default: false },
      append: { type: 'boolean', default: false },
      'mcp-server': { type: 'string', multiple: true },
      grader: { type: 'string', short: 'g' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  })

  if (values.help) {
    // biome-ignore lint/suspicious/noConsole: CLI help output
    console.log(`
Usage: acp-harness capture <prompts.jsonl> <command> [args...] [options]

Arguments:
  prompts.jsonl     Input file with evaluation prompts
  command [args]    ACP agent command to execute

Options:
  -o, --output      Output file (default: stdout)
  -c, --cwd         Working directory for agent
  -t, --timeout     Request timeout in ms (default: ${DEFAULT_HARNESS_TIMEOUT})
  --progress        Show progress to stderr
  --append          Append to output file instead of overwriting
  --mcp-server      MCP server config JSON (repeatable)
  -g, --grader      Path to grader module (exports 'grade' function)
  -h, --help        Show this help message

Output Format:
  Full trajectory JSONL with toolErrors indicator.
  Use 'acp-harness summarize' to derive compact views.

Examples:
  # Basic capture
  acp-harness capture prompts.jsonl bunx claude-code-acp -o results.jsonl

  # With grader
  acp-harness capture prompts.jsonl bunx claude-code-acp --grader ./grader.ts -o results.jsonl
`)
    return
  }

  const promptsPath = positionals[0]
  if (!promptsPath) {
    console.error('Error: prompts.jsonl path is required')
    process.exit(1)
  }

  const agentCommand = positionals.slice(1)
  if (agentCommand.length === 0) {
    console.error('Error: ACP agent command is required')
    console.error('Example: acp-harness capture prompts.jsonl bunx claude-code-acp')
    process.exit(1)
  }

  // Load grader if specified
  let grader: Grader | undefined
  if (values.grader) {
    const graderPath = resolvePath(values.grader)
    const graderModule = await import(graderPath)
    if (typeof graderModule.grade !== 'function') {
      console.error(`Error: Grader module must export a 'grade' function`)
      process.exit(1)
    }
    grader = graderModule.grade as Grader
  }

  // Parse MCP server configurations
  const mcpServers = (values['mcp-server'] ?? []).map((json) => JSON.parse(json))

  await runCapture({
    promptsPath,
    agentCommand,
    outputPath: values.output,
    cwd: values.cwd,
    timeout: Number.parseInt(values.timeout ?? String(DEFAULT_HARNESS_TIMEOUT), 10),
    progress: values.progress ?? false,
    append: values.append ?? false,
    mcpServers,
    grader,
  })
}
