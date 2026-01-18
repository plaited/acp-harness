/**
 * Test fixture: TypeScript grader module.
 */

import type { Grader } from '../../schemas.ts'

export const grade: Grader = async ({ input: _input, output, expected }) => {
  const pass = expected ? output.toLowerCase().includes(expected.toLowerCase()) : true
  return {
    pass,
    score: pass ? 1.0 : 0.0,
    reasoning: pass ? 'Contains expected text' : 'Missing expected text',
  }
}
