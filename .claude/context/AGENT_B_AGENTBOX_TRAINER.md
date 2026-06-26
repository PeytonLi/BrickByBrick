# Feature Agent B — packages/agentbox + packages/trainer

## Context

You are Feature Agent B for BrickByBrick. The monorepo scaffold already exists. You are in a git worktree on branch `feat/agentbox-trainer`. Read `.claude/context/ARCHITECTURE.md` for full system context.

**Your scope**: `packages/agentbox` and `packages/trainer` only.

## Part 1: packages/agentbox

### Finding the SDK

The user has downloaded the GMI Cloud AgentBox SDK. Check:
1. `~/Downloads/` for any `.tgz` or directory with "agentbox" in the name
2. Run `npm search agentbox` or check `https://www.npmjs.com/search?q=agentbox+gmi`
3. Check if there's a Python package (`pip show agentbox`)

If the SDK is a local `.tgz`, add it to package.json as:
```json
"agentbox-sdk": "file:~/Downloads/agentbox-x.x.x.tgz"
```

**If you cannot locate the SDK**, implement a complete mock that satisfies the interface contract. The mock must be enabled when `process.env.AGENTBOX_MOCK === 'true'` and the real SDK used otherwise. The integration agent will wire in the real SDK later.

### Interface Contract

Export these functions from `packages/agentbox/src/index.ts`:

```ts
export interface AgentBoxEnvironment {
  id: string
  status: 'creating' | 'ready' | 'destroyed'
}

export interface CodeExecutionResult {
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
}

export interface IngestResult {
  chunks: string[]        // semantic text chunks from the document
  chunkCount: number
  embeddings: number[][]  // one embedding vector per chunk (from Nebius embedding model)
}

// Create an isolated sandbox environment
export async function createEnvironment(): Promise<AgentBoxEnvironment>

// Execute Python code in the environment, return result
export async function executeCode(
  env: AgentBoxEnvironment,
  code: string,
  timeoutMs?: number,
): Promise<CodeExecutionResult>

// Parse and embed a document (PDF buffer or markdown string)
export async function ingestDocument(
  env: AgentBoxEnvironment,
  content: Buffer | string,
  mimeType: 'application/pdf' | 'text/markdown' | 'application/json',
): Promise<IngestResult>

// Find top-k most semantically relevant chunks for a query
export async function queryChunks(
  queryEmbedding: number[],
  chunks: string[],
  embeddings: number[][],
  topK: number,
): Promise<string[]>

// Destroy the environment when done
export async function destroyEnvironment(env: AgentBoxEnvironment): Promise<void>
```

### Mock Implementation

The mock must return realistic-looking data:
- `createEnvironment()` → `{ id: 'mock-env-' + uuid, status: 'ready' }`
- `executeCode(env, code)` → parse the code and if it contains `assert` or `==`, return `{ exitCode: 0, stdout: 'OK', stderr: '', durationMs: 42 }` (simulate success). Occasionally return `exitCode: 1` to simulate real failures.
- `ingestDocument()` → split text by paragraph, return mock embeddings (random vectors of dim 1536)
- `queryChunks()` → return the first topK chunks (no real similarity in mock)

### packages/agentbox/src/client.ts

Route to real vs mock based on env var:

```ts
import { createEnvironment as realCreate, ... } from './real-sdk'
import { createEnvironment as mockCreate, ... } from './mock'

const isMock = process.env.AGENTBOX_MOCK === 'true' || !process.env.AGENTBOX_API_KEY

export const createEnvironment = isMock ? mockCreate : realCreate
// ... same pattern for all functions
```

---

## Part 2: packages/trainer

### packages/trainer/src/prime-intellect.ts

Export:

```ts
export interface TrainConfig {
  modelName: string       // e.g. "Qwen/Qwen2.5-7B-Instruct"
  datasetPath: string     // local path to .jsonl file
  loraRank: number        // default 16
  epochs: number          // default 3
  batchSize: number       // default 4
  learningRate: number    // default 2e-4
  outputDir: string       // where to save weights
}

export interface TrainingEvent {
  type: 'provisioning' | 'training' | 'loss' | 'complete' | 'error'
  message: string
  step?: number
  totalSteps?: number
  trainLoss?: number
  valLoss?: number
  downloadUrl?: string
}

// Write train.toml and execute `prime train run configs/train.toml`
// Yields TrainingEvents as the job progresses
export async function* startTraining(
  config: TrainConfig,
): AsyncGenerator<TrainingEvent>
```

Implementation:
1. Write `configs/train.toml` with the provided config
2. Spawn `prime train run configs/train.toml` via `child_process.spawn`
3. Parse stdout line by line — look for patterns like `loss=0.42`, `step=10/100`, `Epoch 2/3`
4. Yield `TrainingEvent` objects from parsed output
5. On process exit code 0, yield `{ type: 'complete', downloadUrl: '...' }`
6. **Fallback**: if `prime` is not in PATH, yield mock events:
   - `{ type: 'provisioning', message: 'Allocating RTX 4090 spot node...' }` (2s delay)
   - `{ type: 'provisioning', message: 'Node ready. Distributing dataset...' }` (1s delay)
   - Then stream 100 loss steps with loss decreasing from 0.95 to 0.12 (simulate training)
   - `{ type: 'complete', downloadUrl: 'https://prime-intellect.ai/models/brickbybrick-lora-v1' }`

### packages/trainer/src/dataset.ts

```ts
import * as fs from 'fs'
import * as path from 'path'
import type { TrainingPair } from '@brickbybrick/core'

// Convert TrainingPair[] to the JSONL format Prime Intellect expects
export function exportDataset(pairs: TrainingPair[], outputPath: string): string {
  const lines = pairs
    .filter(p => p.filter_gate)
    .map(p => JSON.stringify({
      messages: [
        { role: 'user', content: p.question },
        { role: 'assistant', content: `${p.ground_truth_cot}\n\nAnswer: ${p.ground_truth_answer}` }
      ]
    }))
  
  const fullPath = path.resolve(outputPath)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, lines.join('\n'))
  return fullPath
}
```

### packages/trainer/src/index.ts

```ts
export * from './prime-intellect'
export * from './dataset'
```

## Build Check

`pnpm --filter @brickbybrick/agentbox type-check && pnpm --filter @brickbybrick/trainer type-check`

## Commit

`git add -A && git commit -m "feat(agentbox,trainer): SDK wrapper, mock, Prime Intellect trainer"`
