import { execSync, spawn } from 'child_process'
import { createInterface } from 'readline'

export interface ProvisionPodOpts {
  name: string
  gpu_type?: string
}

export function provisionPod(opts: ProvisionPodOpts): { podId: string } {
  const args = ['pods', 'create', '--name', opts.name]
  if (opts.gpu_type) args.push('--gpu-type', opts.gpu_type)

  const stdout = execSync(`prime ${args.join(' ')}`, { encoding: 'utf-8' })
  const podId = stdout.toString().trim().split(/\s+/)[0]
  return { podId }
}

export function launchTraining(configPath: string, datasetPath: string): { runId: string } {
  const stdout = execSync(`prime train ${configPath} --dataset ${datasetPath}`, {
    encoding: 'utf-8',
  })
  const runId = stdout.toString().trim().split(/\s+/)[0]
  return { runId }
}

export function streamMetrics(
  runId: string,
  onPoint: (point: { step: number; loss: number; epoch: number }) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('prime', ['train', 'metrics', runId], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const rl = createInterface({ input: child.stdout! })

    rl.on('line', (line) => {
      const trimmed = line.trim()
      if (!trimmed) return
      try {
        const parsed = JSON.parse(trimmed)
        if (
          typeof parsed.step === 'number' &&
          typeof parsed.loss === 'number' &&
          typeof parsed.epoch === 'number'
        ) {
          onPoint({ step: parsed.step, loss: parsed.loss, epoch: parsed.epoch })
        }
      } catch {
        // skip malformed lines
      }
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`prime train metrics exited with code ${code}`))
      }
    })

    child.on('error', reject)
  })
}

export function getCheckpoint(runId: string): string {
  const stdout = execSync(`prime train checkpoints ${runId}`, { encoding: 'utf-8' })
  return stdout.toString().trim()
}

export function terminatePod(podId: string): void {
  execSync(`prime pods terminate ${podId}`, { encoding: 'utf-8' })
}
