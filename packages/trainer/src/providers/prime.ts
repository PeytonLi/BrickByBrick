import type { LossPoint } from '@brickbybrick/core'
import type { ProvisionPodOpts } from '../prime'

export interface PrimeTrainingDeps {
  provisionPod: (opts: ProvisionPodOpts) => { podId: string }
  launchTraining: (configPath: string, datasetPath: string) => { runId: string }
  streamMetrics: (runId: string, onPoint: (point: LossPoint) => void) => Promise<void>
  getCheckpoint: (runId: string) => string
  terminatePod: (podId: string) => void
}
