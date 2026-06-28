# Agent D · Trainer — DO GPU Droplets

**Owns:** `packages/trainer/src/` (refactor + add `providers/`)  
**Must not touch:** `packages/core/`, `packages/inference/`, `apps/web/`  
**Depends on:** Nothing (parallel with A, B, C)  
**Master plan:** `PLAN_DO_ATLAS.md`

## What you're building

Add DO GPU Droplet training as an alternative provider alongside Prime Intellect. Keep the dependency injection pattern from `PrimeTrainingDeps`. The factory picks based on `BBB_TRAINING_PROVIDER` env var.

## Architecture

```
packages/trainer/src/
├── prime.ts              # EDIT: extract interface + factory, keep existing exports
├── config.ts             # NO CHANGE
├── dataset.ts            # NO CHANGE
├── providers/            # NEW directory
│   ├── prime.ts          # PrimeTrainingDeps implementation (moved from prime.ts)
│   ├── do-gpu.ts         # DOTrainingDeps — doctl-based GPU droplet training
│   └── index.ts          # resolveTrainingDeps() factory
├── index.ts              # EDIT: export new symbols
└── __fixtures__/         # NO CHANGE
```

## Step-by-step

### Step 1: Refactor `prime.ts` — extract interface and factory

Current `prime.ts` exports 5 functions + types. You'll keep all existing exports **unchanged** (they're imported by `packages/inference/src/training.ts`) and ADD a `createPrimeTrainingDeps()` factory.

Add to `prime.ts`:
```ts
import type { PrimeTrainingDeps } from './providers/prime'

export type { PrimeTrainingDeps }

/** Create the live Prime Intellect training deps. */
export function createPrimeTrainingDeps(): PrimeTrainingDeps {
  return { provisionPod, launchTraining, streamMetrics, getCheckpoint, terminatePod }
}
```

### Step 2: Create `providers/prime.ts`

Define the Prime deps interface (extract from `packages/inference/src/training.ts:17-26` to keep it in the trainer package):

```ts
import type { LossPoint } from '@brickbybrick/core'
import type { ProvisionPodOpts } from '../prime'

export interface PrimeTrainingDeps {
  provisionPod: (opts: ProvisionPodOpts) => { podId: string }
  launchTraining: (configPath: string, datasetPath: string) => { runId: string }
  streamMetrics: (runId: string, onPoint: (point: LossPoint) => void) => Promise<void>
  getCheckpoint: (runId: string) => string
  terminatePod: (podId: string) => void
}
```

### Step 3: Create `providers/do-gpu.ts`

```ts
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
  // Map to doctl size slugs
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

  // Copy files to droplet
  execSync(`scp -o StrictHostKeyChecking=no "${configPath}" root@${ip}:/root/train.toml`, { encoding: 'utf-8' })
  execSync(`scp -o StrictHostKeyChecking=no "${datasetPath}" root@${ip}:/root/dataset.jsonl`, { encoding: 'utf-8' })

  // Start training in background, write PID
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
  // Pull the latest checkpoint directory
  const stdout = execSync(
    `ssh -o StrictHostKeyChecking=no root@${ip} "ls -d ${checkpointPath}/*/ 2>/dev/null | sort | tail -1"`,
    { encoding: 'utf-8' }
  )
  return stdout.trim()
}

export function terminateDroplet(podId: string): void {
  doctl(`compute droplet delete ${podId} --force`)
}

/** Live DO GPU training deps. */
export function createDOTrainingDeps(): DOTrainingDeps {
  return {
    provisionPod: provisionDroplet,
    launchTraining: launchTrainingOnDroplet,
    streamMetrics: streamDropletMetrics,
    getCheckpoint: getDropletCheckpoint,
    terminatePod: terminateDroplet,
  }
}
```

### Step 4: Create `providers/index.ts`

```ts
export type TrainingProvider = 'prime' | 'do-gpu'

export function resolveTrainingProvider(): TrainingProvider {
  const val = process.env.BBB_TRAINING_PROVIDER
  if (val === 'do-gpu') return 'do-gpu'
  return 'prime'
}

export type { PrimeTrainingDeps } from './prime'
export type { DOTrainingDeps, DOProvisionPodOpts } from './do-gpu'
export { createDOTrainingDeps } from './do-gpu'
```

### Step 5: Edit `index.ts` — export new symbols

```ts
export { exportDataset } from './dataset'
export { buildTrainingConfig } from './config'
export type { TrainingConfigOpts } from './config'
export {
  provisionPod,
  launchTraining,
  streamMetrics,
  getCheckpoint,
  terminatePod,
  createPrimeTrainingDeps,
} from './prime'
export type { ProvisionPodOpts } from './prime'

// New — DO GPU provider
export {
  resolveTrainingProvider,
  createDOTrainingDeps,
} from './providers/index'
export type { TrainingProvider, PrimeTrainingDeps, DOTrainingDeps, DOProvisionPodOpts } from './providers/index'
```

**Keep all existing exports working** — `training.ts` in inference imports `provisionPod`, `launchTraining`, `streamMetrics`, `getCheckpoint`, `terminatePod`, `ProvisionPodOpts`. Do NOT remove these.

### Step 6: Tests

Create `packages/trainer/__tests__/providers/`:

#### resolve.test.ts
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolveTrainingProvider } from '../src/providers/index'

describe('resolveTrainingProvider', () => {
  const original = process.env.BBB_TRAINING_PROVIDER

  afterEach(() => {
    process.env.BBB_TRAINING_PROVIDER = original
  })

  it('returns prime when BBB_TRAINING_PROVIDER is unset', () => {
    delete process.env.BBB_TRAINING_PROVIDER
    expect(resolveTrainingProvider()).toBe('prime')
  })

  it('returns prime when BBB_TRAINING_PROVIDER=prime', () => {
    process.env.BBB_TRAINING_PROVIDER = 'prime'
    expect(resolveTrainingProvider()).toBe('prime')
  })

  it('returns do-gpu when BBB_TRAINING_PROVIDER=do-gpu', () => {
    process.env.BBB_TRAINING_PROVIDER = 'do-gpu'
    expect(resolveTrainingProvider()).toBe('do-gpu')
  })
})
```

## Key rules

1. **All existing exports from `prime.ts` must remain.** `packages/inference/src/training.ts` imports them directly.
2. **DO GPU uses `doctl` CLI** — same pattern as the current `prime` CLI calls. Shell out via `execSync` / `spawn`.
3. **`doctl` must be installed** on the machine running the trainer. The `DO_API_TOKEN` env var authenticates it.
4. **SSH key required** for droplet access — `DO_SSH_KEY_ID` is the DigitalOcean SSH key ID (not the key file path).
5. **The training script on the droplet** (`/root/train.py`) is assumed to exist on the AI/ML Ready image. You're building the CLI wrapper, not the Python script itself. The script must output JSON-lines: `{"step": N, "loss": X.XX, "epoch": N}`.
6. **Do NOT depend on `openai` or any inference package.** This is purely infrastructure.

## Environment variables (Agent E adds to .env.example)

```
BBB_TRAINING_PROVIDER=prime
DO_API_TOKEN=
DO_SSH_KEY_ID=
DO_GPU_REGION=nyc3
DO_GPU_TYPE=H100_80GB
```

## Verification

```bash
pnpm install
pnpm turbo run build --filter=@brickbybrick/trainer
pnpm turbo run type-check --filter=@brickbybrick/trainer
pnpm turbo run test --filter=@brickbybrick/trainer
```
