import { execSync, spawn } from 'child_process'
import { createInterface } from 'readline'
import type { LossPoint } from '@brickbybrick/core'

export interface DOProvisionPodOpts {
  name: string
  gpu_type?: string
  region?: string
}

export interface DOTrainingDeps {
  provisionPod: (opts: DOProvisionPodOpts) => { podId: string; ip: string }
  launchTraining: (ip: string, configPath: string, datasetPath: string) => { runId: string }
  streamMetrics: (ip: string, runId: string, onPoint: (point: LossPoint) => void) => Promise<void>
  getCheckpoint: (ip: string, runId: string) => string
  terminatePod: (podId: string) => void
}

function doctl(args: string): string {
  const token = process.env.DO_API_TOKEN
  if (!token) throw new Error('DO_API_TOKEN is not set')
  return execSync(`doctl ${args} --access-token "${token}"`, { encoding: 'utf-8' }).trim()
}

function resolveGpuType(gpuType?: string): string {
  const t = gpuType || process.env.DO_GPU_TYPE || 'H100_80GB'
  const map: Record<string, string> = {
    H100_80GB: 'gpu-h100-x1-80gb',
    A100_80GB: 'gpu-a100-x1-80gb',
    L40S_48GB: 'gpu-l40s-x1-48gb',
  }
  return map[t] || t
}

function resolveRegion(): string {
  return process.env.DO_GPU_REGION || 'nyc3'
}

function resolveSshKey(): string {
  const key = process.env.DO_SSH_KEY_ID
  if (!key) throw new Error('DO_SSH_KEY_ID is not set')
  return `--ssh-keys ${key}`
}

export function provisionDroplet(opts: DOProvisionPodOpts): { podId: string; ip: string } {
  const name = opts.name
  const size = resolveGpuType(opts.gpu_type)
  const region = opts.region || resolveRegion()
  const ssh = resolveSshKey()

  const stdout = doctl(
    `compute droplet create "${name}" --size ${size} --region ${region} --image ubuntu-24-04-x64 ${ssh} --wait --format ID,PublicIPv4 --no-header`
  )
  const [podId, ip] = stdout.trim().split(/\s+/)
  return { podId, ip }
}

export function launchTrainingOnDroplet(
  ip: string,
  configPath: string,
  datasetPath: string,
): { runId: string } {
  const runId = `do-run-${Date.now()}`

  execSync(`scp -o StrictHostKeyChecking=no "${configPath}" root@${ip}:/root/train.toml`, { encoding: 'utf-8' })
  execSync(`scp -o StrictHostKeyChecking=no "${datasetPath}" root@${ip}:/root/dataset.jsonl`, { encoding: 'utf-8' })

  execSync(
    `ssh -o StrictHostKeyChecking=no root@${ip} "nohup python3 /root/train.py --config /root/train.toml --dataset /root/dataset.jsonl --run-id ${runId} > /root/train-${runId}.log 2>&1 & echo \\$!"`,
    { encoding: 'utf-8' }
  )

  return { runId }
}

export function streamDropletMetrics(
  ip: string,
  runId: string,
  onPoint: (point: LossPoint) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', [
      '-o', 'StrictHostKeyChecking=no',
      `root@${ip}`,
      `tail -f /root/train-${runId}.log`,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })

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
        // skip non-JSON lines
      }
    })

    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`DO metrics stream exited with code ${code}`))
    })
    child.on('error', reject)
  })
}

export function getDropletCheckpoint(ip: string, runId: string): string {
  const checkpointPath = `/root/checkpoint-${runId}`
  const stdout = execSync(
    `ssh -o StrictHostKeyChecking=no root@${ip} "ls -d ${checkpointPath}/*/ 2>/dev/null | sort | tail -1"`,
    { encoding: 'utf-8' }
  )
  return stdout.trim()
}

export function terminateDroplet(podId: string): void {
  doctl(`compute droplet delete ${podId} --force`)
}

export function createDOTrainingDeps(): DOTrainingDeps {
  return {
    provisionPod: provisionDroplet,
    launchTraining: launchTrainingOnDroplet,
    streamMetrics: streamDropletMetrics,
    getCheckpoint: getDropletCheckpoint,
    terminatePod: terminateDroplet,
  }
}
