import { describe, expect, it } from 'vitest'
import { createGeminiSolverSet } from '../../src/providers/gemini'

describe('createGeminiSolverSet', () => {
  it('returns a SolverSet with generate and embed', () => {
    const set = createGeminiSolverSet()
    expect(set.strongModel).toBeDefined()
    expect(set.weakModel).toBeDefined()
    expect(typeof set.generate).toBe('function')
    expect(typeof set.embed).toBe('function')
  })

  it('strongModel and weakModel are strings from env or defaults', () => {
    const set = createGeminiSolverSet()
    expect(typeof set.strongModel).toBe('string')
    expect(typeof set.weakModel).toBe('string')
    expect(set.strongModel.length).toBeGreaterThan(0)
    expect(set.weakModel.length).toBeGreaterThan(0)
  })
})
