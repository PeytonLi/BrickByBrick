import mongoose, { Schema, type Model } from 'mongoose'
import type { PersistedEvent } from '../types'
import type { AgentEvent } from '@brickbybrick/core'

const EventSchema = new Schema<PersistedEvent>({
  runId: { type: String, required: true },
  sequence: { type: Number, required: true },
  type: { type: String, required: true },
  payload: { type: Schema.Types.Mixed, required: true },
  timestamp: { type: Date, default: Date.now },
})

EventSchema.index({ runId: 1, sequence: 1 })

interface EventModelStatics {
  forRun(runId: string): ReturnType<Model<PersistedEvent>['find']>
  insertBatch(runId: string, events: AgentEvent[], startSeq: number): Promise<PersistedEvent[]>
}

EventSchema.statics.forRun = function (runId: string) {
  return this.find({ runId }).sort({ sequence: 1 })
}

EventSchema.statics.insertBatch = async function (runId: string, events: AgentEvent[], startSeq: number) {
  const docs = events.map((event, i) => ({
    runId,
    sequence: startSeq + i,
    type: event.type,
    payload: event,
    timestamp: new Date(),
  }))
  return this.insertMany(docs)
}

export type EventModel = Model<PersistedEvent> & EventModelStatics

const modelName = 'Event'
export const EventModel: EventModel =
  (mongoose.models[modelName] as EventModel) ??
  mongoose.model<PersistedEvent, EventModel>(modelName, EventSchema)
