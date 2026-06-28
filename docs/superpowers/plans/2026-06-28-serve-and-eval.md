# Serve & Before/After Eval (Feature C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a training run, serve the fine-tuned model (base Gemma + new LoRA) and prove it improved via a user-triggered, paired before/after eval through the existing Antigravity auditor, with a side-by-side "try it" box.

**Architecture:** Reuse the training GPU pod: `runGemmaLoraTraining` already supports `keepPod`. A new `serveAdapter` starts a vLLM OpenAI-compatible server on the pod (base + LoRA) and schedules its own TTL teardown. `inferOnModel` talks to it. `runEval` generates K held-out tasks, infers base+tuned, audits both with the existing auditor, scores via S(M,T,C), and aggregates win/tie/loss + mean delta. Two routes (`/api/eval/stream`, `/api/model/infer`) and a serve registry on `RunModel` expose this to the dashboard.

**Tech Stack:** TypeScript, Zod, Next.js route handlers, Mongoose, vLLM (remote), Prime CLI over SSH, Vitest.

## Global Constraints

- Additive `@brickbybrick/core` changes only; existing consumers must keep working.
- Front-end-UI domain only; eval reuses the existing Antigravity auditor — do NOT add a new verifier.
- **Every served pod must terminate**: `serveAdapter` schedules a TTL `pkill`/teardown so a forgotten "try it" cannot leak GPU spend (same discipline as the `destroyInteraction` fix).
- Eval is **user-triggered**, never automatic.
- Every route supports `BBB_DEMO_MODE=1` deterministic stubs.
- Model ids via env (`BBB_GEMMA_MODEL`, `STRONG_MODEL()`); never hardcode.
- Pure command builders are unit-tested via `internalPrimeTestUtils` (mirror `buildRemoteTrainingCommand`); I/O orchestration is integration-tested.
- Run commands from repo root `C:\Users\lipey\Code\BrickByBrick`.

---

### Task 1: Core contract — eval report + serving/eval events

**Files:**
- Modify: `packages/core/src/schemas.ts`
- Test: `packages/core/src/schemas.test.ts`

**Interfaces:**
- Produces: `EvalTaskResult`, `EvalReport` types; `AgentEvent` variants `eval_started { k }`, `eval_task_result { result }`, `eval_complete { report }`, `model_serving { url, expires_at, pod_id, base_model }`.

- [ ] **Step 1: Write the failing test**

```ts
// add to packages/core/src/schemas.test.ts
import { EvalReportSchema, AgentEventSchema } from './schemas'

describe('Eval contracts (Feature C)', () => {
  const result = {
    task: { id: 't', prompt: 'p', target_mechanism: 'm', criteria: [{ id: 'c', description: 'd', weight: 1 }] },
    base_score: 0.2, tuned_score: 0.8,
    base_passed_criteria: [], tuned_passed_criteria: ['c'], winner: 'tuned' as const,
  }
  it('parses an EvalReport', () => {
    const r = EvalReportSchema.parse({
      runId: 'r', k: 1, base_model: 'g', tuned_model: 'tuned',
      wins: 1, ties: 0, losses: 0, mean_score_delta: 0.6, tasks: [result],
    })
    expect(r.wins).toBe(1)
  })
  it('parses eval + serving events', () => {
    expect(AgentEventSchema.parse({ type: 'eval_started', k: 3 }).type).toBe('eval_started')
    expect(AgentEventSchema.parse({ type: 'eval_task_result', result }).type).toBe('eval_task_result')
    expect(AgentEventSchema.parse({
      type: 'model_serving', url: 'http://x/v1', expires_at: 'z', pod_id: 'p', base_model: 'g',
    }).type).toBe('model_serving')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @brickbybrick/core test -- schemas`
Expected: FAIL — `EvalReportSchema` undefined.

- [ ] **Step 3: Add schemas + events**

Add to `schemas.ts` (after the TrainingPair section):
```ts
export const EvalTaskResultSchema = z.object({
  task: VisualTaskSchema,
  base_score: z.number(),
  tuned_score: z.number(),
  base_passed_criteria: z.array(z.string()),
  tuned_passed_criteria: z.array(z.string()),
  winner: z.enum(['base', 'tuned', 'tie']),
  inconclusive: z.boolean().optional(),
})
export type EvalTaskResult = z.infer<typeof EvalTaskResultSchema>

export const EvalReportSchema = z.object({
  runId: z.string(),
  k: z.number().int().nonnegative(),
  base_model: z.string(),
  tuned_model: z.string(),
  wins: z.number().int().nonnegative(),
  ties: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  mean_score_delta: z.number(),
  tasks: z.array(EvalTaskResultSchema),
})
export type EvalReport = z.infer<typeof EvalReportSchema>
```
Add these members to the `AgentEventSchema` union:
```ts
  z.object({ type: z.literal('eval_started'), k: z.number().int().nonnegative() }),
  z.object({ type: z.literal('eval_task_result'), result: EvalTaskResultSchema }),
  z.object({ type: z.literal('eval_complete'), report: EvalReportSchema }),
  z.object({
    type: z.literal('model_serving'),
    url: z.string(),
    expires_at: z.string(),
    pod_id: z.string(),
    base_model: z.string(),
  }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @brickbybrick/core test -- schemas`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schemas.ts packages/core/src/schemas.test.ts
