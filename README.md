# @plaited/acp-harness

[![npm version](https://img.shields.io/npm/v/@plaited/acp-harness.svg)](https://www.npmjs.com/package/@plaited/acp-harness)
[![CI](https://github.com/plaited/acp-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/plaited/acp-harness/actions/workflows/ci.yml)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

CLI tool for capturing agent trajectories from ACP-compatible agents. Execute prompts, capture full trajectories (tools, thoughts, plans), and output structured JSONL for downstream scoring.

## Quick Start

```bash
# Run without installing
bunx @plaited/acp-harness capture prompts.jsonl bunx claude-code-acp -o results.jsonl

# Or install globally
bun add -g @plaited/acp-harness
acp-harness capture prompts.jsonl bunx claude-code-acp -o results.jsonl
```

**Prerequisite:** Install an ACP adapter and set your API key:

```bash
npm install -g @anthropic-ai/claude-code-acp
export ANTHROPIC_API_KEY=sk-...
```

## Commands

| Command | Purpose |
|---------|---------|
| `capture` | Trajectory capture (full JSONL) |
| `trials` | Multi-run with pass@k metrics |
| `summarize` | Derive compact views from results |
| `calibrate` | Sample failures for review |
| `validate-refs` | Check reference solutions |
| `balance` | Analyze test set coverage |
| `schemas` | Export JSON schemas |

### capture

Capture full trajectories from an ACP agent:

```bash
acp-harness capture <prompts.jsonl> <command> [args...] [options]

Options:
  -o, --output      Output file (default: stdout)
  -c, --cwd         Working directory for agent
  -t, --timeout     Request timeout in ms (default: 60000)
  -g, --grader      Path to grader (.ts/.js module or executable script)
  --progress        Show progress to stderr
  --append          Append to output file
  --mcp-server      MCP server config JSON (repeatable)
  -h, --help        Show help
```

### trials

Run multiple trials per prompt for pass@k analysis:

```bash
acp-harness trials <prompts.jsonl> <command> [args...] [options]

Options:
  -k                Number of trials per prompt (default: 3)
  -g, --grader      Path to grader (computes pass@k/pass^k metrics)
  ...               (same as capture)
```

## Input Format

```jsonl
{"id":"test-001","input":"Create a primary button","expected":"should contain <button>","metadata":{"category":"ui"}}
{"id":"test-002","input":"Fix the TypeScript error","metadata":{"category":"bugfix"}}
```

## Output Format

The harness outputs full trajectory JSONL (`CaptureResult` schema):

```jsonl
{
  "id": "test-001",
  "input": "Create a primary button",
  "output": "Here's a button component...",
  "expected": "should contain <button>",
  "trajectory": [...],
  "metadata": {"category": "ui", "agent": "bunx claude-code-acp"},
  "timing": {"start": 1234567890, "end": 1234567900},
  "toolErrors": false,
  "score": {"pass": true, "score": 1.0, "reasoning": "Contains expected"}
}
```

Key fields:
- `toolErrors`: Boolean indicating if any tool calls failed
- `score`: Grader result (only if `--grader` provided)
- `trajectory`: Full execution trace (thoughts, messages, tool calls, plans)

## Graders

Graders score agent outputs. The harness supports two types:

### TypeScript/JavaScript Graders

Export a `grade` function:

```typescript
import type { Grader } from '@plaited/acp-harness/schemas'

export const grade: Grader = async ({ input, output, expected, trajectory }) => {
  const pass = output.toLowerCase().includes(expected?.toLowerCase() ?? '')
  return {
    pass,
    score: pass ? 1.0 : 0.0,
    reasoning: pass ? 'Contains expected answer' : 'Missing expected answer'
  }
}
```

```bash
acp-harness capture prompts.jsonl bunx claude-code-acp --grader ./grader.ts
```

### Polyglot Graders (Python, etc.)

Any executable script using stdin/stdout JSON protocol:

```python
#!/usr/bin/env python3
import json
import sys

data = json.load(sys.stdin)
output = data["output"].lower()
expected = (data.get("expected") or "").lower()

pass_result = expected in output if expected else True
print(json.dumps({
    "pass": pass_result,
    "score": 1.0 if pass_result else 0.0,
    "reasoning": "Contains expected" if pass_result else "Missing expected"
}))
```

```bash
chmod +x grader.py
acp-harness capture prompts.jsonl bunx claude-code-acp --grader ./grader.py
```

**Protocol:**
- Input (stdin): `{"input": "...", "output": "...", "expected": "...", "trajectory": [...]}`
- Output (stdout): `{"pass": true, "score": 1.0, "reasoning": "..."}`

## Downstream Integration

```bash
# Filter failures
cat results.jsonl | jq 'select(.score.pass == false)'

# Extract tool usage patterns
cat results.jsonl | jq '.trajectory[] | select(.type == "tool_call") | .name'

# Use with your scoring pipeline
cat results.jsonl | your-scoring-script.ts
```

## Plugin

This package includes an **acp-harness skill** for AI coding agents with complete documentation:

- CLI usage and examples
- Output format schemas
- Integration patterns (Braintrust, jq, custom scorers)

**Other AI coding agents:**

```bash
curl -fsSL https://raw.githubusercontent.com/plaited/marketplace/main/install.sh | bash -s -- --agent <agent-name> --plugin development-skills
```

## Development

```bash
bun install          # Install dependencies
bun run check        # Type check + lint + format
bun test             # Run unit tests
```

## Requirements

- **Runtime:** Bun >= 1.2.9
- **ACP Adapter:** `@anthropic-ai/claude-code-acp` or compatible
- **API Key:** `ANTHROPIC_API_KEY` environment variable

## License

ISC © [Plaited Labs](https://github.com/plaited)
