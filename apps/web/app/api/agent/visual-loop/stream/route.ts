import { NextResponse } from 'next/server'

import {
  formatSSE,
  GenerationConfigSchema,
  SSE_HEADERS,
  type AgentEvent,
  type RunVisualLoop,
  type VisualLoopRequest,
} from '@brickbybrick/core'

import { demoRunVisualLoop } from '../demo-runner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function readRequest(request: Request): Promise<VisualLoopRequest> {
  try {
    return (await request.json()) as VisualLoopRequest
  } catch {
    return {}
  }
}

async function resolveRunVisualLoop(): Promise<RunVisualLoop> {
  const inferenceModule = (await import('@brickbybrick/inference')) as unknown as {
    runVisualLoop?: RunVisualLoop
  }

  return typeof inferenceModule.runVisualLoop === 'function'
    ? inferenceModule.runVisualLoop
    : demoRunVisualLoop
}

export async function POST(request: Request) {
  const body = await readRequest(request)
  const parsed = GenerationConfigSchema.safeParse(body.config ?? {})

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid visual loop config', issues: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const runVisualLoop = await resolveRunVisualLoop()
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
        await runVisualLoop(parsed.data, emit)
      } catch (error) {
        emit({
          type: 'narration',
          text:
            error instanceof Error
              ? `Visual loop failed: ${error.message}`
              : 'Visual loop failed.',
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
