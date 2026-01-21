/**
 * ACP Client Integration Tests - Gemini CLI Adapter
 *
 * @remarks
 * These tests verify the ACP client works against Gemini CLI
 * via the `gemini --experimental-acp` adapter.
 *
 * **Run in Docker only** for consistent environment:
 * ```bash
 * GOOGLE_API_KEY=... bun test ./src/tests/acp-integration-gemini.docker.ts
 * ```
 *
 * Prerequisites:
 * 1. Docker installed
 * 2. API key: `GOOGLE_API_KEY` environment variable
 *
 * These tests make real API calls and consume credits.
 */

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { type ACPClient, createACPClient } from '../acp-client.ts'
import { createPrompt, summarizeResponse } from '../acp-helpers.ts'

// Long timeout for real agent interactions (2 minutes)
setDefaultTimeout(120000)

// Fixtures directory with .claude/skills and .mcp.json
const FIXTURES_DIR = `${import.meta.dir}/fixtures`

describe('ACP Client Integration - Gemini', () => {
  let client: ACPClient

  beforeAll(async () => {
    // Gemini CLI adapter expects GOOGLE_API_KEY
    client = createACPClient({
      command: ['bunx', '@google/gemini-cli', '--experimental-acp'],
      timeout: 120000, // 2 min timeout for initialization
      env: {
        GOOGLE_API_KEY: process.env.GOOGLE_API_KEY ?? '',
      },
    })

    await client.connect()
  })

  afterAll(async () => {
    await client?.disconnect()
  })

  test('connects and initializes', () => {
    expect(client.isConnected()).toBe(true)

    const initResult = client.getInitializeResult()
    expect(initResult).toBeDefined()
    expect(initResult?.protocolVersion).toBeDefined()
  })

  test('reports agent capabilities', () => {
    const capabilities = client.getCapabilities()
    expect(capabilities).toBeDefined()
  })

  test('creates session', async () => {
    const session = await client.createSession({
      cwd: FIXTURES_DIR,
      mcpServers: [],
    })

    expect(session).toBeDefined()
    expect(session.id).toBeDefined()
    expect(typeof session.id).toBe('string')
  })

  test('sends prompt and receives response', async () => {
    const session = await client.createSession({
      cwd: FIXTURES_DIR,
      mcpServers: [],
    })

    // Simple prompt that doesn't require tools
    const { result, updates } = await client.promptSync(
      session.id,
      createPrompt('What is 2 + 2? Reply with just the number.'),
    )

    expect(result).toBeDefined()
    expect(updates).toBeInstanceOf(Array)

    // Summarize and verify response structure
    const summary = summarizeResponse(updates)
    expect(summary.text).toBeDefined()
    expect(summary.text.length).toBeGreaterThan(0)
    // Should contain "4" somewhere in the response
    expect(summary.text).toMatch(/4/)
  })

  test('streaming prompt yields updates', async () => {
    const session = await client.createSession({
      cwd: FIXTURES_DIR,
      mcpServers: [],
    })

    const events: string[] = []

    for await (const event of client.prompt(session.id, createPrompt('Say "hello" and nothing else.'))) {
      events.push(event.type)
      if (event.type === 'complete') {
        expect(event.result).toBeDefined()
      }
    }

    expect(events).toContain('complete')
  })

  test('handles tool usage prompt', async () => {
    const session = await client.createSession({
      cwd: FIXTURES_DIR,
      mcpServers: [],
    })

    // Prompt that should trigger tool usage - reading a specific file
    const { updates } = await client.promptSync(
      session.id,
      createPrompt('Use the Read tool to read calculator-mcp.ts and tell me what tools the MCP server provides.'),
    )

    const summary = summarizeResponse(updates)

    // Verify response mentions calculator tools
    expect(summary.text.length).toBeGreaterThan(0)
    // Response should mention the calculator tools (add, subtract, etc.)
    expect(summary.text.toLowerCase()).toMatch(/add|subtract|multiply|divide|calculator/)
  })
})
