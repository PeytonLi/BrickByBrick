import { describe, expect, it, vi } from 'vitest'

import type { AgentEvent, TrainingPair } from '@brickbybrick/core'
import { runPrimeTraining, type GemmaTrainingDeps } from './training'

const pair: TrainingPair = {
  id: 'pair-1',
  task: {
    id: 'task-1',
    prompt: 'Build a mobile-safe pricing grid.',
    target_mechanism: 'responsive-grid',
    criteria: [{ id: 'no-overflow', description: 'No horizontal overflow', weight: 1 }],
  },
  weak_code: '<Grid />',
  defect: {
    screenshot: 'PNG',
    dom_trace: 'div.card overflowed',
    category: 'overflow',
    severity: 'high',
  },
  strong_code: '<Grid className="min-w-0" />',
  u_score: 1,
}

function collect() {
  const events: AgentEvent[] = []
  return { events, emit: (event: AgentEvent) => events.push(event) }
}

describe('runPrimeTraining', () => {
  it('bridges exact Gemma pod training callbacks into training events', async () => {
    const deps: GemmaTrainingDeps = {
      runGemmaLoraTraining: vi.fn(async (_opts, callbacks) => {
        callbacks.onStatus?.('streaming_dataset', 'pod-1')
        callbacks.onMetric?.({ step: 1, loss: 2.4, epoch: 0 })
        callbacks.onMetric?.({ step: 2, loss: 2.1, epoch: 0.5 })
        callbacks.onStatus?.('saving', '/workspace/adapter')
        return { podId: 'pod-1', adapterPath: '/workspace/adapter', runName: 'bbb-test' }
      }),
    }
    const { events, emit } = collect()

    await runPrimeTraining([pair], emit, deps)

    expect(deps.runGemmaLoraTraining).toHaveBeenCalledWith(
      expect.objectContaining({ pairs: [pair] }),
      expect.any(Object),
    )
    expect(
      events.filter((event) => event.type === 'training_event' && event.loss).map((event) => {
        if (event.type !== 'training_event') return null
        return event.loss?.loss
      }),
    ).toEqual([2.4, 2.1])
    expect(events.some((event) => event.type === 'training_event' && event.status === 'complete')).toBe(true)
    expect(
      events.some(
        (event) =>
          event.type === 'narration' &&
          event.text.includes('Exact Gemma LoRA adapter ready on Prime pod pod-1'),
      ),
    ).toBe(true)
  })

  it('emits failed when exact Gemma training fails', async () => {
    const deps: GemmaTrainingDeps = {
      runGemmaLoraTraining: vi.fn(async () => {
        throw new Error('HF_TOKEN is required')
      }),
    }
    const { events, emit } = collect()

    await runPrimeTraining([pair], emit, deps)

    expect(events.some((event) => event.type === 'training_event' && event.status === 'failed')).toBe(true)
    expect(
      events.some(
        (event) =>
          event.type === 'narration' &&
          event.text.includes('Prime Gemma training failed: HF_TOKEN is required'),
      ),
    ).toBe(true)
  })

  it('skips Prime calls when no pairs are available', async () => {
    const deps: GemmaTrainingDeps = {
      runGemmaLoraTraining: vi.fn(async () => ({
        podId: 'pod-1',
        adapterPath: '/workspace/adapter',
        runName: 'bbb-test',
      })),
    }
    const { events, emit } = collect()

    await runPrimeTraining([], emit, deps)

    expect(deps.runGemmaLoraTraining).not.toHaveBeenCalled()
    expect(events).toEqual([
      { type: 'narration', text: 'No committed pairs available; skipping Prime training.' },
    ])
  })
})
