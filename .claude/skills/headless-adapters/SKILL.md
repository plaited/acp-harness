---
name: headless-adapters
description: Discover, create, and validate headless adapters for agent integration. Includes scaffolding tools and compliance testing for the Agent Client Protocol.
compatibility: Bun >= 1.2.9
---

# Headless Adapters

## Purpose

Schema-driven adapter for headless CLI agents. **No code required** - just define a JSON schema describing how to interact with the CLI.

| Use Case | Tool |
|----------|------|
| Wrap headless CLI agent | `headless` command |
| Create new schemas | [Schema Creation Guide](references/schema-creation-guide.md) |

## Quick Start

1. **Check if a schema exists** in [schemas/](schemas/)
2. **Run the adapter:**
   ```bash
   ANTHROPIC_API_KEY=... bunx @plaited/agent-eval-harness headless --schema .claude/skills/headless-adapters/schemas/claude-headless.json
   ```

## CLI Commands

### headless

Schema-driven adapter for ANY headless CLI agent.

```bash
bunx @plaited/agent-eval-harness headless --schema <path>
```

**Options:**
| Flag | Description | Required |
|------|-------------|----------|
| `-s, --schema` | Path to adapter schema (JSON) | Yes |

**Schema Format:**

```json
{
  "version": 1,
  "name": "my-agent",
  "command": ["my-agent-cli"],
  "sessionMode": "stream",
  "prompt": { "flag": "-p" },
  "output": { "flag": "--output-format", "value": "stream-json" },
  "autoApprove": ["--allow-all"],
  "outputEvents": [
    {
      "match": { "path": "$.type", "value": "message" },
      "emitAs": "message",
      "extract": { "content": "$.text" }
    }
  ],
  "result": {
    "matchPath": "$.type",
    "matchValue": "result",
    "contentPath": "$.content"
  }
}
```

**Session Modes:**

| Mode | Description | Use When |
|------|-------------|----------|
| `stream` | Keep process alive, multi-turn via stdin | CLI supports session resume |
| `iterative` | New process per turn, accumulate history | CLI is stateless |

**Multi-turn Conversations:**

Both modes support multi-turn conversations. Send multiple prompts to the same session:

```typescript
// Create one session, send multiple prompts
const session = await manager.createSession({ cwd: PROJECT_ROOT })

// Turn 1
const turn1 = await manager.prompt(session.id, 'Remember: 42')

// Turn 2 - context is maintained
const turn2 = await manager.prompt(session.id, 'What number?')
```

How context is preserved:
- **stream mode:** Process stays alive, CLI maintains internal state
- **iterative mode:** Adapter builds history using `historyTemplate` from schema

## Pre-built Schemas

Tested schemas are available in [schemas/](schemas/):

| Schema | Agent | Mode | Auth Env Var | Status |
|--------|-------|------|--------------|--------|
| `claude-headless.json` | Claude Code | stream | `ANTHROPIC_API_KEY` | Tested |
| `gemini-headless.json` | Gemini CLI | iterative | `GEMINI_API_KEY` | Tested |

**Usage:**
```bash
# Claude Code
ANTHROPIC_API_KEY=... bunx @plaited/agent-eval-harness headless --schema .claude/skills/headless-adapters/schemas/claude-headless.json

# Gemini CLI
GEMINI_API_KEY=... bunx @plaited/agent-eval-harness headless --schema .claude/skills/headless-adapters/schemas/gemini-headless.json
```

## Agents with Headless CLI Support

> **7 of 8 agents compatible.** The headless adapter requires JSON streaming output from the CLI.

| Agent | JSON Output Flag | Prompt Flag | CLI Documentation |
|-------|------------------|-------------|-------------------|
| Amp | `--stream-json` | `-x` | [ampcode.com/manual#cli](https://ampcode.com/manual#cli) |
| Codex | `--json` | positional | [developers.openai.com/codex/cli](https://developers.openai.com/codex/cli/) |
| Cursor | `--output-format stream-json --print` | `-p` | [cursor.com/docs/cli/reference/output-format](https://cursor.com/docs/cli/reference/output-format) |
| Droid | `-o stream-json` | positional | [docs.factory.ai/cli/droid-exec/overview](https://docs.factory.ai/cli/droid-exec/overview) |
| Goose | `--output-format stream-json` | `-t` | [block.github.io/goose/.../goose-cli-commands](https://block.github.io/goose/docs/guides/goose-cli-commands/) |
| Letta | `--output-format stream-json` | `-p` | [docs.letta.com/letta-code/cli-reference](https://docs.letta.com/letta-code/cli-reference/) |
| OpenCode | `--format json` | positional | [opencode.ai/docs/cli](https://opencode.ai/docs/cli/) |

**Not yet compatible:** [Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli) (no JSON output)

## Creating a Schema

1. Explore the CLI's `--help` to identify prompt, output, and auto-approve flags
2. Capture sample JSON output from the CLI
3. Map JSONPath patterns to output events
4. Create schema file based on an existing template
5. Test with `headless` command

See [Schema Creation Guide](references/schema-creation-guide.md) for the complete workflow.

## Troubleshooting

### Common Issues

| Issue | Likely Cause | Solution |
|-------|--------------|----------|
| Tool calls not captured | JSONPath not iterating arrays | Use `[*]` wildcard syntax - [see guide](references/troubleshooting-guide.md#tool-calls-not-appearing) |
| "unexpected argument" error | Stdin mode misconfigured | Use `stdin: true` - [see guide](references/troubleshooting-guide.md#stdin-mode-issues) |
| 401 Authentication errors | API key not properly configured | Check auth flow - [see guide](references/troubleshooting-guide.md#authentication-and-api-keys) |
| Timeout on prompt | JSONPath not matching | Capture raw CLI output, verify paths - [see guide](references/troubleshooting-guide.md#jsonpath-debugging) |
| Empty responses | Content extraction failing | Check extract paths - [see guide](references/troubleshooting-guide.md#output-event-matching) |

**Complete troubleshooting documentation:** [Troubleshooting Guide](references/troubleshooting-guide.md)

This guide includes:
- Detailed debugging steps for each issue
- Real examples from production debugging sessions
- JSONPath testing techniques
- Authentication patterns for different CLIs
- Common schema patterns and anti-patterns

### Quick Debug Steps

1. **Verify CLI works standalone:**
   ```bash
   <agent> -p "Say hello" --output-format stream-json --verbose 2>&1 | head -10
   ```

2. **Test headless adapter directly:**
   ```bash
   bunx @plaited/agent-eval-harness headless --schema ./my-schema.json -p "Hello"
   ```

## External Resources

- **AgentSkills Spec**: [agentskills.io](https://agentskills.io)

## Related

- **[agent-eval-harness skill](../agent-eval-harness/SKILL.md)** - Running evaluations against adapters
