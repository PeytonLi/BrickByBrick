import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'

import type { LossPoint, TrainingPair } from '@brickbybrick/core'
import { exportDataset } from './dataset'
import { GEMMA_LORA_TRAINER_PY } from './remote-script'

const DEFAULT_GEMMA_MODEL = 'google/gemma-4-26B-A4B-it'
const DEFAULT_GPU_TYPE = 'H100_80GB'
const DEFAULT_IMAGE = 'ubuntu_22_cuda_12'
const DEFAULT_REMOTE_ROOT = '/workspace'

export interface ProvisionPodOpts {
  name: string
  gpu_type?: string
  gpu_id?: string
  disk_size?: number
  vcpus?: number
  memory?: number
  image?: string
}

export interface PodStatus {
  id: string
  status: string
  name?: string
  ssh?: string | string[]
  ip?: string
}

interface PrimePodList {
  pods?: Array<{ id: string; name?: string; status?: string }>
}

interface PrimeAvailability {
  gpu_resources?: Array<{
    id: string
    gpu_count?: number
    price_value?: number
    stock_status?: string
  }>
}

export interface SshTarget {
  host: string
  port: string
  keyPath: string
}

export interface GemmaLoraTrainingOpts {
  pairs: TrainingPair[]
  runName?: string
  hfToken?: string
  modelId?: string
  maxSteps?: number
  gpuId?: string
  gpuType?: string
  keepPod?: boolean
  remoteRoot?: string
  /** Hugging Face Hub repo to push the trained adapter to, e.g. "user/gemma-bbb-lora". */
  hubRepo?: string
}

export interface GemmaLoraTrainingCallbacks {
  onStatus?: (status: string, detail?: string) => void
  onMetric?: (point: LossPoint) => void
  onLog?: (line: string) => void
}

export interface GemmaLoraTrainingResult {
  podId: string
  adapterPath: string
  runName: string
  /** Set when the adapter was pushed to the Hugging Face Hub. */
  hubRepo?: string
}

function repoRoot(): string {
  return join(__dirname, '..', '..', '..')
}

function loadDotEnvLocal(): Record<string, string> {
  const envPath = join(repoRoot(), '.env.local')
  if (!existsSync(envPath)) return {}

  const env: Record<string, string> = {}
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (!match) continue
    env[match[1]] = match[2]
  }
  return env
}

function commandEnv(): NodeJS.ProcessEnv {
  return { ...process.env, ...loadDotEnvLocal() }
}

function runCommand(command: string, args: string[], input?: string): string {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: commandEnv(),
    input,
    shell: process.platform === 'win32' && command === 'prime',
  })

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`${command} ${args.join(' ')} failed${output ? `: ${output}` : ''}`)
  }

  return result.stdout.toString()
}

function runPrime(args: string[]): string {
  return runCommand('prime', ['--plain', ...args])
}

function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1)) as T
    }
    throw new Error(`Unable to parse ${label} JSON`)
  }
}

function parseCreatedPodId(stdout: string): string {
  const explicit = stdout.match(/(?:successfully\s+)?created pod\s+([a-zA-Z0-9-]+)/i)
  if (explicit) return explicit[1]
  const idLike = stdout.match(/\bpod-[a-zA-Z0-9-]+\b/)
  if (idLike) return idLike[0]
  throw new Error(`Prime did not return a pod id: ${stdout.trim()}`)
}

function parseRunId(stdout: string): string {
  const parsed = stdout.trim()
  if (!parsed) throw new Error('Prime did not return a run id')
  try {
    const data = JSON.parse(parsed) as { run?: { id?: string } }
    if (data.run?.id) return data.run.id
  } catch {
    /* fall through */
  }
  return parsed.split(/\s+/)[0]
}

