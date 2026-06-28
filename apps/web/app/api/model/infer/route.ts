// apps/web/app/api/model/infer/route.ts
import { NextResponse } from 'next/server'
import { connectDB, RunModel } from '@brickbybrick/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let runId = '', prompt = '', model: 'base' | 'tuned' = 'tuned'
  try {
    const b = (await request.json()) as { runId?: string; prompt?: string; model?: 'base' | 'tuned' }
    runId = (b.runId ?? '').trim(); prompt = (b.prompt ?? '').trim()
    if (b.model === 'base' || b.model === 'tuned') model = b.model
  } catch { /* fall through */ }
  if (!runId || !prompt) return NextResponse.json({ error: 'runId and prompt are required' }, { status: 400 })

  if (process.env.BBB_DEMO_MODE === '1') {
    return NextResponse.json({ code: `// ${model} model demo output for: ${prompt}` })
  }
  try {
    await connectDB()
    const run = await RunModel.byId(runId).lean()
    if (!run?.serve?.serveUrl) return NextResponse.json({ error: 'no served model for this run' }, { status: 409 })
    const { inferOnModel } = (await import('@brickbybrick/inference')) as typeof import('@brickbybrick/inference')
    const code = await inferOnModel(run.serve.serveUrl, model === 'base' ? run.serve.baseModel : 'tuned', prompt)
    return NextResponse.json({ code })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'infer failed' }, { status: 500 })
  }
}
