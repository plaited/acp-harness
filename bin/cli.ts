#!/usr/bin/env bun

/**
 * Agent Eval Harness CLI - Agent evaluation toolkit.
 *
 * @remarks
 * Router for harness commands. Thin wrapper that delegates to command modules.
 *
 * Commands:
 * - capture: Core trajectory capture
 * - trials: Multi-run pass@k/pass^k analysis
 * - summarize: Derive compact views from results
 * - calibrate: Sample failures for grader review
 * - validate-refs: Check reference solutions
 * - balance: Analyze test set coverage
 * - schemas: Export JSON schemas for non-TS users
 * - headless: Schema-driven adapter for any headless CLI agent
 */

import { balance } from '../src/balance.ts'
import { calibrate } from '../src/calibrate.ts'
import { capture } from '../src/capture.ts'
import { headless } from '../src/headless.ts'
import { schemasCli } from '../src/schemas-cli.ts'
import { summarize } from '../src/summarize.ts'
import { trials } from '../src/trials.ts'
import { validateRefs } from '../src/validate-refs.ts'

const [command, ...args] = Bun.argv.slice(2)

const printHelp = () => {
  // biome-ignore lint/suspicious/noConsole: CLI help output
  console.log(`
agent-eval-harness - CLI tool for agent evaluation

Commands:
  capture          Capture trajectories from CLI agents
  trials           Run prompts multiple times for pass@k/pass^k metrics
  summarize        Derive compact views from results
  calibrate        Sample failures for grader review
  validate-refs    Check reference solutions against grader
  balance          Analyze test set coverage
  schemas          Export JSON schemas for non-TypeScript users
  headless         Schema-driven adapter for any headless CLI agent

Run 'agent-eval-harness <command> --help' for command-specific help.

Examples:
  # Basic capture with schema
  agent-eval-harness capture prompts.jsonl --schema claude.json -o results.jsonl

  # With grader
  agent-eval-harness capture prompts.jsonl -s claude.json --grader ./grader.ts -o results.jsonl

  # Multi-run trials
  agent-eval-harness trials prompts.jsonl -s claude.json -k 5 --grader ./grader.ts -o trials.jsonl

  # Derive summary view
  agent-eval-harness summarize results.jsonl -o summary.jsonl

  # Export schemas
  agent-eval-harness schemas --json -o schemas.json

  # Run headless adapter with schema
  agent-eval-harness headless --schema ./claude-headless.json

Documentation: https://github.com/plaited/acp-harness
`)
}

const main = async () => {
  switch (command) {
    case 'capture':
      await capture(args)
      break

    case 'trials':
      await trials(args)
      break

    case 'summarize':
      await summarize(args)
      break

    case 'calibrate':
      await calibrate(args)
      break

    case 'validate-refs':
      await validateRefs(args)
      break

    case 'balance':
      await balance(args)
      break

    case 'schemas':
      await schemasCli(args)
      break

    case 'headless':
      await headless(args)
      break

    case '-h':
    case '--help':
    case undefined:
      printHelp()
      break

    case '-v':
    case '--version': {
      const { version } = await import('../package.json')
      // biome-ignore lint/suspicious/noConsole: CLI version output
      console.log(version)
      break
    }

    default:
      console.error(`Unknown command: ${command}`)
      console.error("Run 'agent-eval-harness --help' for usage")
      process.exit(1)
  }
}

main().catch((error) => {
  console.error('Error:', error instanceof Error ? error.message : error)
  process.exit(1)
})
