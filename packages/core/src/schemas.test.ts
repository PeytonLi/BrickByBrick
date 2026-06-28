import { describe, it, expect } from 'vitest'
import { GenerationConfigSchema, AgentEventSchema, EvalReportSchema } from './schemas'

describe('GenerationConfig intent fields (Feature A)', () => {
  it('still parses an empty config (back-compat)', () => {
    const c = GenerationConfigSchema.parse({})
    expect(c.tau).toBe(0.4)
    expect(c.intent).toBeUndefined()
  })
  it('accepts intent / domain_framing / framework', () => {
    const c = GenerationConfigSchema.parse({
      intent: 'good at react',
      domain_framing: 'React responsive layouts',
      framework: 'react',
    })
    expect(c.framework).toBe('react')
  })
})

describe('intent_expanded AgentEvent (Feature A)', () => {
  it('parses an intent_expanded event', () => {
    const e = AgentEventSchema.parse({
      type: 'intent_expanded',
      config: { domain_framing: 'x', challenger_weights: { 'responsive-card-grid': 3 } },
      sample_titles: ['A', 'B'],
    })
    expect(e.type).toBe('intent_expanded')
  })
})

describe('Eval contracts (Feature C)', () => {
  const result = {
    task: { id: 't', prompt: 'p', target_mechanism: 'm', criteria: [{ id: 'c', description: 'd', weight: 1 }] },
    base_score: 0.2, tuned_score: 0.8,
    base_passed_criteria: [], tuned_passed_criteria: ['c'], winner: 'tuned' as const,
  }
  it('parses an EvalReport', () => {
    const r = EvalReportSchema.parse({
      runId: 'r', k: 1, base_model: 'g', tuned_model: 'tuned',
      wins: 1, ties: 0, losses: 0, mean_score_delta: 0.6, tasks: [result],
    })
    expect(r.wins).toBe(1)
  })
  it('parses eval + serving events', () => {
    expect(AgentEventSchema.parse({ type: 'eval_started', k: 3 }).type).toBe('eval_started')
    expect(AgentEventSchema.parse({ type: 'eval_task_result', result }).type).toBe('eval_task_result')
    expect(AgentEventSchema.parse({
      type: 'model_serving', url: 'http://x/v1', expires_at: 'z', pod_id: 'p', base_model: 'g',
    }).type).toBe('model_serving')
  })
})
