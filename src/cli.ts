#!/usr/bin/env bun
import { trialCli } from './trial.ts'

const [command, ...args] = process.argv.slice(2)

switch (command) {
  case 'trials':
    await trialCli(args)
    break
  case 'compare':
    console.error('compare command not yet implemented')
    process.exit(1)
    break
  case 'calibrate':
    console.error('calibrate command not yet implemented')
    process.exit(1)
    break
  default:
    console.error(`Unknown command: ${command}`)
    console.error('Available commands: trials, compare, calibrate')
    process.exit(1)
}
