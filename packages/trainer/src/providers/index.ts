export type TrainingProvider = 'prime' | 'do-gpu'

export function resolveTrainingProvider(): TrainingProvider {
  const val = process.env.BBB_TRAINING_PROVIDER
  if (val === 'do-gpu') return 'do-gpu'
  return 'prime'
}

export type { PrimeTrainingDeps } from './prime'
export type { DOTrainingDeps, DOProvisionPodOpts } from './do-gpu'
export { createDOTrainingDeps } from './do-gpu'
