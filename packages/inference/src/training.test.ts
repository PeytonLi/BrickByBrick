import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import type { AgentEvent, TrainingPair } from '@brickbybrick/core'
import { runPrimeTraining, type PrimeTrainingDeps } from './training'

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

function makeDeps(overrides: Partial<PrimeTrainingDeps> = {}): PrimeTrainingDeps {
  return {
    provisionPod: vi.fn(() => ({ podId: 'pod-1' })),
    launchTraining: vi.fn(() => ({ runId: 'run-1' })),
    streamMetrics: vi.fn(async (_runId, onPoint) => {
      onPoint({ step: 1, loss: 2.4, epoch: 0 })
      onPoint({ step: 2, loss: 2.1, epoch: 0.5 })
    }),
    getCheckpoint: vi.fn(() => '/checkpoints/run-1/latest'),
    terminatePod: vi.fn(),
    ...overrides,
  }
}

function collect() {
  const events: AgentEvent[] = []
  return { events, emit: (event: AgentEvent) => events.push(event) }
}

describe('runPrimeTraining', () => {
  it('writes dataset/config files, streams metrics, fetches checkpoint, and terminates the pod', async () => {
    const deps = makeDeps()
    const launchTraining = vi.mocked(deps.launchTraining)
    let configText = ''
    let datasetText = ''
    launchTraining.mockImplementation((configPath, datasetPath) => {
      configText = readFileSync(configPath, 'utf8')
      datasetText = readFileSync(datasetPath, 'utf8')
      return { runId: 'run-1' }
    })
    const { events, emit } = collect()

    await runPrimeTraining([pair], emit, deps, { podName: 'bbb-test', cleanupTempFiles: true })

    expect(deps.provisionPod).toHaveBeenCalledWith({
      name: 'bbb-test',
      gpu_type: 'H100_80GB',
    })
    expect(configText).toContain('rank = 16')
    expect(configText).toContain('alpha = 32')
    expect(JSON.parse(datasetText)).toEqual(pair)
    expect(deps.getCheckpoint).toHaveBeenCalledWith('run-1')
    expect(deps.terminatePod).toHaveBeenCalledWith('pod-1')
    expect(
      events.filter((event) => event.type === 'training_event' && event.loss).map((event) => {
        if (event.type !== 'training_event') return null
        return event.loss?.loss
      }),
    ).toEqual([2.4, 2.1])
    expect(events.some((event) => event.type === 'training_event' && event.status === 'complete')).toBe(true)
  })

  it('emits failed and still terminates the pod when training fails', async () => {
    const deps = makeDeps({
      streamMetrics: vi.fn(async () => {
        throw new Error('metrics unavailable')
      }),
    })
    const { events, emit } = collect()

    await runPrimeTraining([pair], emit, deps, { podName: 'bbb-test' })

    expect(deps.terminatePod).toHaveBeenCalledWith('pod-1')
    expect(events.some((event) => event.type === 'training_event' && event.status === 'failed')).toBe(true)
    expect(
      events.some(
        (event) =>
          event.type === 'narration' && event.text.includes('Prime training failed: metrics unavailable'),
      ),
    ).toBe(true)
  })

  it('skips Prime calls when no pairs are available', async () => {
    const deps = makeDeps()
    const { events, emit } = collect()

    await runPrimeTraining([], emit, deps)

    expect(deps.provisionPod).not.toHaveBeenCalled()
    expect(events).toEqual([
      { type: 'narration', text: 'No committed pairs available; skipping Prime training.' },
    ])
  })
})
