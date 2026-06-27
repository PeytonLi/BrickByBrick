import { NextResponse } from 'next/server'

import {
  formatSSE,
  SSE_HEADERS,
  type AgentEvent,
  type TrainingRequest,
} from '@brickbybrick/core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type StreamMetrics = (
  runId: string,
  emit: (event: AgentEvent) => void,
) => Promise<void>

async function readRequest(request: Request): Promise<TrainingRequest | null> {
  try {
    const body = (await request.json()) as Partial<TrainingRequest>
    return typeof body.runId === 'string' && body.runId.length > 0
      ? { runId: body.runId }
      : null
  } catch {
    return null
  }
}

async function resolveStreamMetrics(): Promise<StreamMetrics> {
  const trainerModule = (await import('@brickbybrick/trainer')) as unknown as {
    streamMetrics?: StreamMetrics
  }

  return typeof trainerModule.streamMetrics === 'function'
    ? trainerModule.streamMetrics
    : demoStreamMetrics
}

async function demoStreamMetrics(
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

export async function POST(request: Request) {
  const body = await readRequest(request)

  if (!body) {
    return NextResponse.json({ error: 'runId is required' }, { status: 400 })
  }

  const streamMetrics = await resolveStreamMetrics()
  const encoder = new TextEncoder()
  let aborted = false

  request.signal.addEventListener('abort', () => {
    aborted = true
  })

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AgentEvent) => {
        if (!aborted) {
          controller.enqueue(encoder.encode(formatSSE(event)))
        }
      }

      try {
        await streamMetrics(body.runId, emit)
      } catch (error) {
        emit({
          type: 'narration',
          text:
            error instanceof Error
              ? `Training stream failed: ${error.message}`
              : 'Training stream failed.',
        })
      } finally {
        if (!aborted) {
          controller.close()
        }
      }
    },
    cancel() {
      aborted = true
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}
