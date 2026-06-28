# Plan: DigitalOcean + MongoDB Atlas Integration

**Date:** 2026-06-27 | **Status:** Ready for handoff

## Summary

Four parallel workstreams add MongoDB Atlas persistence, DigitalOcean App Platform deployment, DO serverless inference as Gemini fallback, and DO GPU Droplet training alongside Prime Intellect. A fifth agent integrates everything.

| Track | What | Why |
|---|---|---|
| **A · DB** | New `packages/db/` — Mongoose connection + models | Persist loop runs, training pairs, audit events beyond ephemeral `sessionStorage` |
| **B · Deploy** | Dockerfile + App Platform config for the Next.js monorepo | Ship the dashboard to a real URL with CD + managed secrets |
| **C · Inference** | Provider abstraction + DO serverless fallback in `packages/inference` | Gemini stays primary; DO catches 429s / 503s / quota exhaustion |
| **D · Trainer** | DO GPU Droplet provider in `packages/trainer` | Add H100/A100 training option alongside Prime Intellect |
| **E · Integration** | Wire DB into API routes, update docs, verify end-to-end | Every component connects; demo runbook updated |

---

## Crew & directory ownership (disjoint)

| Agent | Owns | Brief |
|---|---|---|
| **A · DB** | `packages/db/` (new) | Mongoose connection singleton, 4 models, DB types |
| **B · Deploy** | `Dockerfile` (root), `app.yaml` (root), `.dockerignore` (root), `apps/web/next.config.ts` (1 line) | Multi-stage pnpm monorepo Dockerfile, App Spec, standalone output |
| **C · Inference** | `packages/inference/src/` | Provider interface, `providers/gemini.ts` (refactor), `providers/do-serverless.ts` (new), fallback wrapper |
| **D · Trainer** | `packages/trainer/src/` | `providers/prime.ts` (refactor), `providers/do-gpu.ts` (new), `providers/index.ts` (factory) |
| **E · Integration** | `apps/web/app/api/`, `docs/`, `.env.example`, `packages/db/src/index.ts` (exports) | Wire DB into SSE routes, update runbook, add E2E test, final env template |

No file overlap between agents. Agent B touches `next.config.ts` (one property); Agent E does not.

---

## Sequencing

```
                        ┌──────────────────────────────────────────────────┐
Plan this doc  →   A·DB  B·Deploy  C·Inference  D·Trainer  (parallel branches)
                        └──────────────────────────────────────────────────┘
                                          ↓
                                    E·Integration → main
```

1. **Plan approved** — this document is the source of truth.
2. **A, B, C, D run in parallel**, each in its own branch, TDD where sensible. They build against the frozen `@brickbybrick/core` contracts only. No agent edits `packages/core/`.
3. **E integrates last:** merges A–D branches `--no-ff`, wires DB into routes, updates docs, runs `pnpm turbo run build type-check lint test`, does a live smoke test.

---

## Agent A · DB — MongoDB Atlas Persistence (`packages/db/`)

### Package scaffold

```
packages/db/
├── package.json
├── tsconfig.json
├── src/
│   ├── connect.ts        # Mongoose connection singleton (Next.js safe)
│   ├── models/
│   │   ├── run.ts         # LoopRun — one per loop invocation
│   │   ├── pair.ts        # TrainingPair — committed pairs
│   │   ├── event.ts       # AgentEvent — all SSE events for a run
│   │   ├── task.ts        # VisualTask bank
│   │   └── index.ts       # Barrel + model registration
│   ├── types.ts           # DB-specific types (not in core — frozen)
│   └── index.ts           # Public exports
└── __tests__/
    ├── connect.test.ts
    ├── run.test.ts
    └── pair.test.ts
```

### Dependencies

- `mongoose` (latest v8)
- `@brickbybrick/core` (workspace:*, read-only — imports Zod schemas for type alignment)
- `mongodb-memory-server` (devDependency, for tests)

### Models

| Collection | Mongoose model | Mirrors core type | Key indexes |
|---|---|---|---|
| `runs` | `RunModel` | New (DB-only): `{ runId, config: GenerationConfig, status, startedAt, completedAt, pairsCommitted, totalIterations }` | `{ runId: 1 }` unique, `{ startedAt: -1 }` |
| `pairs` | `PairModel` | `TrainingPair` + `{ runId, createdAt }` | `{ pairId: 1 }` unique, `{ runId: 1 }`, `{ 'task.target_mechanism': 1 }`, `{ u_score: -1 }` |
| `events` | `EventModel` | `AgentEvent` + `{ runId, sequence, timestamp }` | `{ runId: 1, sequence: 1 }` |
| `taskbank` | `TaskModel` | `VisualTask` + `{ createdAt, timesUsed }` | `{ id: 1 }` unique, `{ target_mechanism: 1 }` |