function numberFromStatus(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number.parseInt(value, 10)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

export function provisionPod(opts: ProvisionPodOpts): { podId: string } {
  const args = ['pods', 'create']
  const gpuId = opts.gpu_id ?? process.env.PRIME_GPU_ID ?? selectAvailableGpuId(opts.gpu_type ?? DEFAULT_GPU_TYPE)
  args.push('--id', gpuId)
  args.push(
    '--name',
    opts.name,
    '--disk-size',
    String(opts.disk_size ?? 1250),
    '--vcpus',
    String(opts.vcpus ?? 20),
    '--memory',
    String(opts.memory ?? 128),
    '--image',
    opts.image ?? DEFAULT_IMAGE,
    '--yes',
  )

  const stdout = runPrime(args)
  try {
    return { podId: parseCreatedPodId(stdout) }
  } catch {
    const byName = listPods().pods?.find((pod) => pod.name === opts.name)
    if (byName?.id) return { podId: byName.id }
    throw new Error(`Prime created no discoverable pod named ${opts.name}: ${stdout.trim()}`)
  }
}

function selectAvailableGpuId(gpuType: string): string {
  const stdout = runPrime(['availability', 'list', '--gpu-type', gpuType, '--output', 'json'])
  const availability = parseJson<PrimeAvailability>(stdout, 'availability')
  const candidates = (availability.gpu_resources ?? [])
    .filter((gpu) => (gpu.gpu_count ?? 1) === 1)
    .filter((gpu) => !gpu.stock_status || /available/i.test(gpu.stock_status))
    .sort((a, b) => (a.price_value ?? Number.POSITIVE_INFINITY) - (b.price_value ?? Number.POSITIVE_INFINITY))
  const selected = candidates[0]
  if (!selected?.id) throw new Error(`No available 1x ${gpuType} Prime GPU found`)
  return selected.id
}

function listPods(): PrimePodList {
  const stdout = runPrime(['pods', 'list', '--output', 'json'])
  return parseJson<PrimePodList>(stdout, 'pods list')
}

export function getPodStatus(podId: string): PodStatus {
  const stdout = runPrime(['pods', 'status', podId, '--output', 'json'])
  return parseJson<PodStatus>(stdout, 'pod status')
}

export async function waitForPodSsh(
  podId: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<PodStatus> {
  const intervalMs = opts.intervalMs ?? 15_000
  const timeoutMs = opts.timeoutMs ?? 20 * 60_000
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    const status = getPodStatus(podId)
    if (status.status === 'ACTIVE' && status.ssh) return status
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(`Timed out waiting for SSH on pod ${podId}`)
}

export function getPrimeSshKeyPath(): string {
  if (process.env.PRIME_SSH_KEY_PATH) return process.env.PRIME_SSH_KEY_PATH
  const envPath = loadDotEnvLocal().PRIME_SSH_KEY_PATH
  if (envPath) return envPath

  const config = runPrime(['config', 'view'])
  const match = config.match(/SSH Key Path\s+(.+)\s*$/m)
  if (match?.[1]) return match[1].replace(/\s+\(from env.*?\)\s*$/, '').trim()

  return join(homedir(), '.ssh', 'id_rsa')
}

export function parseSshTarget(ssh: string | string[], keyPath = getPrimeSshKeyPath()): SshTarget {
  const raw = Array.isArray(ssh) ? ssh[0] : ssh
  const parts = raw.trim().split(/\s+-p\s+/)
  return {
    host: parts[0].trim(),
    port: (parts[1] ?? '22').trim(),
    keyPath,
  }
}

function sshArgs(target: SshTarget, remoteCommand?: string): string[] {
  const args = [
    '-i',
    target.keyPath,
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    'UserKnownHostsFile=/dev/null',
    '-p',
    target.port,
    target.host,
  ]
  if (remoteCommand) args.push(remoteCommand)
  return args
}

function scpArgs(target: SshTarget, localPath: string, remotePath: string): string[] {
  return [
    '-i',
    target.keyPath,
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    'UserKnownHostsFile=/dev/null',
    '-P',
    target.port,
    localPath,
    `${target.host}:${remotePath}`,
  ]
}

export function copyToPod(target: SshTarget, localPath: string, remotePath: string): void {
  runCommand('scp', scpArgs(target, localPath, remotePath))
}

export function runRemote(target: SshTarget, remoteCommand: string): string {
  return runCommand('ssh', sshArgs(target, remoteCommand))
}

export function launchTraining(configPath: string, _datasetPath?: string): { runId: string } {
  const stdout = runPrime(['train', configPath, '--output', 'json', '--yes'])
  return { runId: parseRunId(stdout) }
}

export function streamMetrics(
  runId: string,
  onPoint: (point: LossPoint) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('prime', ['--plain', 'train', 'metrics', runId], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: commandEnv(),
      shell: process.platform === 'win32',
    })

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`prime train metrics exited with code ${code}: ${stderr}`))
        return
      }
      const parsed = parseJson<{ metrics?: Array<Record<string, unknown>> }>(stdout, 'metrics')
      for (const metric of parsed.metrics ?? []) {
        const step = Number(metric.step)
        const loss = Number(metric.loss ?? metric.train_loss)
        const epoch = Number(metric.epoch ?? 0)
        if (Number.isFinite(step) && Number.isFinite(loss)) onPoint({ step, loss, epoch })
      }
      resolve()
    })

    child.on('error', reject)
  })
}

