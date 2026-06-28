import { NextResponse } from 'next/server'

import { connectDB, RunModel } from '@brickbybrick/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  // DB is optional: with no Atlas configured, history is simply empty.
  if (!process.env.MONGODB_ATLAS_URI) {
    return NextResponse.json([])
  }
  try {
    await connectDB()
    const runs = await RunModel.find().sort({ startedAt: -1 }).limit(20).lean()
    return NextResponse.json(runs)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch runs' },
      { status: 500 },
    )
  }
}