git commit -m "feat(core): eval report + eval/serving AgentEvents (Feature C)"
```

---

### Task 2: `inferOnModel` — OpenAI-compatible client

**Files:**
- Create: `packages/inference/src/serving.ts`
- Modify: `packages/inference/src/index.ts` (`export * from './serving'`)
- Test: `packages/inference/src/serving.test.ts`

**Interfaces:**
- Consumes: `withRetry`, `RetryOptions` from `./gemini`.
- Produces: `inferOnModel(serveUrl: string, model: string, prompt: string, opts?: RetryOptions): Promise<string>`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/inference/src/serving.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { inferOnModel } from './serving'

afterEach(() => vi.unstubAllGlobals())

describe('inferOnModel', () => {
  it('POSTs chat/completions and returns the message content', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: '<div/>' } }] }),
      text: async () => '',
    }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await inferOnModel('http://pod:8000/v1', 'tuned', 'Build X', { sleep: async () => {} })
    expect(out).toBe('<div/>')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://pod:8000/v1/chat/completions')
    expect(JSON.parse((init as RequestInit).body as string).model).toBe('tuned')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @brickbybrick/inference test -- serving`
Expected: FAIL — `./serving` not found.

- [ ] **Step 3: Write `serving.ts`**

```ts
// packages/inference/src/serving.ts
import { withRetry, type RetryOptions } from './gemini'

/** Call a vLLM OpenAI-compatible server. `model` is the served name
 *  (the base model id, or the lora-module name e.g. "tuned"). */
export async function inferOnModel(
  serveUrl: string,
  model: string,
  prompt: string,
  opts: RetryOptions = {},
): Promise<string> {
  const base = serveUrl.replace(/\/$/, '')
  return withRetry(async () => {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You implement front-end UI. Return only code.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 2048,
      }),
    })
    if (!res.ok) throw new Error(`infer ${model} → ${res.status}: ${await res.text()}`)
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return data.choices?.[0]?.message?.content ?? ''
  }, opts)
}
```
Add to `packages/inference/src/index.ts`: `export * from './serving'`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @brickbybrick/inference test -- serving`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/inference/src/serving.ts packages/inference/src/index.ts packages/inference/src/serving.test.ts
git commit -m "feat(inference): inferOnModel vLLM client (Feature C)"
```

---

### Task 3: `serveAdapter` + TTL teardown (trainer)

**Files:**
- Modify: `packages/trainer/src/prime.ts` (add `buildServeCommand`, `serveAdapter`, `waitForServe`; export `buildServeCommand` via `internalPrimeTestUtils`)
- Modify: `packages/trainer/src/index.ts` (export `serveAdapter`, `ServeHandle`)
- Test: `packages/trainer/src/prime.test.ts` (add a `buildServeCommand` block)

**Interfaces:**
- Consumes: existing `SshTarget`, `runRemote`, `getPodStatus`, `shellSingleQuote`, `DEFAULT_GEMMA_MODEL`.
- Produces: `buildServeCommand(opts)` (pure); `serveAdapter(podId, target, opts): Promise<ServeHandle>` where `ServeHandle = { serveUrl, podId, baseModel, expiresAt }`.

- [ ] **Step 1: Write the failing test (pure command builder)**

```ts
// add to packages/trainer/src/prime.test.ts
import { internalPrimeTestUtils } from './prime'

describe('buildServeCommand (Feature C)', () => {
  it('installs vllm, launches base+lora, and schedules a TTL pkill', () => {
    const cmd = internalPrimeTestUtils.buildServeCommand({
      remoteDir: '/home/ubuntu/run1',
      adapterPath: '/home/ubuntu/run1/adapter',
      baseModel: 'google/gemma-4-26B-A4B-it',
      port: 8000,
      ttlMs: 1_800_000,
    })
    expect(cmd).toMatch(/pip install .*vllm/)
    expect(cmd).toMatch(/vllm\.entrypoints\.openai\.api_server/)
    expect(cmd).toMatch(/--lora-modules tuned=/)
    expect(cmd).toMatch(/sleep 1800; pkill -f vllm/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @brickbybrick/trainer test -- prime`
Expected: FAIL — `buildServeCommand` undefined.

- [ ] **Step 3: Add the builder + orchestrator**

Add to `prime.ts`:
```ts
export interface ServeAdapterOpts {
  remoteDir: string;
  adapterPath: string;
  baseModel?: string;
  port?: number;
  ttlMs?: number;
}
export interface ServeHandle {
  serveUrl: string;
  podId: string;
  baseModel: string;
  expiresAt: string;
}

function buildServeCommand(opts: {
  remoteDir: string;
  adapterPath: string;
  baseModel: string;
  port: number;
  ttlMs: number;
}): string {
  const py = `${opts.remoteDir}/.py/bin/python`;
  const ttlSec = Math.round(opts.ttlMs / 1000);
  return [
    "set -euo pipefail",
    `${py} -m pip install --quiet "vllm>=0.6.0"`,
    `nohup ${py} -m vllm.entrypoints.openai.api_server --host 0.0.0.0 --port ${opts.port} ` +
      `--model ${shellSingleQuote(opts.baseModel)} --enable-lora ` +
      `--lora-modules tuned=${shellSingleQuote(opts.adapterPath)} ` +
      `> ${opts.remoteDir}/vllm.log 2>&1 &`,
    // Self-destruct after TTL so a forgotten serve window can't leak GPU spend.
    `( sleep ${ttlSec}; pkill -f vllm.entrypoints.openai.api_server ) >/dev/null 2>&1 &`,
    "echo serve-launched",
  ].join(" && ");
}

async function waitForServe(
  serveUrl: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  const intervalMs = opts.intervalMs ?? 10_000;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${serveUrl}/models`);
      if (res.ok) return;
    } catch {
      /* server not up yet */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`vLLM did not become ready at ${serveUrl}`);
}

