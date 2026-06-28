import mongoose, { Schema, type Model } from 'mongoose'
import type { PersistedPair } from '../types'

const PairSchema = new Schema<PersistedPair>({
  pairId: { type: String, unique: true, required: true },
  runId: { type: String, index: true, required: true },
  task: { type: Schema.Types.Mixed, required: true },
  weak_code: { type: String, required: true },
  defect: { type: Schema.Types.Mixed, required: true },
  strong_code: { type: String, required: true },
  u_score: { type: Number, index: true, required: true },
  createdAt: { type: Date, default: Date.now },
})

interface PairModelStatics {
  byRun(runId: string): ReturnType<Model<PersistedPair>['find']>
  byMechanism(mechanism: string): ReturnType<Model<PersistedPair>['find']>
  recent(limit?: number): ReturnType<Model<PersistedPair>['find']>
}

PairSchema.statics.byRun = function (runId: string) {
  return this.find({ runId })
}

PairSchema.statics.byMechanism = function (mechanism: string) {
  return this.find({ 'task.target_mechanism': mechanism })
}

PairSchema.statics.recent = function (limit = 10) {
  return this.find().sort({ createdAt: -1 }).limit(limit)
}

export type PairModel = Model<PersistedPair> & PairModelStatics

const modelName = 'Pair'
export const PairModel: PairModel =
  (mongoose.models[modelName] as PairModel) ??
  mongoose.model<PersistedPair, PairModel>(modelName, PairSchema)
