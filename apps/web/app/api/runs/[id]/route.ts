import { NextResponse } from 'next/server'

import { connectDB, RunModel, PairModel, EventModel } from '@brickbybrick/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  // DB is optional: with no Atlas configured, no run exists.
  if (!process.env.MONGODB_ATLAS_URI) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }
  try {
    await connectDB()
    const [run, pairs, events] = await Promise.all([
      RunModel.findOne({ runId: id }).lean(),
      PairModel.find({ runId: id }).lean(),
      EventModel.find({ runId: id }).sort({ sequence: 1 }).lean(),
    ])
    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }
    return NextResponse.json({ ...run, pairs, events })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch run' },
      { status: 500 },
    )
  }
}
