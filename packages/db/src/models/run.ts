import mongoose, { Schema, type Model } from 'mongoose'
import type { LoopRun } from '../types'

const RunSchema = new Schema<LoopRun>({
  runId: { type: String, unique: true, required: true },
  config: { type: Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['running', 'complete', 'failed'], default: 'running' },
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
  pairsCommitted: { type: Number, default: 0 },
  totalIterations: { type: Number, default: 0 },
})

RunSchema.index({ startedAt: -1 })

interface RunModelStatics {
  latest(limit?: number): ReturnType<Model<LoopRun>['find']>
  byId(runId: string): ReturnType<Model<LoopRun>['findOne']>
}

RunSchema.statics.latest = function (limit = 10) {
  return this.find().sort({ startedAt: -1 }).limit(limit)
}

RunSchema.statics.byId = function (runId: string) {
  return this.findOne({ runId })
}

export type RunModel = Model<LoopRun> & RunModelStatics

const modelName = 'Run'
export const RunModel: RunModel =
  (mongoose.models[modelName] as RunModel) ??
  mongoose.model<LoopRun, RunModel>(modelName, RunSchema)
