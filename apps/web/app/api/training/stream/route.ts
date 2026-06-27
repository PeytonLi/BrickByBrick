import { NextResponse } from 'next/server'

import {
  formatSSE,
  SSE_HEADERS,
  type AgentEvent,
  type TrainingRequest,
} from '@brickbybrick/core'

import { demoStreamMetrics } from '../demo-runner'

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
  // Deterministic, fast stub for e2e/CI — real metrics tail a live Prime job.
  if (process.env.BBB_DEMO_MODE === '1') {
    return demoStreamMetrics
  }

  const trainerModule = (await import('@brickbybrick/trainer')) as unknown as {
    streamMetrics?: StreamMetrics
  }

  return typeof trainerModule.streamMetrics === 'function'
    ? trainerModule.streamMetrics
    : demoStreamMetrics
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
