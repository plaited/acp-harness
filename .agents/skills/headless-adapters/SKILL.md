---
name: headless-adapters
description: Discover, create, and validate headless adapters for agent integration. Includes scaffolding tools and schema-driven compliance testing.
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

1. **Create a schema** for your CLI agent using the [Schema Creation Guide](references/schema-creation-guide.md)
2. **Run the adapter:**
   ```bash
   bunx @plaited/agent-eval-harness headless --schema ./my-agent-headless.json
   ```

Any CLI agent that outputs JSON can be wrapped — no agent-specific code required.

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
    },
    {
      "match": { "path": "$.type", "value": "tool_use" },
      "emitAs": "tool_call",
      "extract": { "title": "$.name", "status": "'pending'", "input": "$.input" }
    },
    {
      "match": { "path": "$.type", "value": "tool_result" },
      "emitAs": "tool_call",
      "extract": { "title": "$.name", "status": "'completed'", "output": "$.content" }
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

## Creating a Schema

1. Run the CLI's `--help` to identify prompt, output format, and auto-approve flags
2. Capture sample JSON output from the CLI
3. Map JSONPath patterns to output events (including `input`/`output` for tool calls)
4. Create the schema file
5. Test with `headless` command

See [Schema Creation Guide](references/schema-creation-guide.md) for the complete workflow.

## Security Considerations

### Trust Boundary: CLI Output is Untrusted

The headless adapter parses JSON output from CLI agents. This output may contain content from **external sources** (web searches, file reads, API responses) that flows into trajectory data:

```
CLI Agent → JSON stdout → JSONPath extraction → ParsedUpdate → TrajectoryStep
```

Trajectory fields — especially `tool_call.input` and `tool_call.output` — should be treated as **untrusted content** by downstream consumers (graders, LLM-as-judge, analysis scripts). Do not:
- Execute trajectory content as code
- Use trajectory content in unsanitized shell commands
- Pass trajectory content to LLMs without injection-aware prompting

### autoApprove Flags

The `autoApprove` field bypasses the CLI agent's safety confirmation prompts. Use the **least permissive** flags your evaluation requires:

| Risk Level | Example | When to Use |
|------------|---------|-------------|
| **High** | `["--dangerously-skip-permissions"]` | Only in isolated containers (Docker, CI) |
| **Medium** | `["--allowedTools", "Read,Write,Glob"]` | Scoped to specific tools |
| **Low** | `["--auto-approve", "read-only"]` | Read-only evaluations |

**Never run high-risk autoApprove flags outside isolated environments.** Use `--workspace-dir` or Docker for evaluations that modify the filesystem.

## Troubleshooting

### Common Issues

| Issue | Likely Cause | Solution |
|-------|--------------|----------|
| Tool calls not captured | JSONPath not iterating arrays | Use `[*]` wildcard syntax - [see guide](references/troubleshooting-guide.md#tool-calls-not-appearing) |
| Tool input/output missing | Extract config missing `input`/`output` fields | Add `input`/`output` paths - [see guide](references/troubleshooting-guide.md#tool-input-output-missing) |
| "unexpected argument" error | Stdin mode misconfigured | Use `stdin: true` - [see guide](references/troubleshooting-guide.md#stdin-mode-issues) |
| 401 Authentication errors | API key not properly configured | Set the correct API key environment variable for your agent |
| Timeout on prompt | JSONPath not matching | Capture raw CLI output, verify paths - [see guide](references/troubleshooting-guide.md#jsonpath-debugging) |
| Empty responses | Content extraction failing | Check extract paths - [see guide](references/troubleshooting-guide.md#output-event-matching) |

**Complete troubleshooting documentation:** [Troubleshooting Guide](references/troubleshooting-guide.md)

## External Resources

- **AgentSkills Spec**: [agentskills.io](https://agentskills.io)

## Related

- **[agent-eval-harness skill](../agent-eval-harness/SKILL.md)** - Running evaluations against adapters