export function getCheckpoint(runId: string): string {
  const stdout = runPrime(['train', 'checkpoints', runId, '--status', 'READY', '--output', 'json'])
  return stdout.trim()
}

export function terminatePod(podId: string): void {
  runPrime(['pods', 'terminate', podId, '--yes'])
}

function trainingPairToChatJsonl(pairs: TrainingPair[]): string {
  return pairs
    .map((pair) =>
      JSON.stringify({
        id: pair.id,
        messages: [
          {
            role: 'system',
            content:
              'You repair React and CSS UI implementations. Return only corrected implementation code.',
          },
          {
            role: 'user',
            content: [
              `Task: ${pair.task.prompt}`,
              `Target mechanism: ${pair.task.target_mechanism}`,
              `Acceptance criteria: ${pair.task.criteria.map((c) => `${c.id}: ${c.description}`).join('; ')}`,
              `Weak implementation:\n${pair.weak_code}`,
              `Observed defect: ${pair.defect.category} (${pair.defect.severity})`,
              `DOM trace:\n${pair.defect.dom_trace}`,
            ].join('\n\n'),
          },
          { role: 'assistant', content: pair.strong_code },
        ],
        u_score: pair.u_score,
      }),
    )
    .join('\n')
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Resolve the Hugging Face Hub repo to push the trained adapter to, from the
 * explicit option then BBB_HF_HUB_REPO in `env`. Kept pure (no disk reads) so it
 * stays unit-testable; the caller overlays .env.local onto `env`, preserving the
 * explicit option > process env > .env.local precedence. Blank/unset means no
 * push (training still completes; the adapter just isn't persisted).
 */
function resolveHubRepo(
  opts: { hubRepo?: string },
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  for (const candidate of [opts.hubRepo, env.BBB_HF_HUB_REPO]) {
    const trimmed = candidate?.trim()
    if (trimmed) return trimmed
  }
  return undefined
}

export async function runGemmaLoraTraining(
  opts: GemmaLoraTrainingOpts,
  callbacks: GemmaLoraTrainingCallbacks = {},
): Promise<GemmaLoraTrainingResult> {
  if (!opts.pairs.length) throw new Error('No training pairs supplied')

  const hfToken = opts.hfToken ?? process.env.HF_TOKEN ?? loadDotEnvLocal().HF_TOKEN
  if (!hfToken) throw new Error('HF_TOKEN is required for exact Gemma training')

  const runName = opts.runName ?? `bbb-gemma-${Date.now()}`
  const modelId = opts.modelId ?? process.env.BBB_GEMMA_MODEL ?? DEFAULT_GEMMA_MODEL
  const maxSteps = opts.maxSteps ?? Number(process.env.BBB_TRAINING_MAX_STEPS ?? 20)
  const hubRepo = resolveHubRepo(opts, { ...loadDotEnvLocal(), ...process.env })
  const localDir = mkdtempSync(join(tmpdir(), 'bbb-gemma-'))
  let podId = ''

  try {
    callbacks.onStatus?.('provisioning', runName)
    podId = provisionPod({
      name: runName,
      gpu_id: opts.gpuId,
      gpu_type: opts.gpuType ?? DEFAULT_GPU_TYPE,
    }).podId

    const status = await waitForPodSsh(podId)
    const target = parseSshTarget(status.ssh!)
    const remoteDir = `${opts.remoteRoot ?? DEFAULT_REMOTE_ROOT}/${runName}`
    const datasetPath = join(localDir, 'dataset.jsonl')
    const scriptPath = join(localDir, 'train_gemma_lora.py')
    writeFileSync(datasetPath, trainingPairToChatJsonl(opts.pairs), 'utf8')
    writeFileSync(scriptPath, GEMMA_LORA_TRAINER_PY, 'utf8')

    callbacks.onStatus?.('streaming_dataset', podId)
    runRemote(target, `mkdir -p ${shellSingleQuote(remoteDir)}`)
    copyToPod(target, datasetPath, `${remoteDir}/dataset.jsonl`)
    copyToPod(target, scriptPath, `${remoteDir}/train_gemma_lora.py`)

    callbacks.onStatus?.('training', podId)
    await streamRemoteTraining(target, {
      remoteDir,
      hfToken,
      modelId,
      maxSteps,
      hubRepo,
      onMetric: callbacks.onMetric,
      onLog: callbacks.onLog,
    })

    const adapterPath = `${remoteDir}/adapter`
    callbacks.onStatus?.('saving', adapterPath)
    // The remote script raises (→ non-zero exit → streamRemoteTraining rejects)
    // if the push fails, so reaching here means the adapter is on the Hub.
    if (hubRepo) callbacks.onStatus?.('pushed', hubRepo)
    callbacks.onStatus?.('complete', adapterPath)
    return { podId, adapterPath, runName, hubRepo }
  } finally {
    rmSync(localDir, { recursive: true, force: true })
    if (podId && !opts.keepPod) {
      try {
        terminatePod(podId)
      } catch (error) {
        callbacks.onLog?.(
          `Prime pod teardown failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }
}

async function streamRemoteTraining(
  target: SshTarget,
  opts: {
    remoteDir: string
    hfToken: string
    modelId: string
    maxSteps: number
    hubRepo?: string
    onMetric?: (point: LossPoint) => void
    onLog?: (line: string) => void
  },
): Promise<void> {
  const command = buildRemoteTrainingCommand(opts)

  await new Promise<void>((resolve, reject) => {
    const child = spawn('ssh', sshArgs(target, command), {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    const rl = createInterface({ input: child.stdout! })

    rl.on('line', (line) => {
      const trimmed = line.trim()
      if (!trimmed) return
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>
        if (parsed.type === 'metric') {
          const step = Number(parsed.step)
          const loss = Number(parsed.loss)
          const epoch = Number(parsed.epoch ?? 0)
          if (Number.isFinite(step) && Number.isFinite(loss)) {
            opts.onMetric?.({ step, loss, epoch })
          }
          return
        }
      } catch {
        /* normal dependency install output */
      }
      opts.onLog?.(trimmed)
    })

    child.stderr?.on('data', (chunk) => opts.onLog?.(chunk.toString().trim()))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Remote Gemma training exited with code ${code}`))
    })
    child.on('error', reject)
  })
}

