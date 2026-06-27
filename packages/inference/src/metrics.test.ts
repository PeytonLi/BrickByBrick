import { describe, it, expect } from 'vitest'
import type { Criterion } from '@brickbybrick/core'
import { scoreCriteria, computeUtility, cosineSim } from './metrics'

const criteria: Criterion[] = [
  { id: 'a', description: 'no overflow', weight: 0.7 },
  { id: 'b', description: 'mobile legible', weight: 0.3 },
]

describe('scoreCriteria — S(M,T,C) from MATH §1', () => {
  it('is 1 when every criterion passes', () => {
    expect(scoreCriteria(criteria, ['a', 'b'])).toBe(1)
  })

  it('is 0 when no criterion passes', () => {
    expect(scoreCriteria(criteria, [])).toBe(0)
  })

  it('is the weighted pass ratio for a partial pass', () => {
    expect(scoreCriteria(criteria, ['a'])).toBeCloseTo(0.7, 10)
    expect(scoreCriteria(criteria, ['b'])).toBeCloseTo(0.3, 10)
  })

  it('normalizes weights that do not sum to 1', () => {
    const raw: Criterion[] = [
      { id: 'a', description: 'x', weight: 0.75 },
      { id: 'b', description: 'y', weight: 0.25 },
    ]
    // unnormalized would already be 0.75; with sum=1 it stays 0.75
    expect(scoreCriteria(raw, ['a'])).toBeCloseTo(0.75, 10)
  })

  it('treats unknown passed ids as not contributing', () => {
    expect(scoreCriteria(criteria, ['zzz'])).toBe(0)
  })

  it('returns 0 for an empty criteria set rather than dividing by zero', () => {
    expect(scoreCriteria([], ['a'])).toBe(0)
  })
})

describe('computeUtility — 𝒰 = S_strong − S_weak (MATH §1)', () => {
  it('is the strong/weak gap', () => {
    expect(computeUtility(0.9, 0.3)).toBeCloseTo(0.6, 10)
  })

  it('clamps a negative gap to 0', () => {
    expect(computeUtility(0.3, 0.9)).toBe(0)
  })

  it('caps the gap at 1', () => {
    expect(computeUtility(1, 0)).toBe(1)
  })
})

describe('cosineSim — diversity gate (MATH §3)', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSim([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10)
  })

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0, 10)
  })

  it('is -1 for opposite vectors', () => {
    expect(cosineSim([1, 1], [-1, -1])).toBeCloseTo(-1, 10)
  })

  it('returns 0 when either vector is all zeros (no direction)', () => {
    expect(cosineSim([0, 0], [1, 1])).toBe(0)
  })
})