### Connection singleton

```ts
// packages/db/src/connect.ts
import mongoose from 'mongoose'

declare global { var __bbbMongoose: typeof mongoose | undefined }

export async function connectDB(): Promise<typeof mongoose> {
  if (globalThis.__bbbMongoose?.connection.readyState === 1) return globalThis.__bbbMongoose
  const uri = process.env.MONGODB_ATLAS_URI
  if (!uri) throw new Error('MONGODB_ATLAS_URI is not set')
  globalThis.__bbbMongoose = await mongoose.connect(uri, {
    dbName: process.env.MONGODB_DB_NAME || 'brickbybrick',
  })
  return globalThis.__bbbMongoose
}

export async function disconnectDB(): Promise<void> {
  if (globalThis.__bbbMongoose) {
    await globalThis.__bbbMongoose.disconnect()
    delete globalThis.__bbbMongoose
  }
}
```

### Key design decisions

- Mongoose schemas are **additive** — they include `runId`, `sequence`, timestamps not in core Zod types. Core schemas remain frozen.
- Connection uses the `globalThis` pattern to survive Next.js hot-reload (avoids connection pool exhaustion in dev).
- Tests use `mongodb-memory-server` for in-memory MongoDB (no Atlas dependency during `pnpm test`).
- Models provide static helper methods: `PairModel.byRun(runId)`, `RunModel.latest()`, `EventModel.forRun(runId)`.

### Environment variables added

```
MONGODB_ATLAS_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=brickbybrick
```

### Verification

- `pnpm turbo run build type-check test` green from `packages/db/`
- Connection singleton reuses connection across hot reloads (unit test)
- Models can CRUD (unit tests with memory server)

---

## Agent B · Deploy — DO App Platform (`Dockerfile`, `app.yaml`, root config)

### Files created/modified

| File | Action | Purpose |
|---|---|---|
| `Dockerfile` (repo root) | **Create** | Multi-stage build for pnpm monorepo Next.js |
| `.dockerignore` (repo root) | **Create** | Exclude `node_modules`, `.next`, `.turbo`, `__fixtures__` |
| `app.yaml` (repo root) | **Create** | DO App Platform app spec |
| `apps/web/next.config.ts` | **Edit** | Add `output: 'standalone'` |

### Dockerfile (pnpm monorepo, multi-stage)

```dockerfile
# Stage 1: deps
FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY package.json turbo.json tsconfig.json ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/inference/package.json packages/inference/
COPY packages/trainer/package.json packages/trainer/
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile

# Stage 2: build
FROM deps AS builder
WORKDIR /app
ARG NEXT_PUBLIC_TRAINING_BUCKET_URI
ENV NEXT_PUBLIC_TRAINING_BUCKET_URI=$NEXT_PUBLIC_TRAINING_BUCKET_URI
RUN pnpm turbo run build --filter=@brickbybrick/web

# Stage 3: runner
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
USER nextjs
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
```

### .dockerignore

```
node_modules
.next
.turbo
.git
__fixtures__
**/__fixtures__/**
.env
.env.*
*.md
!README.md
.gitignore
```

### app.yaml

```yaml
name: brickbybrick
services:
  - name: web
    github:
      repo: <your-org>/BrickByBrick
      branch: main
      deploy_on_push: true
    dockerfile_path: Dockerfile
    http_port: 8080
    instance_count: 1
    instance_size_slug: basic-s
    envs:
      - key: GEMINI_API_KEY
        scope: RUN_TIME
        type: SECRET
      - key: ANTIGRAVITY_AGENT
        scope: RUN_TIME
        value: antigravity-preview-05-2026
      - key: GEMINI_LIVE_MODEL
        scope: RUN_TIME
        value: gemini-live-2.5-flash-preview
      - key: GEMINI_LIVE_SAMPLE_RATE
        scope: RUN_TIME
        value: "24000"
      - key: LIVEKIT_URL
        scope: RUN_TIME
        type: SECRET
      - key: LIVEKIT_API_KEY
        scope: RUN_TIME
        type: SECRET
      - key: LIVEKIT_API_SECRET
        scope: RUN_TIME
        type: SECRET
      - key: PRIME_API_KEY
        scope: RUN_TIME
        type: SECRET
      - key: NEXT_PUBLIC_TRAINING_BUCKET_URI
        scope: RUN_TIME
        type: SECRET
      - key: STRONG_MODEL
        scope: RUN_TIME
        value: gemini-3.1-pro-preview
      - key: WEAK_MODEL
        scope: RUN_TIME
        value: gemma-4-26b-a4b-it
      - key: GEMINI_EMBED_MODEL
        scope: RUN_TIME
        value: gemini-embedding-001
      - key: DIGITALOCEAN_MODEL_ACCESS_KEY
        scope: RUN_TIME
        type: SECRET
      - key: DO_API_TOKEN
        scope: RUN_TIME
        type: SECRET
      - key: MONGODB_ATLAS_URI
        scope: RUN_TIME
        type: SECRET
      - key: MONGODB_DB_NAME
        scope: RUN_TIME
        value: brickbybrick
      - key: BBB_DEMO_MODE
        scope: RUN_TIME
        value: "0"
```

