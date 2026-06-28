# Agent E · Integration

**Owns:** `apps/web/app/api/`, `docs/`, `.env.example`, `packages/db/src/index.ts` (add exports)  
**Must not touch:** Internals of `packages/inference/src/`, `packages/trainer/src/`, `packages/core/`  
**Depends on:** A, B, C, D (runs after all four complete)  
**Master plan:** `PLAN_DO_ATLAS.md`

## What you're building

Wire every component together:
1. DB persistence into the SSE API routes
2. Training provider factory into the training route
3. DB query API routes for dashboard history
4. Complete `.env.example`
5. Updated documentation
6. Workspace config (add `packages/db` to turbo + pnpm)
7. E2E Playwright test

## Step 1: Wire DB into API routes

### `apps/web/app/api/agent/visual-loop/stream/route.ts`

**Add imports:**
```ts
import { connectDB } from '@brickbybrick/db'
import { RunModel, PairModel, EventModel } from '@brickbybrick/db'
```

**In the `start` callback of the ReadableStream (after `let bridge: ...`):**

```ts
// After let bridge: NarrationAudioBridge | null = null, add:
let runId: string | null = null
let eventSeq = 0
let committedCount = 0
const EVENT_BATCH_SIZE = 5
let eventBatch: AgentEvent[] = []

async function flushEventBatch() {
  if (eventBatch.length === 0 || !runId) return
  await EventModel.insertBatch(runId, eventBatch, eventSeq - eventBatch.length)
  eventBatch = []
}

// Inside start():
try {
  await connectDB()
  runId = crypto.randomUUID()
  await RunModel.create({
    runId,
    config: parsed.data,
    status: 'running',
    pairsCommitted: 0,
    totalIterations: 0,
  })
} catch (err) {
  emit({ type: 'narration', text: `DB connection failed: ${err}` })
  // continue without DB — degraded but not broken
}

// Modify the emitSSE wrapper:
const emitSSE = (event: AgentEvent) => {
  if (!aborted && controllerOpen) {
    controller.enqueue(encoder.encode(formatSSE(event)))
  }
}

const emit = (event: AgentEvent) => {
  emitSSE(event)
  if (event.type === 'narration') {
    bridge?.enqueue(event.text)
  }
  // Persist event
  if (runId) {
    eventBatch.push(event)
    eventSeq++
    if (eventBatch.length >= EVENT_BATCH_SIZE) {
      flushEventBatch().catch(() => {})
    }
  }
  // On pair committed
  if (event.type === 'pair_committed' && runId) {
    committedCount++
    PairModel.create({
      pairId: event.pair.id,
      runId,
      task: event.pair.task,
      weak_code: event.pair.weak_code,
      defect: event.pair.defect,
      strong_code: event.pair.strong_code,
      u_score: event.u_score,
    }).catch(() => {})
  }
}

// In finally (before bridge?.close()):
if (runId) {
  await flushEventBatch()
  await RunModel.updateOne(
    { runId },
    { status: aborted ? 'failed' : 'complete', completedAt: new Date(), pairsCommitted: committedCount }
  ).catch(() => {})
}
```

### `apps/web/app/api/training/stream/route.ts`

Wire similarly — connect DB, persist training events to the current run.

**Add imports:**
```ts
import { connectDB } from '@brickbybrick/db'
import { EventModel } from '@brickbybrick/db'
```

In the `start` callback, connect DB and persist `training_event` emissions.

### Wire training provider

In `resolveStreamMetrics()`, add DO GPU support:

```ts
// After the demo mode check, add:
import { resolveTrainingProvider, createDOTrainingDeps, createPrimeTrainingDeps } from '@brickbybrick/trainer'

// When resolving:
const provider = resolveTrainingProvider()
const deps = provider === 'do-gpu' ? createDOTrainingDeps() : createPrimeTrainingDeps()
```

Note: The current code imports `streamMetrics` directly. You'll need to adapt — the key point is that `BBB_TRAINING_PROVIDER=do-gpu` picks the DO provider. Since the DO and Prime interfaces have different shapes (DO needs `ip`), you may need a thin adapter. The simplest approach: wrap both behind a common `TrainingAdapter` interface.

## Step 2: Add DB query API routes

### `apps/web/app/api/runs/route.ts`

```ts
import { NextResponse } from 'next/server'
import { connectDB, RunModel } from '@brickbybrick/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await connectDB()
    const runs = await RunModel.find().sort({ startedAt: -1 }).limit(20).lean()
    return NextResponse.json(runs)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch runs' },
      { status: 500 }
    )
  }
}
```

### `apps/web/app/api/runs/[id]/route.ts`