/**
 * Start a vLLM OpenAI server on an already-trained pod (base + LoRA adapter) and
 * return its public URL. INFRA NOTE: assumes the pod's port is reachable at its
 * public IP. If Prime pods don't expose arbitrary ports, switch serveUrl to a
 * persistent `ssh -L` local forward from the Next.js host (same SshTarget).
 */
export async function serveAdapter(
  podId: string,
  target: SshTarget,
  opts: ServeAdapterOpts,
): Promise<ServeHandle> {
  const baseModel = opts.baseModel ?? process.env.BBB_GEMMA_MODEL ?? DEFAULT_GEMMA_MODEL;
  const port = opts.port ?? 8000;
  const ttlMs = opts.ttlMs ?? 30 * 60_000;
  runRemote(
    target,
    buildServeCommand({ remoteDir: opts.remoteDir, adapterPath: opts.adapterPath, baseModel, port, ttlMs }),
  );
  const ip = getPodStatus(podId).ip;
  if (!ip) throw new Error(`pod ${podId} has no public IP for serving`);
  const serveUrl = `http://${ip}:${port}/v1`;
  await waitForServe(serveUrl);
  return { serveUrl, podId, baseModel, expiresAt: new Date(Date.now() + ttlMs).toISOString() };
}
```
Add `buildServeCommand` to the `internalPrimeTestUtils` object. Export `serveAdapter`, `ServeHandle`, `ServeAdapterOpts` from `packages/trainer/src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @brickbybrick/trainer test -- prime`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trainer/src/prime.ts packages/trainer/src/index.ts packages/trainer/src/prime.test.ts
git commit -m "feat(trainer): serveAdapter (vLLM base+LoRA) with TTL teardown (Feature C)"
```

---

### Task 4: `runEval` + scoring

**Files:**
- Create: `packages/inference/src/eval.ts`
- Modify: `packages/inference/src/index.ts` (`export * from './eval'`)
- Test: `packages/inference/src/eval.test.ts`

**Interfaces:**
- Consumes: `AgentEvent`, `GenerationConfig`, `VisualTask`, `EvalTaskResult` from core; `AuditReport` from `./antigravity`.
- Produces: `scoreFromReport(task, report): number`; `runEval(args, emit, deps): Promise<void>` where `args = { runId, config, k, baseModel, tunedModel }`, `deps: EvalDeps`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/inference/src/eval.test.ts
import { describe, it, expect, vi } from 'vitest'
import { runEval, scoreFromReport, type EvalDeps } from './eval'
import type { AgentEvent, VisualTask } from '@brickbybrick/core'

const task: VisualTask = {
  id: 't', prompt: 'p', target_mechanism: 'm',
  criteria: [{ id: 'a', description: 'x', weight: 0.6 }, { id: 'b', description: 'y', weight: 0.4 }],
}
const report = (passed: string[]) => ({ passed: passed.length === 2, passedCriteria: passed, failedCriteria: [], domTrace: '', notes: '' })

describe('scoreFromReport', () => {
  it('sums weights of passed criteria', () => {
    expect(scoreFromReport(task, report(['a']))).toBeCloseTo(0.6)
    expect(scoreFromReport(task, report(['a', 'b']))).toBeCloseTo(1.0)
  })
})