function buildRemoteTrainingCommand(opts: {
  remoteDir: string
  hfToken: string
  modelId: string
  maxSteps: number
  hubRepo?: string
}): string {
  const pushFlag = opts.hubRepo ? ` --push-to-hub ${shellSingleQuote(opts.hubRepo)}` : ''
  return [
    'set -euo pipefail',
    'export PIP_ROOT_USER_ACTION=ignore',
    `cd ${shellSingleQuote(opts.remoteDir)}`,
    [
      'test -x .py/bin/python || (python3 - <<\'PY\'',
      'import urllib.request',
      'urllib.request.urlretrieve("https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-x86_64.sh", "/tmp/miniforge.sh")',
      'PY',
      'bash /tmp/miniforge.sh -b -p .miniconda',
      '.miniconda/bin/conda create -y -p .py python=3.10 pip)',
    ].join('\n'),
    '.py/bin/python -m pip install --upgrade pip',
    '.py/bin/python -m pip install --upgrade torch --index-url https://download.pytorch.org/whl/cu124',
    '.py/bin/python -m pip install --upgrade "transformers>=4.49.0" "datasets>=3.0.0" "accelerate>=1.2.0" "peft>=0.14.0" "trl>=0.25.0" "bitsandbytes>=0.45.0" "pillow>=11.0.0" "huggingface_hub>=0.27.0"',
    `HF_TOKEN=${shellSingleQuote(opts.hfToken)} .py/bin/python train_gemma_lora.py --dataset dataset.jsonl --output adapter --model ${shellSingleQuote(opts.modelId)} --max-steps ${opts.maxSteps}${pushFlag}`,
  ].join(' && ')
}

export const internalPrimeTestUtils = {
  parseCreatedPodId,
  parseRunId,
  parseJson,
  trainingPairToChatJsonl,
  numberFromStatus,
  buildRemoteTrainingCommand,
  resolveHubRepo,
}

import type { PrimeTrainingDeps } from './providers/prime'

export type { PrimeTrainingDeps }

export function createPrimeTrainingDeps(): PrimeTrainingDeps {
  return { provisionPod, launchTraining, streamMetrics, getCheckpoint, terminatePod }
}