### next.config.ts change

Add `output: AppPlatform` after `outputFileTracingRoot`:
```ts
output: 'standalone',
```

### Verification

- `docker build -t bbb-web .` succeeds
- `docker run -p 8080:8080 --env-file .env.local bbb-web` — dashboard loads at `http://localhost:8080`
- `pnpm turbo run build` still green (standalone output shouldn't break local dev)

---

## Agent C · Inference — DO Serverless Fallback (`packages/inference/src/`)

### Goal

Add a provider abstraction so the loop can use Gemini (primary) with automatic fallback to DO serverless inference. No changes to the loop or prompts — just the client layer.

### Architecture

```
packages/inference/src/
├── gemini.ts          # EDIT: extract generateContent/embed/weakSolver/strongSolver into provider interface
├── providers/
│   ├── interface.ts   # NEW: ModelProvider, EmbedProvider interfaces
│   ├── gemini.ts      # NEW: refactored Gemini client (current gemini.ts → here)
│   ├── do-serverless.ts # NEW: DO serverless client (OpenAI-compatible)
│   └── fallback.ts    # NEW: FallbackProvider — tries primary, catches errors, tries fallback
├── prompts.ts         # NO CHANGE
├── antigravity.ts     # NO CHANGE
├── loop.ts            # MINIMAL CHANGE: accept optional provider overrides in defaultDeps()
├── metrics.ts         # NO CHANGE
├── training.ts        # NO CHANGE
└── index.ts           # EDIT: export new provider symbols
```

### Provider interfaces (`providers/interface.ts`)

```ts
import type { VisualTask, Defect } from '@brickbybrick/core'

export interface ChatProvider {
  generate(model: string, systemPrompt: string, userPrompt: string): Promise<string>
}

export interface EmbedProvider {
  embed(text: string): Promise<number[]>
}

export interface SolverSet {
  weakSolver: (task: VisualTask) => Promise<string>
  strongSolver: (task: VisualTask, defect: Defect, weakCode?: string) => Promise<string>
  embed: (text: string) => Promise<number[]>
  challenger: (systemPrompt: string) => Promise<string>
}
```

### DO serverless provider (`providers/do-serverless.ts`)

- Base URL: `https://inference.do-ai.run/v1/`
- Auth: `Bearer $DIGITALOCEAN_MODEL_ACCESS_KEY`
- OpenAI-compatible (uses `openai` npm SDK)
- Model mapping (env-configurable):

| Role | Env var | Default DO model |
|---|---|---|
| Strong solver | `DO_STRONG_MODEL` | `anthropic-claude-4.6-sonnet` |
| Weak solver | `DO_WEAK_MODEL` | `llama3.3-70b-instruct` |
| Embeddings | `DO_EMBED_MODEL` | `gte-large` |

### Fallback provider (`providers/fallback.ts`)

```ts
export function createFallbackSolverSet(
  primary: SolverSet,
  fallback: SolverSet,
  onFallback?: (method: string, err: Error) => void,
): SolverSet
```

- Wraps each method with try/catch
- On 429, 500, 503, or timeout → calls `onFallback` callback and retries with fallback
- Embedding fallback uses DO's `gte-large` or `qwen3-embedding-0.6b`

### Changes to `defaultDeps()` in `loop.ts`

Add optional provider injection:

```ts
export function defaultDeps(opts?: { solverSet?: SolverSet }): VisualLoopDeps {
  const solver = opts?.solverSet ?? createProductionSolverSet()
  return {
    challenge: async (config) => {
      const raw = await solver.challenger(buildChallengerPrompt(config))
      return VisualTaskSchema.parse(safeJson(raw))
    },
    weakSolver: solver.weakSolver,
    strongSolver: (task, defect, weakCode) => solver.strongSolver(task, defect, weakCode),
    embed: solver.embed,
    // ... rest unchanged
  }
}
```

### Environment variables added

```
DIGITALOCEAN_MODEL_ACCESS_KEY=
DO_STRONG_MODEL=anthropic-claude-4.6-sonnet
DO_WEAK_MODEL=llama3.3-70b-instruct
DO_EMBED_MODEL=gte-large
```

### Verification

- `pnpm turbo run build type-check test` green from `packages/inference/`
- Unit tests: mock Gemini returns 429 → fallback to DO succeeds
- Unit tests: both providers fail → error propagates
- DO client sends correct OpenAI-compatible payloads (validation test)

---

## Agent D · Trainer — DO GPU Droplets (`packages/trainer/src/`)

### Goal

Add DO GPU Droplet training as an alternative provider alongside Prime Intellect. Keep the DI pattern; add `DOTrainingDeps`. The factory picks the provider based on `BBB_TRAINING_PROVIDER` env var.

### Architecture

```
packages/trainer/src/
├── prime.ts          # REFACTOR: extract PrimeDeps (clean DI boundary)
├── config.ts         # NO CHANGE (TOML config same for both providers)
├── dataset.ts        # NO CHANGE
├── providers/
│   ├── prime.ts      # NEW: current prime.ts logic, refactored into PrimeTrainingDeps shape
│   ├── do-gpu.ts     # NEW: DO GPU droplet provisioning, training, metrics streaming
│   └── index.ts      # NEW: factory — picks provider based on BBB_TRAINING_PROVIDER
├── index.ts          # EDIT: export new provider symbols
└── __fixtures__/     # NO CHANGE
```

### DO GPU provider (`providers/do-gpu.ts`)

Implements the same logical interface as Prime but with DO's API:

| Prime operation | DO equivalent |
|---|---|
| `provisionPod({ name, gpu_type })` | `doctl compute droplet create` or DO API v2 — GPU Droplet with AI/ML Ready image |
| `launchTraining(configPath, datasetPath)` | SCP dataset + config to droplet, SSH execute training script (HuggingFace `trl` + `peft`) |
| `streamMetrics(runId, onPoint)` | SSH tail or HTTP endpoint on droplet streaming JSON-lines loss data |
| `getCheckpoint(runId)` | SCP download checkpoint from droplet |
| `terminatePod(podId)` | `doctl compute droplet delete` or DELETE `/droplets/{id}` |

Implementation approach:
- Use `doctl` CLI (same pattern as current `prime` CLI calls) — shell out via `execSync` / `spawn`
- SSH key for droplet access via `DO_SSH_KEY_ID` env var
- Training script: a Python script uploaded to the droplet that runs LoRA fine-tuning with `peft` + `transformers` + `datasets`, outputs JSON-lines loss metrics to stdout
- Droplet uses an AI/ML Ready image (pre-installed CUDA, PyTorch, Transformers)

### New types

```ts
export interface DOTrainingDeps {
  provisionPod: (opts: DOProvisionPodOpts) => { podId: string; ip: string }
  launchTraining: (ip: string, configPath: string, datasetPath: string) => { runId: string }
  streamMetrics: (ip: string, runId: string, onPoint: (p: LossPoint) => void) => Promise<void>
  getCheckpoint: (ip: string, runId: string) => string
  terminatePod: (podId: string) => void
}

export interface DOProvisionPodOpts {
  name: string
  gpu_type?: 'H100_80GB' | 'A100_80GB' | 'L40S_48GB'
  region?: string
}
```

### Factory (`providers/index.ts`)

```ts
export type TrainingProvider = 'prime' | 'do-gpu'

export function resolveTrainingProvider(): TrainingProvider {
  return (process.env.BBB_TRAINING_PROVIDER as TrainingProvider) || 'prime'
}
```

Agent E wires this into `runPrimeTraining` via dependency injection.

### Environment variables added

```
BBB_TRAINING_PROVIDER=prime
DO_API_TOKEN=
DO_SSH_KEY_ID=
DO_GPU_REGION=nyc3
DO_GPU_TYPE=H100_80GB
```

### Verification

- `pnpm turbo run build type-check test` green from `packages/trainer/`
- Unit test: resolveTrainingProvider() returns 'prime' when unset, 'do-gpu' when set
- DO CLI commands constructed correctly (unit test with DRY_RUN mock)

---

## Agent E · Integration

### Scope

Wire everything together after A–D land. Agent E owns the integration surface but must not edit `packages/inference/src/` or `packages/trainer/src/` internals — only wire their public exports.

### Tasks

#### 1. Wire DB into API routes

**`apps/web/app/api/agent/visual-loop/stream/route.ts`**
- Call `connectDB()` at stream start
- Create a `RunModel` document on loop start
- After each `pair_committed` event → upsert into `PairModel`
- After loop completes → update `RunModel.status = 'complete'`, record totals
- On abort/error → update `RunModel.status = 'failed'`
- Stream events into `EventModel` (batch-write every 5 events)

**`apps/web/app/api/training/stream/route.ts`**
- Call `connectDB()` at stream start
- Persist `training_event` emissions to the current run

#### 2. Wire training provider

Use `resolveTrainingProvider()` from trainer to pick Prime or DO GPU.

#### 3. Add DB query API routes

```
apps/web/app/api/runs/route.ts        # GET: list recent runs
apps/web/app/api/runs/[id]/route.ts   # GET: single run with pairs + events
```

#### 4. Update environment template

`.env.example` — add all new env vars from A, B, C, D with comments.

#### 5. Update documentation

- `docs/ARCHITECTURE.md` — add § for DB layer, DO serverless, DO GPU training
- `docs/DECISIONS.md` — record decisions from this plan
- `docs/RUNBOOK.md` — add DO deployment steps, "verify DO fallback" section
- `README.md` — add deployment mention

#### 6. Update workspace config

- Add `packages/db` to `pnpm-workspace.yaml`
- Ensure `turbo.json` build pipeline includes `packages/db`

#### 7. E2E verification

- Add Playwright test: `GET /api/runs` returns 200 with array
- Confirm `pnpm turbo run build type-check lint test` is green across all packages

### Verification

- `pnpm turbo run build type-check lint test` green
- Playwright e2e tests pass
- Live smoke test: run a loop, verify documents appear in Atlas
- Docker build succeeds (includes `packages/db`)

---

## Environment variables — complete inventory

```bash
# --- Gemini (primary inference) ---
GEMINI_API_KEY=
ANTIGRAVITY_AGENT=antigravity-preview-05-2026
GEMINI_LIVE_MODEL=gemini-live-2.5-flash-preview
GEMINI_LIVE_SAMPLE_RATE=24000
STRONG_MODEL=gemini-3.1-pro-preview
WEAK_MODEL=gemma-4-26b-a4b-it
GEMINI_EMBED_MODEL=gemini-embedding-001

# --- DigitalOcean Serverless Inference (fallback) ---
DIGITALOCEAN_MODEL_ACCESS_KEY=
DO_STRONG_MODEL=anthropic-claude-4.6-sonnet
DO_WEAK_MODEL=llama3.3-70b-instruct
DO_EMBED_MODEL=gte-large

# --- DigitalOcean GPU Training ---
DO_API_TOKEN=
DO_SSH_KEY_ID=
BBB_TRAINING_PROVIDER=prime
DO_GPU_REGION=nyc3
DO_GPU_TYPE=H100_80GB

# --- LiveKit ---
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=

# --- Prime Intellect (keep as option) ---
PRIME_API_KEY=
NEXT_PUBLIC_TRAINING_BUCKET_URI=

# --- MongoDB Atlas ---
MONGODB_ATLAS_URI=
MONGODB_DB_NAME=brickbybrick
```

---

## Risk & mitigations

| Risk | Mitigation |
|---|---|
| Agent E touches files owned by A–D → merge conflicts | Agent E only wires public exports and touches `apps/web/app/api/` + `docs/` (disjoint from A–D) |
| DO serverless latency vs Gemini | Fallback is exceptional (only on errors); primary path unchanged |
| DO GPU droplet provisioning lag | Pre-warm same as Prime; the `streamMetrics` pattern is identical |
| Mongoose in Next.js edge runtime | API routes use `export const runtime = 'nodejs'` — already set |
| pnpm monorepo Dockerfile complexity | Multi-stage build proven pattern; Agent B tests with `docker build` |
| Atlas connection from DO App Platform | Both are public internet; TLS enabled; connection string in secrets |

---

## Definition of done

- `pnpm turbo run build type-check lint test` green across all 5 packages + web
- Docker image builds and serves dashboard on port 8080
- Dashboard loops persist to Atlas; runs/pairs queryable via API
- Gemini 429/503 → DO serverless fallback activates (unit-test validated)
- `BBB_TRAINING_PROVIDER=do-gpu` → droplet provisioning commands constructed correctly
- Playwright e2e: `GET /api/runs` returns persisted data
- `.env.example` complete with all new vars
- `docs/` updated: ARCHITECTURE, DECISIONS, RUNBOOK
