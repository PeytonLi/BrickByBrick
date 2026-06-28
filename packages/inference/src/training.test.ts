import { describe, it, expect, vi } from 'vitest'
import { runPrimeTraining } from './training'
import type { AgentEvent, TrainingPair } from '@brickbybrick/core'

const pair = { id: 'p', task: { id: 't', prompt: 'p', target_mechanism: 'm', criteria: [{ id: 'c', description: 'd', weight: 1 }] }, weak_code: 'w', defect: { screenshot: '', dom_trace: '', category: 'overflow', severity: 'high' }, strong_code: 's', u_score: 0.7 } as TrainingPair

describe('runPrimeTraining — serving tail (Feature C)', () => {
  it('emits model_serving after training when serve deps are provided', async () => {
    const events: AgentEvent[] = []
    await runPrimeTraining([pair], (e) => events.push(e), {
      runGemmaLoraTraining: vi.fn(async () => ({ podId: 'pod1', adapterPath: '/r/adapter', runName: 'run', hubRepo: 'u/r' })),
      serveAdapter: vi.fn(async () => ({ serveUrl: 'http://pod1:8000/v1', podId: 'pod1', baseModel: 'g', expiresAt: '2030-01-01T00:00:00Z' })),
      sshTargetForPod: vi.fn(async () => ({ host: 'h', port: '22', keyPath: 'k' })),
      remoteDirFor: vi.fn(() => '/r'),
    })
    const serving = events.find((e) => e.type === 'model_serving')
    expect(serving).toMatchObject({ type: 'model_serving', url: 'http://pod1:8000/v1', pod_id: 'pod1' })
  })
})
