// packages/inference/src/eval.test.ts
import { describe, it, expect, vi } from 'vitest'
import { runEval, scoreFromReport, type EvalDeps } from './eval'
import type { AgentEvent, VisualTask } from '@brickbybrick/core'

const task: VisualTask = {
  id: 't', prompt: 'p', target_mechanism: 'm',
  criteria: [{ id: 'a', description: 'x', weight: 0.6 }, { id: 'b', description: 'y', weight: 0.4 }],
}
const report = (passed: string[]) => ({ passed: passed.length === 2, passedCriteria: passed, failedCriteria: [], domTrace: '', notes: '' })

describe('scoreFromReport', () => {
  it('sums weights of passed criteria', () => {
    expect(scoreFromReport(task, report(['a']))).toBeCloseTo(0.6)
    expect(scoreFromReport(task, report(['a', 'b']))).toBeCloseTo(1.0)
  })
})

describe('runEval', () => {
  it('emits started, per-task results, and an aggregate with tuned winning', async () => {
    const deps: EvalDeps = {
      generateTask: vi.fn(async () => task),
      inferCode: vi.fn(async (m) => (m === 'tuned' ? 'good' : 'bad')),
      auditCode: vi.fn(async (_t, code) => (code === 'good' ? report(['a', 'b']) : report(['a']))),
    }
    const events: AgentEvent[] = []
    await runEval({ runId: 'r', config: {} as never, k: 2, baseModel: 'g', tunedModel: 'tuned' }, (e) => events.push(e), deps)
    expect(events[0]).toMatchObject({ type: 'eval_started', k: 2 })
    const complete = events.find((e) => e.type === 'eval_complete') as Extract<AgentEvent, { type: 'eval_complete' }>
    expect(complete.report.wins).toBe(2)
    expect(complete.report.mean_score_delta).toBeCloseTo(0.4)
  })
  it('marks a task inconclusive when an audit throws', async () => {
    const deps: EvalDeps = {
      generateTask: vi.fn(async () => task),
      inferCode: vi.fn(async () => 'x'),
      auditCode: vi.fn(async () => { throw new Error('audit failed') }),
    }
    const events: AgentEvent[] = []
    await runEval({ runId: 'r', config: {} as never, k: 1, baseModel: 'g', tunedModel: 'tuned' }, (e) => events.push(e), deps)
    const r = events.find((e) => e.type === 'eval_task_result') as Extract<AgentEvent, { type: 'eval_task_result' }>
    expect(r.result.inconclusive).toBe(true)
  })
})
