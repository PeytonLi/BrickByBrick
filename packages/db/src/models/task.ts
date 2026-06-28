import mongoose, { Schema, type Model } from 'mongoose'
import type { PersistedTask } from '../types'

const CriterionSchema = new Schema(
  {
    id: { type: String, required: true },
    description: { type: String, required: true },
    weight: { type: Number, required: true },
  },
  { _id: false },
)

const TaskSchema = new Schema<PersistedTask>({
  id: { type: String, unique: true, required: true },
  prompt: { type: String, required: true },
  target_mechanism: { type: String, index: true, required: true },
  criteria: { type: [CriterionSchema], required: true },
  timesUsed: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
})

interface TaskModelStatics {
  byMechanism(mechanism: string): ReturnType<Model<PersistedTask>['find']>
}

TaskSchema.statics.byMechanism = function (mechanism: string) {
  return this.find({ target_mechanism: mechanism })
}

export type TaskModel = Model<PersistedTask> & TaskModelStatics

const modelName = 'Task'
export const TaskModel: TaskModel =
  (mongoose.models[modelName] as TaskModel) ??
  mongoose.model<PersistedTask, TaskModel>(modelName, TaskSchema)
