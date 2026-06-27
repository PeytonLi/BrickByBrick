import type { AgentEvent } from '@brickbybrick/core'

export async function demoStreamMetrics(
  runId: string,
  emit: (event: AgentEvent) => void,
): Promise<void> {
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const losses = [2.41, 2.12, 1.86, 1.49, 1.31, 1.14]

  emit({
    type: 'training_event',
    status: 'provisioning',
    instance: `${runId}-h100-80gb`,
    cost_microcents: 0,
  })
  await delay(160)

  emit({ type: 'training_event', status: 'streaming_dataset', cost_microcents: 18 })
  await delay(160)

  for (const [index, loss] of losses.entries()) {
    emit({
      type: 'training_event',
      status: 'training',
      instance: `${runId}-h100-80gb`,
      cost_microcents: 18 + index * 12,
      loss: { step: index + 1, epoch: (index + 1) / losses.length, loss },
    })
    await delay(160)
  }

  emit({ type: 'training_event', status: 'saving', cost_microcents: 112 })
  await delay(160)
  emit({ type: 'training_event', status: 'complete', cost_microcents: 126 })
}
