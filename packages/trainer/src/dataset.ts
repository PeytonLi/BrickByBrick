import type { TrainingPair } from '@brickbybrick/core'

export function exportDataset(pairs: TrainingPair[]): string {
  return pairs.map((p) => JSON.stringify(p)).join('\n')
}
