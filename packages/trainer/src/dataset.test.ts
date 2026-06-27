import { describe, it, expect } from 'vitest'
import { exportDataset } from './dataset'
import type { TrainingPair } from '@brickbybrick/core'

function makePair(overrides: Partial<TrainingPair> = {}): TrainingPair {
  return {
    id: 'pair-1',
    task: {
      id: 'task-1',
      prompt: 'Build a responsive grid',
      target_mechanism: 'responsive-grid',
      criteria: [{ id: 'c1', description: 'No overflow', weight: 1 }],
    },
    weak_code: 'function Grid() { return <div>bad</div> }',
    defect: {
      screenshot: 'base64fake',
      dom_trace: 'Error: overflow',
      category: 'overflow',
      severity: 'high',
    },
    strong_code: 'function Grid() { return <div style={{overflow:"hidden"}}>good</div> }',
    u_score: 0.72,
    ...overrides,
  }
}

describe('exportDataset', () => {
  it('emits valid JSON per line', () => {
    const pairs = [makePair(), makePair({ id: 'pair-2' })]
    const result = exportDataset(pairs)
    const lines = result.trim().split('\n')

    expect(lines).toHaveLength(2)
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })

  it('preserves the TrainingPair shape in each line', () => {
    const pair = makePair()
    const result = exportDataset([pair])
    const parsed = JSON.parse(result.trim())

    expect(parsed.id).toBe('pair-1')
    expect(parsed.task.id).toBe('task-1')
    expect(parsed.weak_code).toBe(pair.weak_code)
    expect(parsed.defect.category).toBe('overflow')
    expect(parsed.strong_code).toBe(pair.strong_code)
    expect(parsed.u_score).toBe(0.72)
  })

  it('returns empty string for empty array', () => {
    expect(exportDataset([])).toBe('')
  })

  it('handles multiple pairs', () => {
    const pairs = Array.from({ length: 5 }, (_, i) => makePair({ id: `pair-${i}` }))
    const result = exportDataset(pairs)
    const lines = result.trim().split('\n')
    expect(lines).toHaveLength(5)
  })

  it('round-trips through parse', () => {
    const original = [makePair(), makePair({ id: 'pair-2', u_score: 0.91 })]
    const exported = exportDataset(original)
    const parsed = exported
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l)) as TrainingPair[]

    expect(parsed[0].id).toBe(original[0].id)
    expect(parsed[0].u_score).toBe(original[0].u_score)
    expect(parsed[1].id).toBe(original[1].id)
    expect(parsed[1].u_score).toBe(original[1].u_score)
  })
})
