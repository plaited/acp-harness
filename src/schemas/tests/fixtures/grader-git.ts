/**
 * Test fixture: Git-based grader that detects file changes.
 *
 * @remarks
 * This grader uses git to detect environmental outcomes instead of just
 * checking output text. It demonstrates the "grade outcomes, not paths" principle.
 */

import type { Grader } from '../../schemas.ts'

export const grade: Grader = async ({ output: _output, hint, cwd }) => {
  // If no cwd provided, fall back to hint-based grading
  if (!cwd) {
    return {
      pass: false,
      score: 0,
      reasoning: 'No working directory provided',
    }
  }

  // Check if we're in a git repo
  const isGit = await Bun.$`git -C ${cwd} rev-parse --git-dir 2>/dev/null`.nothrow()

  if (isGit.exitCode !== 0) {
    return {
      pass: false,
      score: 0,
      reasoning: 'Not a git repository',
    }
  }

  // Detect what files were created/modified using git
  const status = await Bun.$`git -C ${cwd} status --porcelain`.text()

  const filesCreated = status
    .split('\n')
    .filter((line) => line.startsWith('??')) // ?? = untracked files
    .map((line) => line.slice(3).trim())
    .filter(Boolean)

  const filesModified = status
    .split('\n')
    .filter((line) => line.startsWith(' M') || line.startsWith('M ')) // M = modified
    .map((line) => line.slice(3).trim())
    .filter(Boolean)

  const hasChanges = filesCreated.length > 0 || filesModified.length > 0

  // If hint is provided, check if any changed file matches the hint
  let matchesHint = true
  if (hint) {
    const allChangedFiles = [...filesCreated, ...filesModified]
    matchesHint = allChangedFiles.some((file) => file.toLowerCase().includes(hint.toLowerCase()))
  }

  const pass = hasChanges && matchesHint

  return {
    pass,
    score: pass ? 1.0 : hasChanges ? 0.5 : 0.0,
    reasoning: pass
      ? `Files changed: ${[...filesCreated, ...filesModified].join(', ')}`
      : hasChanges
        ? 'File changes do not match hint'
        : 'No file changes detected',
    outcome: {
      filesCreated,
      filesModified,
      type: 'git_status_check',
    },
  }
}
