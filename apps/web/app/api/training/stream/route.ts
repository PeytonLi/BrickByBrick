import { NextResponse } from 'next/server'

import {
  formatSSE,
  SSE_HEADERS,
  type AgentEvent,
  type LossPoint,
  type TrainingRequest,
} from '@brickbybrick/core'
import { connectDB, EventModel } from '@brickbybrick/db'

import { demoStreamMetrics } from '../demo-runner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type StreamMetrics = (
  runId: string,
  emit: (event: AgentEvent) => void,
) => Promise<void>

type PrimeStreamMetrics = (
  runId: string,
  onPoint: (point: LossPoint) => void,
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
  // Deterministic, fast stub for e2e/CI — real metrics tail a live job.
  if (process.env.BBB_DEMO_MODE === '1') {
    return demoStreamMetrics
  }

  const trainerModule = (await import('@brickbybrick/trainer')) as unknown as {
    streamMetrics?: PrimeStreamMetrics
    resolveTrainingProvider?: () => 'prime' | 'do-gpu'
    createDOTrainingDeps?: () => {
      provisionPod: (opts: { name: string }) => { podId: string; ip: string }
      launchTraining: (
        ip: string,
        configPath: string,
        datasetPath: string,
      ) => { runId: string }
      streamMetrics: (
        ip: string,
        runId: string,
        onPoint: (point: LossPoint) => void,
      ) => Promise<void>
      terminatePod: (podId: string) => void
    }
  }

  const provider = trainerModule.resolveTrainingProvider?.() ?? 'prime'

  // --- DigitalOcean GPU Droplet: provision → launch → stream → terminate ---
  if (provider === 'do-gpu' && typeof trainerModule.createDOTrainingDeps === 'function') {
    const deps = trainerModule.createDOTrainingDeps()
    return async (runId, emit) => {
      emit({ type: 'training_event', status: 'provisioning', instance: runId })
      const { podId, ip } = deps.provisionPod({ name: `bbb-${runId}` })
      try {
        const launched = deps.launchTraining(ip, '/root/train.toml', '/root/dataset.jsonl')
        emit({ type: 'training_event', status: 'training', instance: launched.runId })
        await deps.streamMetrics(ip, launched.runId, (loss) => {
          emit({ type: 'training_event', status: 'training', instance: launched.runId, loss })
        })
        emit({ type: 'training_event', status: 'complete', instance: launched.runId })
      } finally {
        deps.terminatePod(podId)
      }
    }
  }

  // --- Prime Intellect (default) ---
  if (typeof trainerModule.streamMetrics !== 'function') {
    return demoStreamMetrics
  }

  return async (runId, emit) => {
    emit({ type: 'training_event', status: 'training', instance: runId })
    await trainerModule.streamMetrics!(runId, (loss) => {
      emit({ type: 'training_event', status: 'training', instance: runId, loss })
    })
    emit({ type: 'training_event', status: 'complete', instance: runId })
  }
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
      // --- DB persistence (degraded-but-not-broken on failure) -------------
      let persistSeq: number | null = null

      try {
        await connectDB()
        const existing = await EventModel.countDocuments({ runId: body.runId })
        persistSeq = existing
      } catch {
        persistSeq = null
      }

      const emit = (event: AgentEvent) => {
        if (!aborted) {
          controller.enqueue(encoder.encode(formatSSE(event)))
        }
        if (persistSeq !== null) {
          const seq = persistSeq
          persistSeq++
          EventModel.insertBatch(body.runId, [event], seq).catch(() => {})
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
