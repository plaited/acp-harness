/**
 * Shared CLI utilities for the eval harness.
 *
 * @remarks
 * Implements the CLI tool pattern: JSON positional arg or stdin pipe,
 * `--schema input|output` for discovery, `--help` for usage, exit codes 0/1/2.
 *
 * @internal
 */

import * as z from 'zod'

// ============================================================================
// Raw Input Extraction (shared plumbing)
// ============================================================================

/**
 * Extract and parse raw JSON from CLI args or stdin.
 *
 * @remarks
 * Handles `--help`, `--schema`, positional JSON arg, and stdin pipe.
 * Calls `process.exit()` on meta flags and bad input — only returns
 * on valid JSON.
 *
 * @internal
 */
const parseRawCliInput = async (
  args: string[],
  schema: z.ZodSchema,
  options: { name: string; outputSchema?: z.ZodSchema },
): Promise<unknown> => {
  if (args.includes('--help') || args.includes('-h')) {
    console.error(`Usage: agent-eval-harness ${options.name} '<json>' | --schema input`)
    process.exit(0)
  }

  const schemaIdx = args.indexOf('--schema')
  if (schemaIdx !== -1) {
    const target = args[schemaIdx + 1]
    if (target === 'output' && options.outputSchema) {
      console.log(JSON.stringify(z.toJSONSchema(options.outputSchema), null, 2))
    } else {
      console.log(JSON.stringify(z.toJSONSchema(schema), null, 2))
    }
    process.exit(0)
  }

  const positionals = args.filter((arg) => !arg.startsWith('--'))
  let rawInput: string | undefined

  if (positionals.length > 0) {
    rawInput = positionals[0]
  } else if (!process.stdin.isTTY) {
    const stdinData = await Bun.stdin.text()
    if (stdinData.trim()) rawInput = stdinData.trim()
  }

  if (!rawInput) {
    console.error(`Usage: agent-eval-harness ${options.name} '<json>' | --schema input`)
    process.exit(2)
  }

  try {
    return JSON.parse(rawInput)
  } catch {
    console.error('Invalid JSON input')
    process.exit(2)
  }
}

// ============================================================================
// CLI Input Parser
// ============================================================================

/**
 * Parse CLI input following the CLI tool pattern.
 *
 * @remarks
 * - `--help` / `-h`: prints usage, exits 0
 * - `--schema input`: emits input JSON Schema, exits 0
 * - `--schema output`: emits output JSON Schema (if provided), exits 0
 * - First positional arg or stdin pipe: JSON validated with Zod
 * - Exit 2 on bad input
 *
 * @internal
 */
export const parseCli = async <T extends z.ZodSchema>(
  args: string[],
  schema: T,
  options: { name: string; outputSchema?: z.ZodSchema },
): Promise<z.infer<T>> => {
  const raw = await parseRawCliInput(args, schema, options)
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    console.error(JSON.stringify(parsed.error.issues, null, 2))
    process.exit(2)
  }
  return parsed.data
}
