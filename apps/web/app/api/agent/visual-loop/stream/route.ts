import { NextResponse } from 'next/server'

import {
  formatSSE,
  GenerationConfigSchema,
  SSE_HEADERS,
  type AgentEvent,
  type GenerationConfig,
  type RunVisualLoop,
  type TrainingPair,
  type VisualLoopRequest,
  type VisualTask,
} from '@brickbybrick/core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const demoScreenshot =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lF0QJwAAAABJRU5ErkJggg=='

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

const demoTask: VisualTask = {
  id: 'demo-responsive-grid',
  prompt: 'Generate a dense pricing grid with long labels and stress it at mobile width.',
  target_mechanism: 'responsive-grid',
  criteria: [
    {
      id: 'no-horizontal-overflow',
      description: 'Cards keep text inside the viewport without horizontal scrolling.',
      weight: 0.6,
    },
    {
      id: 'action-visible',
      description: 'Primary actions remain visible after wrapping.',
      weight: 0.4,
    },
  ],
}

const demoPair: TrainingPair = {
  id: 'demo-pair-1',
  task: demoTask,
  weak_code: '<PricingGrid columns="auto" />',
  strong_code: '<PricingGrid className="grid-cols-1 md:grid-cols-3 min-w-0" />',
  defect: {
    screenshot: demoScreenshot,
    dom_trace: 'pricing-card:nth-child(3) overflowed viewport by 96px',
    category: 'overflow',
    severity: 'high',
  },
  u_score: 0.71,
}

async function demoRunVisualLoop(
  config: GenerationConfig,
  emit: (event: AgentEvent) => void,
): Promise<void> {
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const events: AgentEvent[] = [
    { type: 'narration', text: 'Starting a stubbed visual loop stream.' },
    { type: 'challenge_generated', task: demoTask },
    { type: 'weak_code_drafted', code: demoPair.weak_code },
    {
      type: 'audit_step',
      step: {
        screenshot: demoScreenshot,
        action: 'resize',
        intent: 'Probe the generated UI at a narrow viewport.',
        viewport: { width: 390, height: 844 },
      },
    },
    { type: 'defect_found', defect: demoPair.defect },
    {
      type: 'strong_fix_generated',
      code: demoPair.strong_code,
      diff: '+ grid-cols-1 md:grid-cols-3 min-w-0',
    },
    { type: 'audit_pass' },
    { type: 'pair_committed', pair: demoPair, u_score: demoPair.u_score },
  ]

  for (const event of events) {
    emit(event)
    await delay(180)
  }

  if (config.max_pairs > 1) {
    emit({
      type: 'recipe_mutated',
      patch: { focus_mechanism: 'modal-focus-trap' },
    })
  }
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
