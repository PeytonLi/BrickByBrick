import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AgentEvent, LossPoint, TrainingPair } from '@brickbybrick/core'
import {
  buildTrainingConfig,
  exportDataset,
  getCheckpoint,
  launchTraining,
  provisionPod,
  streamMetrics,
  terminatePod,
  type ProvisionPodOpts,
} from '@brickbybrick/trainer'

export interface PrimeTrainingDeps {
  provisionPod: (opts: ProvisionPodOpts) => { podId: string }
  launchTraining: (configPath: string, datasetPath: string) => { runId: string }
  streamMetrics: (
    runId: string,
    onPoint: (point: LossPoint) => void,
  ) => Promise<void>
  getCheckpoint: (runId: string) => string
  terminatePod: (podId: string) => void
}

export interface PrimeTrainingOptions {
  gpuType?: string
  podName?: string
  cleanupTempFiles?: boolean
}

const realPrimeDeps: PrimeTrainingDeps = {
  provisionPod,
  launchTraining,
  streamMetrics,
  getCheckpoint,
  terminatePod,
}

function trainingEvent(event: Omit<Extract<AgentEvent, { type: 'training_event' }>, 'type'>): AgentEvent {
  return { type: 'training_event', ...event }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function runPrimeTraining(
  pairs: TrainingPair[],
  emit: (event: AgentEvent) => void,
  deps: PrimeTrainingDeps = realPrimeDeps,
  options: PrimeTrainingOptions = {},
): Promise<void> {
  if (pairs.length === 0) {
    emit({ type: 'narration', text: 'No committed pairs available; skipping Prime training.' })
    return
  }

  const gpuType = options.gpuType ?? 'H100_80GB'
  const podName = options.podName ?? `bbb-lora-${Date.now()}`
  const cleanupTempFiles = options.cleanupTempFiles ?? true
  let podId: string | null = null
  let workdir: string | null = null

  try {
    emit(trainingEvent({ status: 'provisioning', instance: podName }))
    const pod = deps.provisionPod({ name: podName, gpu_type: gpuType })
    podId = pod.podId
    emit(trainingEvent({ status: 'provisioning', instance: podId }))

    workdir = mkdtempSync(join(tmpdir(), 'bbb-training-'))
    const configPath = join(workdir, 'train.toml')
    const datasetPath = join(workdir, 'dataset.jsonl')
    writeFileSync(configPath, buildTrainingConfig(), 'utf8')
    writeFileSync(datasetPath, exportDataset(pairs), 'utf8')

    emit(trainingEvent({ status: 'streaming_dataset', instance: podId }))
    const { runId } = deps.launchTraining(configPath, datasetPath)
    emit({ type: 'narration', text: `Prime training launched: ${runId}.` })

    await deps.streamMetrics(runId, (loss) => {
      emit(trainingEvent({ status: 'training', instance: podId ?? undefined, loss }))
    })

    emit(trainingEvent({ status: 'saving', instance: podId }))
    const checkpoint = deps.getCheckpoint(runId)
    emit({ type: 'narration', text: `Prime checkpoint ready: ${checkpoint}` })
    emit(trainingEvent({ status: 'complete', instance: podId }))
  } catch (error) {
    emit(trainingEvent({ status: 'failed', instance: podId ?? podName }))
    emit({ type: 'narration', text: `Prime training failed: ${errorMessage(error)}` })
  } finally {
    if (podId) {
      try {
        deps.terminatePod(podId)
      } catch (error) {
        emit({ type: 'narration', text: `Prime pod teardown failed: ${errorMessage(error)}` })
      }
    }

    if (cleanupTempFiles && workdir) {
      rmSync(workdir, { recursive: true, force: true })
    }
  }
}