```ts
import { NextResponse } from 'next/server'
import { connectDB, RunModel, PairModel, EventModel } from '@brickbybrick/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    await connectDB()
    const [run, pairs, events] = await Promise.all([
      RunModel.findOne({ runId: id }).lean(),
      PairModel.find({ runId: id }).lean(),
      EventModel.find({ runId: id }).sort({ sequence: 1 }).lean(),
    ])
    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }
    return NextResponse.json({ ...run, pairs, events })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch run' },
      { status: 500 }
    )
  }
}
```

## Step 3: Update `packages/db/src/index.ts`

Ensure these are exported (Agent A may have them but verify):
```ts
export { RunModel } from './models/run'
export { PairModel } from './models/pair'
export { EventModel } from './models/event'
export { TaskModel } from './models/task'
```

## Step 4: Update workspace config

### `pnpm-workspace.yaml`

If not already present, add `packages/db`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### `turbo.json`

If `packages/db` needs its own build step, ensure it's included. The existing `"build"` pipeline should cover it automatically if the package has a `build` script.

## Step 5: Update `.env.example`

Replace current content with:
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
# BBB_TRAINING_PROVIDER: 'prime' (default) or 'do-gpu'
DO_API_TOKEN=
DO_SSH_KEY_ID=
BBB_TRAINING_PROVIDER=prime
DO_GPU_REGION=nyc3
DO_GPU_TYPE=H100_80GB

# --- LiveKit ---
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=

# --- Prime Intellect ---
PRIME_API_KEY=
NEXT_PUBLIC_TRAINING_BUCKET_URI=

# --- MongoDB Atlas ---
MONGODB_ATLAS_URI=
MONGODB_DB_NAME=brickbybrick
```

## Step 6: Update documentation

### docs/ARCHITECTURE.md

Add after existing sections:

```markdown
## §7. MongoDB Atlas Persistence

The dashboard persists every loop run to MongoDB Atlas via `@brickbybrick/db`:
- **Runs** — one document per loop invocation (config, status, timing)
- **Pairs** — committed training pairs with utility scores
- **Events** — full AgentEvent stream for replay
- **Tasks** — task bank with usage counters

API routes: `GET /api/runs`, `GET /api/runs/:id`.

## §8. DigitalOcean Serverless Inference (Fallback)

When Gemini returns 429/5xx, the loop falls back to DO serverless inference.
Models: Claude 4.6 Sonnet (strong), Llama 3.3 70B (weak), GTE Large (embeddings).
Controlled by `DIGITALOCEAN_MODEL_ACCESS_KEY` and `DO_*_MODEL` env vars.

## §9. DigitalOcean GPU Training

Alternative to Prime Intellect for LoRA fine-tuning on GPU Droplets (H100, A100, L40S).
Controlled by `BBB_TRAINING_PROVIDER=do-gpu`. Uses `doctl` CLI for provisioning,
SSH for file transfer and metric streaming.
```

### docs/DECISIONS.md

Add at end:
```markdown
## DO + Atlas decisions (2026-06-27)

11. **MongoDB Atlas** chosen for managed persistence. Separate from DO for multi-cloud flexibility.
12. **Gemini primary, DO serverless as fallback.** Automatic on 429/5xx with narration event on switch.
13. **DO GPU Droplets as alternative to Prime Intellect.** Controlled by `BBB_TRAINING_PROVIDER` env var.
    Prime remains the default; DO GPU uses `doctl` CLI + SSH for provisioning and metric streaming.
14. **DO App Platform** for production deployment. `output: 'standalone'`, port 8080, CD from GitHub.
```

### docs/RUNBOOK.md

Add section: "Deploying to DigitalOcean" with steps for:
1. Push to GitHub (triggers CD if `app.yaml` is configured)
2. Set secrets in DO console
3. Verify deployment health

### README.md

Add a "Deployment" badge/mention: "Deployed on DigitalOcean App Platform | MongoDB Atlas"

## Step 7: E2E Playwright test

Add to `apps/web/e2e/dashboard.spec.ts`:

```ts
test('GET /api/runs returns persisted runs', async ({ request }) => {
  const res = await request.get('/api/runs')
  expect(res.status()).toBe(200)
  const data = await res.json()
  expect(Array.isArray(data)).toBe(true)
})
```

## Step 8: Final verification

```bash
# Full build
pnpm install
pnpm turbo run build type-check lint test

# Docker build (must succeed)
docker build -t bbb-web .

# Local dev smoke test
pnpm dev
# → POST /api/agent/visual-loop/stream with BBB_DEMO_MODE=1
# → GET /api/runs — should return demo runs
```

## Key rules

1. **Do NOT edit `packages/inference/src/` or `packages/trainer/src/` internals.** Only import their public exports.
2. **All API routes must use `export const runtime = 'nodejs'`** — Mongoose doesn't work in edge runtime.
3. **DB writes are fire-and-forget with `.catch(() => {})`** — don't let a DB failure crash the SSE stream.
4. **Run `pnpm install` after adding packages to workspace.**
5. **The `packages/db` package must exist before you can import from it.** If Agent A isn't done, stub the imports temporarily.