describe('runEval', () => {
  it('emits started, per-task results, and an aggregate with tuned winning', async () => {
    const deps: EvalDeps = {
      generateTask: vi.fn(async () => task),
      inferCode: vi.fn(async (m) => (m === 'tuned' ? 'good' : 'bad')),
      auditCode: vi.fn(async (_t, code) => (code === 'good' ? report(['a', 'b']) : report(['a']))),
    }
    const events: AgentEvent[] = []
    await runEval({ runId: 'r', config: {} as never, k: 2, baseModel: 'g', tunedModel: 'tuned' }, (e) => events.push(e), deps)
    expect(events[0]).toMatchObject({ type: 'eval_started', k: 2 })
    const complete = events.find((e) => e.type === 'eval_complete') as Extract<AgentEvent, { type: 'eval_complete' }>
    expect(complete.report.wins).toBe(2)
    expect(complete.report.mean_score_delta).toBeCloseTo(0.4)
  })
  it('marks a task inconclusive when an audit throws', async () => {
    const deps: EvalDeps = {
      generateTask: vi.fn(async () => task),
      inferCode: vi.fn(async () => 'x'),
      auditCode: vi.fn(async () => { throw new Error('audit failed') }),
    }
    const events: AgentEvent[] = []
    await runEval({ runId: 'r', config: {} as never, k: 1, baseModel: 'g', tunedModel: 'tuned' }, (e) => events.push(e), deps)
    const r = events.find((e) => e.type === 'eval_task_result') as Extract<AgentEvent, { type: 'eval_task_result' }>
    expect(r.result.inconclusive).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @brickbybrick/inference test -- eval`
Expected: FAIL — `./eval` not found.

- [ ] **Step 3: Write `eval.ts`**

```ts
// packages/inference/src/eval.ts
import type { AgentEvent, EvalTaskResult, GenerationConfig, VisualTask } from '@brickbybrick/core'
import type { AuditReport } from './antigravity'

export interface EvalDeps {
  generateTask: (config: GenerationConfig) => Promise<VisualTask>
  inferCode: (model: 'base' | 'tuned', task: VisualTask) => Promise<string>
  auditCode: (task: VisualTask, code: string) => Promise<AuditReport>
}

export interface RunEvalArgs {
  runId: string
  config: GenerationConfig
  k: number
  baseModel: string
  tunedModel: string
}

/** S(M,T,C): sum of weights of the criteria this model's output passed. */
export function scoreFromReport(task: VisualTask, report: AuditReport): number {
  const passed = new Set(report.passedCriteria)
  return task.criteria.reduce((s, c) => s + (passed.has(c.id) ? c.weight : 0), 0)
}

export async function runEval(
  args: RunEvalArgs,
  emit: (event: AgentEvent) => void,
  deps: EvalDeps,
): Promise<void> {
  emit({ type: 'eval_started', k: args.k })
  const tasks: EvalTaskResult[] = []
  let wins = 0, ties = 0, losses = 0, deltaSum = 0, counted = 0

  for (let i = 0; i < args.k; i++) {
    const task = await deps.generateTask(args.config)
    let result: EvalTaskResult
    try {
      const [baseCode, tunedCode] = await Promise.all([
        deps.inferCode('base', task),
        deps.inferCode('tuned', task),
      ])
      const [baseReport, tunedReport] = await Promise.all([
        deps.auditCode(task, baseCode),
        deps.auditCode(task, tunedCode),
      ])
      const base_score = scoreFromReport(task, baseReport)
      const tuned_score = scoreFromReport(task, tunedReport)
      const winner: EvalTaskResult['winner'] =
        tuned_score > base_score ? 'tuned' : tuned_score < base_score ? 'base' : 'tie'
      if (winner === 'tuned') wins++
      else if (winner === 'base') losses++
      else ties++
      deltaSum += tuned_score - base_score
      counted++
      result = {
        task, base_score, tuned_score,
        base_passed_criteria: baseReport.passedCriteria,
        tuned_passed_criteria: tunedReport.passedCriteria,
        winner,
      }
    } catch {
      result = {
        task, base_score: 0, tuned_score: 0,
        base_passed_criteria: [], tuned_passed_criteria: [],
        winner: 'tie', inconclusive: true,
      }
    }
    tasks.push(result)
    emit({ type: 'eval_task_result', result })
  }

  emit({
    type: 'eval_complete',
    report: {
      runId: args.runId, k: args.k,
      base_model: args.baseModel, tuned_model: args.tunedModel,
      wins, ties, losses,
      mean_score_delta: counted ? deltaSum / counted : 0,
      tasks,
    },
  })
}
```
Add to `packages/inference/src/index.ts`: `export * from './eval'`

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @brickbybrick/inference test -- eval`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/inference/src/eval.ts packages/inference/src/index.ts packages/inference/src/eval.test.ts
git commit -m "feat(inference): runEval + scoreFromReport paired eval (Feature C)"
```

---

### Task 5: Serve registry on `RunModel` + persist `model_serving`

**Files:**
- Modify: `packages/db/src/types.ts` (add `serve?` to `LoopRun`)
- Modify: `packages/db/src/models/run.ts` (schema field + `setServe`/`byId` statics)
- Modify: `apps/web/app/api/agent/visual-loop/stream/route.ts` (persist `model_serving` in the `emit` handler)
- Test: `packages/db/src/models/run.test.ts` (create if absent — schema-only test, no live DB)

**Interfaces:**
- Produces: `LoopRun.serve?: { podId: string; serveUrl: string; baseModel: string; expiresAt: string }`; `RunModel.setServe(runId, serve)`; the visual-loop route writes `serve` on `model_serving`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/models/run.test.ts
import { describe, it, expect } from 'vitest'
import { RunModel } from './run'

describe('RunModel serve registry (Feature C)', () => {
  it('has a serve path and setServe static', () => {
    expect(RunModel.schema.path('serve')).toBeDefined()
    expect(typeof (RunModel as unknown as { setServe: unknown }).setServe).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @brickbybrick/db test -- run`
Expected: FAIL — `serve` path undefined.

- [ ] **Step 3: Add the type, schema field, and static**

In `packages/db/src/types.ts`, add to the `LoopRun` interface:
```ts
  serve?: {
    podId: string
    serveUrl: string
    baseModel: string
    expiresAt: string
  }
```
In `packages/db/src/models/run.ts`, add to `RunSchema` fields:
```ts
  serve: {
    type: new Schema(
      { podId: String, serveUrl: String, baseModel: String, expiresAt: String },
      { _id: false },
    ),
    required: false,
  },
```
Add to `RunModelStatics` and implement:
```ts
  setServe(runId: string, serve: NonNullable<LoopRun['serve']>): ReturnType<Model<LoopRun>['updateOne']>
```
```ts
RunSchema.statics.setServe = function (runId: string, serve: NonNullable<LoopRun['serve']>) {
  return this.updateOne({ runId }, { serve })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @brickbybrick/db test -- run`
Expected: PASS.

- [ ] **Step 5: Persist `model_serving` in the visual-loop route**

In `apps/web/app/api/agent/visual-loop/stream/route.ts`, import `RunModel` (already imported) and inside the `emit` function's `if (runId) { ... }` block, alongside the `pair_committed` handler, add:
```ts
          if (event.type === 'model_serving') {
            RunModel.setServe(runId, {
              podId: event.pod_id,
              serveUrl: event.url,
              baseModel: event.base_model,
              expiresAt: event.expires_at,
            }).catch(() => {})
          }
```

- [ ] **Step 6: Verify type-check**

Run: `pnpm --filter @brickbybrick/db type-check && pnpm --filter ./apps/web exec tsc -p tsconfig.typecheck.json --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/types.ts packages/db/src/models/run.ts packages/db/src/models/run.test.ts apps/web/app/api/agent/visual-loop/stream/route.ts
git commit -m "feat(db,web): serve registry on RunModel + persist model_serving (Feature C)"
```

---

### Task 6: `POST /api/eval/stream` route + demo stub

**Files:**
- Create: `apps/web/app/api/eval/demo-runner.ts`
- Create: `apps/web/app/api/eval/stream/route.ts`
- Test: `apps/web/app/api/eval/stream/route.test.ts`

**Interfaces:**
- Consumes: `RunModel.byId` (serve + config), `runEval` + `inferOnModel` + audit primitives from `@brickbybrick/inference`, `formatSSE`/`SSE_HEADERS` from core.
- Produces: `POST /api/eval/stream` body `{ runId, k? }` → SSE of `eval_*` events.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/api/eval/stream/route.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { POST } from './route'

async function collect(res: Response): Promise<string> {
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let out = ''
  for (;;) { const { done, value } = await reader.read(); if (done) break; out += dec.decode(value) }
  return out
}

describe('POST /api/eval/stream', () => {
  beforeEach(() => { process.env.BBB_DEMO_MODE = '1' })
  afterEach(() => { delete process.env.BBB_DEMO_MODE })

  it('400s without runId', async () => {
    const res = await POST(new Request('http://t', { method: 'POST', body: '{}' }))
    expect(res.status).toBe(400)
  })
  it('streams eval_started → eval_complete in demo mode', async () => {
    const res = await POST(new Request('http://t', { method: 'POST', body: JSON.stringify({ runId: 'demo', k: 2 }) }))
    const text = await collect(res)
    expect(text).toMatch(/eval_started/)
    expect(text).toMatch(/eval_complete/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ./apps/web exec vitest run app/api/eval/stream`
Expected: FAIL — `./route` not found.

- [ ] **Step 3: Write the demo runner**

```ts
// apps/web/app/api/eval/demo-runner.ts
import type { AgentEvent } from '@brickbybrick/core'
import { demoTask } from '../agent/visual-loop/demo-runner'

export async function demoRunEval(runId: string, k: number, emit: (e: AgentEvent) => void): Promise<void> {
  emit({ type: 'eval_started', k })
  for (let i = 0; i < k; i++) {
    emit({
      type: 'eval_task_result',
      result: {
        task: demoTask, base_score: 0.4, tuned_score: 0.8,
        base_passed_criteria: ['action-visible'],
        tuned_passed_criteria: ['no-horizontal-overflow', 'action-visible'],
        winner: 'tuned',
      },
    })
  }
  emit({
    type: 'eval_complete',
    report: {
      runId, k, base_model: 'gemma-base', tuned_model: 'tuned',
      wins: k, ties: 0, losses: 0, mean_score_delta: 0.4,
      tasks: [],
    },
  })
}
```

- [ ] **Step 4: Write the route**

```ts
// apps/web/app/api/eval/stream/route.ts
import { NextResponse } from 'next/server'
import { formatSSE, SSE_HEADERS, type AgentEvent } from '@brickbybrick/core'
import { connectDB, RunModel } from '@brickbybrick/db'
import { demoRunEval } from '../demo-runner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let runId = ''
  let k = 3
  try {
    const body = (await request.json()) as { runId?: string; k?: number }
    runId = (body.runId ?? '').trim()
    if (typeof body.k === 'number' && body.k > 0) k = Math.floor(body.k)
  } catch { /* fall through */ }
  if (!runId) return NextResponse.json({ error: 'runId is required' }, { status: 400 })

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AgentEvent) =>
        controller.enqueue(encoder.encode(formatSSE(event)))
      try {
        if (process.env.BBB_DEMO_MODE === '1') {
          await demoRunEval(runId, k, emit)
        } else {
          await connectDB()
          const run = await RunModel.byId(runId).lean()
          if (!run?.serve?.serveUrl) {
            emit({ type: 'narration', text: 'No live served model for this run; train first.' })
          } else {
            const inf = (await import('@brickbybrick/inference')) as typeof import('@brickbybrick/inference')
            await inf.runEval(
              { runId, config: run.config, k, baseModel: run.serve.baseModel, tunedModel: 'tuned' },
              emit,
              inf.createEvalDeps(run.serve.serveUrl, run.serve.baseModel),
            )
          }
        }
      } catch (error) {
        emit({ type: 'narration', text: error instanceof Error ? `Eval failed: ${error.message}` : 'Eval failed.' })
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, { headers: SSE_HEADERS })
}
```

- [ ] **Step 5: Add `createEvalDeps` to inference**

Add these imports at the TOP of `packages/inference/src/eval.ts` (with the existing imports from Task 4):
```ts
import { VisualTaskSchema } from '@brickbybrick/core'
import { inferOnModel } from './serving'
import { generateContent, STRONG_MODEL } from './gemini'
import { createInteraction, parseAuditReport, destroyInteraction } from './antigravity'
import { buildChallengerPrompt, buildAuditPrompt, safeJsonExported } from './loop'
```
Then append the factory at the end of `eval.ts`:
```ts
/** Live EvalDeps: Challenger for held-out tasks, vLLM for code, Antigravity for scoring. */
export function createEvalDeps(serveUrl: string, baseModel: string): EvalDeps {
  return {
    generateTask: async (config) => {
      const raw = await generateContent(
        STRONG_MODEL(),
        buildChallengerPrompt(config),
        'Generate one adversarial UI task now.',
      )
      return VisualTaskSchema.parse(safeJsonExported(raw))
    },
    inferCode: (model, task) =>
      inferOnModel(
        serveUrl,
        model === 'base' ? baseModel : 'tuned',
        `${task.prompt}\nMechanism: ${task.target_mechanism}`,
      ),
    auditCode: async (task, code) => {
      const prompt = buildAuditPrompt(task, code)
      let interactionId = ''
      try {
        const interaction = await createInteraction(prompt, {
          onEvent: (f) => {
            const id = (f as { interaction?: { id?: string } }).interaction?.id
            if (id) interactionId = id
          },
        })
        interactionId = interaction.id || interactionId
        return parseAuditReport(interaction)
      } finally {
        if (interactionId) destroyInteraction(interactionId).catch(() => {})
      }
    },
  }
}
```
This requires three small exports from `loop.ts` (the `buildChallengerPrompt` export is idempotent with Feature A Task 3 — add it if Feature A hasn't shipped, so this plan stands alone): `export function buildChallengerPrompt`, an exported audit-prompt builder, and a `safeJson` wrapper. Add to `loop.ts`:
```ts
export function buildAuditPrompt(task: VisualTask, code: string): string {
  return `${ANTIGRAVITY_AUDIT_SYSTEM}\n\nTask:\n${task.prompt}\n\nAcceptance criteria:\n${task.criteria
    .map((c) => `- ${c.id}: ${c.description}`)
    .join("\n")}\n\nCode to audit:\n${code}`;
}
export function safeJsonExported(text: string): unknown { return safeJson<unknown>(text); }
```
Then refactor the `audit` dep to call `buildAuditPrompt(task, code)` (DRY).

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter ./apps/web exec vitest run app/api/eval/stream` then `pnpm --filter @brickbybrick/inference test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/api/eval packages/inference/src/eval.ts packages/inference/src/loop.ts
git commit -m "feat(web,inference): /api/eval/stream + live eval deps (Feature C)"
```

---

### Task 7: `POST /api/model/infer` route

**Files:**
- Create: `apps/web/app/api/model/infer/route.ts`
- Test: `apps/web/app/api/model/infer/route.test.ts`

**Interfaces:**
- Consumes: `RunModel.byId` (serve), `inferOnModel` from inference.
- Produces: `POST /api/model/infer` body `{ runId, prompt, model: 'base' | 'tuned' }` → `{ code: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/api/model/infer/route.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { POST } from './route'

describe('POST /api/model/infer', () => {
  beforeEach(() => { process.env.BBB_DEMO_MODE = '1' })
  afterEach(() => { delete process.env.BBB_DEMO_MODE })

  it('400s without prompt', async () => {
    const res = await POST(new Request('http://t', { method: 'POST', body: JSON.stringify({ runId: 'r' }) }))
    expect(res.status).toBe(400)
  })
  it('returns demo code', async () => {
    const res = await POST(new Request('http://t', { method: 'POST', body: JSON.stringify({ runId: 'r', prompt: 'build', model: 'tuned' }) }))
    expect(res.status).toBe(200)
    expect((await res.json()).code).toContain('tuned')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ./apps/web exec vitest run app/api/model/infer`
Expected: FAIL — `./route` not found.

- [ ] **Step 3: Write the route**

```ts
// apps/web/app/api/model/infer/route.ts
import { NextResponse } from 'next/server'
import { connectDB, RunModel } from '@brickbybrick/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let runId = '', prompt = '', model: 'base' | 'tuned' = 'tuned'
  try {
    const b = (await request.json()) as { runId?: string; prompt?: string; model?: 'base' | 'tuned' }
    runId = (b.runId ?? '').trim(); prompt = (b.prompt ?? '').trim()
    if (b.model === 'base' || b.model === 'tuned') model = b.model
  } catch { /* fall through */ }
  if (!runId || !prompt) return NextResponse.json({ error: 'runId and prompt are required' }, { status: 400 })

  if (process.env.BBB_DEMO_MODE === '1') {
    return NextResponse.json({ code: `// ${model} model demo output for: ${prompt}` })
  }
  try {
    await connectDB()
    const run = await RunModel.byId(runId).lean()
    if (!run?.serve?.serveUrl) return NextResponse.json({ error: 'no served model for this run' }, { status: 409 })
    const { inferOnModel } = (await import('@brickbybrick/inference')) as typeof import('@brickbybrick/inference')
    const code = await inferOnModel(run.serve.serveUrl, model === 'base' ? run.serve.baseModel : 'tuned', prompt)
    return NextResponse.json({ code })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'infer failed' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter ./apps/web exec vitest run app/api/model/infer`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/model/infer/route.ts apps/web/app/api/model/infer/route.test.ts
git commit -m "feat(web): POST /api/model/infer try-it proxy (Feature C)"
```

---

### Task 8: Dashboard "Model ready" panel — store + UI

**Files:**
- Modify: `apps/web/lib/store.ts` (state + reducer cases for `eval_*` and `model_serving`)
- Create: `apps/web/components/dashboard/model-ready-panel.tsx`
- Modify: `apps/web/components/dashboard/control-center.tsx` (render the panel)
- Test: `apps/web/lib/store.test.ts` (add eval cases)

**Interfaces:**
- Consumes: `eval_started`/`eval_task_result`/`eval_complete`/`model_serving` events; `POST /api/eval/stream`, `POST /api/model/infer`.
- Produces: store fields `serveInfo`, `evalReport`, `evalResults`, `evalRunning`; `<ModelReadyPanel/>`.

- [ ] **Step 1: Write the failing store test**

```ts
// add to apps/web/lib/store.test.ts
describe('reduceAgentState — eval + serving (Feature C)', () => {
  it('captures serveInfo and eval results', () => {
    let s = reduceAgentState(initialAgentState, {
      type: 'model_serving', url: 'http://x/v1', expires_at: 'z', pod_id: 'p', base_model: 'g',
    })
    expect(s.serveInfo?.url).toBe('http://x/v1')
    s = reduceAgentState(s, { type: 'eval_started', k: 2 })
    expect(s.evalRunning).toBe(true)
    s = reduceAgentState(s, {
      type: 'eval_complete',
      report: { runId: 'r', k: 2, base_model: 'g', tuned_model: 'tuned', wins: 2, ties: 0, losses: 0, mean_score_delta: 0.4, tasks: [] },
    })
    expect(s.evalRunning).toBe(false)
    expect(s.evalReport?.wins).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ./apps/web exec vitest run lib/store`
Expected: FAIL — `serveInfo` undefined.

- [ ] **Step 3: Extend the store**

Add imports `EvalReport`, `EvalTaskResult` to the type import. In `AgentStoreSnapshot`:
```ts
  serveInfo: { url: string; expiresAt: string; baseModel: string } | null;
  evalRunning: boolean;
  evalResults: EvalTaskResult[];
  evalReport: EvalReport | null;
```
In `initialAgentState`: `serveInfo: null, evalRunning: false, evalResults: [], evalReport: null,`
In `reduceAgentState` switch, add:
```ts
    case "model_serving":
      return { ...base, serveInfo: { url: event.url, expiresAt: event.expires_at, baseModel: event.base_model } };
    case "eval_started":
      return { ...base, evalRunning: true, evalResults: [], evalReport: null };
    case "eval_task_result":
      return { ...base, evalResults: [...state.evalResults, event.result] };
    case "eval_complete":
      return { ...base, evalRunning: false, evalReport: event.report };
```
Add the four fields to `persistedSnapshot`.

- [ ] **Step 4: Run store test to verify it passes**

Run: `pnpm --filter ./apps/web exec vitest run lib/store`
Expected: PASS.

- [ ] **Step 5: Build the panel**

```tsx
// apps/web/components/dashboard/model-ready-panel.tsx
"use client";
import { useState } from "react";
import { useAgentStore } from "@/lib/store";
import { streamAgentEvents } from "@/lib/stream-client";
import { Button } from "@/components/ui/button";

export function ModelReadyPanel() {
  const serveInfo = useAgentStore((s) => s.serveInfo);
  const evalReport = useAgentStore((s) => s.evalReport);
  const evalRunning = useAgentStore((s) => s.evalRunning);
  const trainingRunId = useAgentStore((s) => s.trainingRunId);
  const consumeEvent = useAgentStore((s) => s.consumeEvent);
  const [prompt, setPrompt] = useState("");
  const [base, setBase] = useState<string | null>(null);
  const [tuned, setTuned] = useState<string | null>(null);

  if (!serveInfo) return null;

  async function runEval() {
    if (!trainingRunId) return;
    await streamAgentEvents({
      url: "/api/eval/stream",
      init: { method: "POST", body: JSON.stringify({ runId: trainingRunId, k: 3 }) },
      onEvent: consumeEvent,
    });
  }
  async function tryIt(model: "base" | "tuned") {
    const res = await fetch("/api/model/infer", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: trainingRunId, prompt, model }),
    });
    const { code } = (await res.json()) as { code: string };
    model === "base" ? setBase(code) : setTuned(code);
  }

  return (
    <section className="rounded-md border border-emerald-500/20 bg-emerald-500/[0.03] p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-white">Model ready</h3>
        <span className="text-xs text-zinc-400">serve expires {new Date(serveInfo.expiresAt).toLocaleTimeString()}</span>
      </div>
      <div className="mt-3 flex gap-2">
        <Button onClick={runEval} disabled={evalRunning}>
          {evalRunning ? "Evaluating…" : "Run before/after eval (≈6 audits)"}
        </Button>
      </div>
      {evalReport ? (
        <div className="mt-3 text-sm text-zinc-200">
          Tuned vs base: <span className="text-emerald-400">{evalReport.wins}W</span> / {evalReport.ties}T /{" "}
          <span className="text-rose-400">{evalReport.losses}L</span> · Δscore{" "}
          {evalReport.mean_score_delta.toFixed(3)}
        </div>
      ) : null}
      <div className="mt-4">
        <input
          className="h-9 w-full rounded-md border border-white/10 bg-black px-3 text-sm text-white outline-none focus:border-emerald-300"
          placeholder="Try it: describe a UI to generate"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="mt-2 flex gap-2">
          <Button variant="secondary" onClick={() => tryIt("base")} disabled={!prompt.trim()}>Base</Button>
          <Button onClick={() => tryIt("tuned")} disabled={!prompt.trim()}>Tuned</Button>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <pre className="max-h-48 overflow-auto rounded bg-black/60 p-2 text-xs text-zinc-300">{base ?? "base output…"}</pre>
          <pre className="max-h-48 overflow-auto rounded bg-black/60 p-2 text-xs text-zinc-300">{tuned ?? "tuned output…"}</pre>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Render it in `control-center.tsx`**

Import and place it under the grid (after `<WeightComputeConsole />`'s container):
```tsx
import { ModelReadyPanel } from "@/components/dashboard/model-ready-panel";
// ...inside <main>, after the closing </div> of the xl:grid section:
<ModelReadyPanel />
```

- [ ] **Step 7: Verify type-check + tests**

Run: `pnpm --filter ./apps/web exec tsc -p tsconfig.typecheck.json --noEmit && pnpm --filter ./apps/web exec vitest run lib/store`
Expected: no type errors; store tests PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/store.ts apps/web/lib/store.test.ts apps/web/components/dashboard/model-ready-panel.tsx apps/web/components/dashboard/control-center.tsx
git commit -m "feat(web): Model-ready panel — eval results + side-by-side try-it (Feature C)"
```

---

### Task 9: Wire serving into the training tail

**Files:**
- Modify: `packages/inference/src/training.ts` (`runPrimeTraining` — serve after training, emit `model_serving`)
- Modify: `packages/inference/src/training.ts` deps interface (`runGemmaLoraTraining` called with `keepPod: true`)
- Test: `packages/inference/src/training.test.ts` (assert `model_serving` emitted)

**Interfaces:**
- Consumes: `runGemmaLoraTraining` (with `keepPod`), `serveAdapter` from `@brickbybrick/trainer`.
- Produces: `runPrimeTraining` emits `model_serving { url, expires_at, pod_id, base_model }` after a successful train.

- [ ] **Step 1: Write the failing test**

```ts
// add to packages/inference/src/training.test.ts
import { runPrimeTraining } from './training'
import type { AgentEvent, TrainingPair } from '@brickbybrick/core'

const pair = { id: 'p', task: { id: 't', prompt: 'p', target_mechanism: 'm', criteria: [{ id: 'c', description: 'd', weight: 1 }] }, weak_code: 'w', defect: { screenshot: '', dom_trace: '', category: 'overflow', severity: 'high' }, strong_code: 's', u_score: 0.7 } as TrainingPair

it('emits model_serving after training when serve deps are provided', async () => {
  const events: AgentEvent[] = []
  await runPrimeTraining([pair], (e) => events.push(e), {
    runGemmaLoraTraining: async () => ({ podId: 'pod1', adapterPath: '/r/adapter', runName: 'run', hubRepo: 'u/r' }),
    serveAdapter: async () => ({ serveUrl: 'http://pod1:8000/v1', podId: 'pod1', baseModel: 'g', expiresAt: '2030-01-01T00:00:00Z' }),
    sshTargetForPod: async () => ({ host: 'h', port: '22', keyPath: 'k' }),
    remoteDirFor: () => '/r',
  })
  const serving = events.find((e) => e.type === 'model_serving')
  expect(serving).toMatchObject({ type: 'model_serving', url: 'http://pod1:8000/v1', pod_id: 'pod1' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @brickbybrick/inference test -- training`
Expected: FAIL — serve deps not used / no `model_serving`.

- [ ] **Step 3: Extend `runPrimeTraining`**

Extend `GemmaTrainingDeps` and the function. Call `runGemmaLoraTraining` with `keepPod: true`, then `serveAdapter`, then emit `model_serving`:
```ts
export interface GemmaTrainingDeps {
  runGemmaLoraTraining: (opts: { pairs: TrainingPair[]; runName?: string; keepPod?: boolean }, callbacks: {
    onStatus?: (status: string, detail?: string) => void
    onMetric?: (point: LossPoint) => void
    onLog?: (line: string) => void
  }) => Promise<{ podId: string; adapterPath: string; runName: string; hubRepo?: string }>
  serveAdapter?: (podId: string, target: { host: string; port: string; keyPath: string }, opts: { remoteDir: string; adapterPath: string }) => Promise<{ serveUrl: string; podId: string; baseModel: string; expiresAt: string }>
  sshTargetForPod?: (podId: string) => Promise<{ host: string; port: string; keyPath: string }>
  remoteDirFor?: (runName: string) => string
}
```
After the existing `complete` emit (and before `return`), add:
```ts
    if (deps.serveAdapter && deps.sshTargetForPod && deps.remoteDirFor) {
      try {
        const target = await deps.sshTargetForPod(result.podId)
        const handle = await deps.serveAdapter(result.podId, target, {
          remoteDir: deps.remoteDirFor(result.runName),
          adapterPath: result.adapterPath,
        })
        emit({ type: 'model_serving', url: handle.serveUrl, expires_at: handle.expiresAt, pod_id: handle.podId, base_model: handle.baseModel })
      } catch (error) {
        emit({ type: 'narration', text: `Serving failed (adapter still on Hub): ${errorMessage(error)}` })
      }
    }
```
Update `realDeps` to wire `serveAdapter`, a `sshTargetForPod` (using trainer `getPodStatus` + `parseSshTarget` + `waitForPodSsh`), `remoteDirFor: (runName) => \`${process.env.BBB_REMOTE_ROOT || '/home/ubuntu'}/${runName}\``, and pass `keepPod: true` to `runGemmaLoraTraining`. Export `getPodStatus`, `parseSshTarget`, `waitForPodSsh` from `@brickbybrick/trainer` if not already.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @brickbybrick/inference test -- training`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/inference/src/training.ts packages/inference/src/training.test.ts packages/trainer/src/index.ts
git commit -m "feat(inference): serve adapter + emit model_serving after training (Feature C)"
```

---

## Final verification

- [ ] Run `pnpm -r test build type-check` → all green.
- [ ] Update `BBB_DEMO_MODE=1` e2e/demo flow to exercise eval + try-it stubs.
- [ ] Manual smoke (costs real GPU/audit $): run a small live loop → confirm `model_serving` arrives, eval returns a win/tie/loss with the real auditor, try-it returns differing base vs tuned output, and the pod auto-terminates at TTL.
