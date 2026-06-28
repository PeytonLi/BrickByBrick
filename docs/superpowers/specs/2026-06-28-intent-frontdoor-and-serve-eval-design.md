# Design: Intent Front-Door (A) + Serve & Before/After Eval (C)

**Date:** 2026-06-28
**Status:** Approved (brainstorming) — pending implementation plan
**Scope:** Two features on the existing, verified run→pair→train pipeline.

---

## 1. Goal & scope

Today BrickByBrick auto-runs generate→audit→fix→score→fine-tune→push-adapter
(`loop.ts:261-266` calls `deps.train` at `max_pairs`; the web "Run loop" button
triggers it end-to-end). Two ends of the pipe are missing:

- **A — Intent front-door:** a user types a vague goal ("a model good at React")
  and the system derives the run configuration. Today a run is configured only by
  `GenerationConfigSchema` (τ, diversity, `max_pairs`, per-*mechanism* weights);
  there is no free-text intent.
- **C — Serve & before/after eval:** prove the fine-tuned model improved and let
  the user actually use it. Today training only emits a LoRA adapter + a narration
  line with a HuggingFace URL — no serving, no eval.

**In scope (decisions locked during brainstorming):**
- **A1** — intent steers *within the existing front-end-UI product*. The verifier
  (Antigravity browser audit) is untouched. No new/general domains.
- **A — expand-then-review** UX: derive a plan, show it editable, then run.
- **C — reuse the training pod** for inference (vLLM serving base + LoRA adapter).
- **C — real-but-small paired eval** using the existing Antigravity auditor on K
  held-out tasks; **user-triggered** (not automatic) for cost/time control.

**Out of scope (YAGNI):** non-visual domains / alternate verifiers; cross-run
dataset accumulation, dataset versioning, persistent model registry; long-lived
hosted inference (only a TTL-bounded window); saved intent "profiles";
auth/multi-tenant serving.

All changes are **additive**: existing runs and the current loop keep working with
no intent and no eval.

---

## 2. Shared contract changes — `packages/core/src/schemas.ts`

Additive only (the file is the frozen coupling point; additive changes are allowed
via the integration path).

### 2.1 `GenerationConfigSchema` — new optional fields
- `intent?: string` — the raw user text (provenance + UI display).
- `domain_framing?: string` — the LLM-expanded steering paragraph injected into
  the Challenger.
- `framework?: string` — hint, e.g. `"react" | "vue" | "vanilla"` (free string;
  not an enum, to stay flexible).

`challenger_weights` (open `record<string, number>`) and `focus_mechanism` already
exist and are already consumed by `buildChallengerPrompt`.

### 2.2 New `EvalReportSchema`
```
EvalTaskResultSchema = {
  task: VisualTask,
  base_score: number,        // S(base, T, C) in [0,1]
  tuned_score: number,       // S(tuned, T, C) in [0,1]
  base_passed_criteria: string[],
  tuned_passed_criteria: string[],
  winner: 'base' | 'tuned' | 'tie',
  inconclusive?: boolean,    // an audit failed; excluded from aggregates
}
EvalReportSchema = {
  runId: string,
  k: number,
  base_model: string,
  tuned_model: string,
  wins: number, ties: number, losses: number,   // tuned vs base
  mean_score_delta: number,                      // mean(tuned_score - base_score)
  tasks: EvalTaskResult[],
}
```

### 2.3 New `AgentEvent` variants (discriminated union, additive)
- `intent_expanded { config: GenerationConfig (partial), sample_titles: string[] }`
- `eval_started { k: number }`
- `eval_task_result { result: EvalTaskResult }`
- `eval_complete { report: EvalReport }`
- `model_serving { url: string, expires_at: string }`

---

## 3. Feature A — intent front-door (expand-then-review)

### 3.1 Components
1. **`expandIntent(text): Promise<{ config: Partial<GenerationConfig>, sample_titles: string[] }>`**
   in `packages/inference`. One strong-model call with a new
   `INTENT_EXPANDER_SYSTEM` prompt (added to `prompts.ts`). Output validated
   against `GenerationConfigSchema.partial()`; on invalid/junk output, fall back to
   defaults and surface a narration. Text-only, ~cents, no audit, no sandbox.
2. **`POST /api/intent/expand`** — body `{ intent }` → `{ config, sample_titles }`.
   Mirrors existing route conventions; `BBB_DEMO_MODE=1` returns a deterministic
   stub.
3. **`buildChallengerPrompt(config)`** ([loop.ts:292](../../../packages/inference/src/loop.ts))
   extended: if `domain_framing` present, push it as a steering paragraph; if
   `framework` present, instruct "implement in `<framework>`". One additive branch;
   absent ⇒ byte-identical to today's prompt.

### 3.2 Data flow
intent text → `/api/intent/expand` (LLM) → derived `GenerationConfig` (editable in
UI) → existing `/api/agent/visual-loop/stream` (already auto-trains at `max_pairs`).

### 3.3 UI (control center / ingest)
Add an intent `textarea` + "Derive plan" button → calls `/api/intent/expand` →
renders an **editable Run-plan card**: detected framework, target mechanisms with
weights (chips), and 2–3 sample task titles. Existing "Run loop" posts the
(possibly edited) config; `max_pairs` etc. remain editable. Reuses existing config
plumbing in `lib/store.ts` / `stream-client.ts`.

---

## 4. Feature C — serve + before/after eval

### 4.1 Pod lifecycle change (`packages/trainer`)
Today `runGemmaLoraTraining` provisions → trains → pushes adapter → **terminates**.
Change to provision → train → push → **keep alive + launch vLLM** (base + LoRA,
OpenAI-compatible endpoint) → return `{ podId, ip, adapterPath, serveUrl }` without
terminating. Teardown becomes an explicit, **TTL-bounded** step: a max keep-alive
window auto-terminates the pod so a forgotten "try it" cannot leak GPU spend (same
discipline as the `destroyInteraction` fix).

### 4.2 Components
1. **`serveAdapter(pod, { baseModel, adapterPath, ttlMs })`** (`packages/trainer`):
   launch vLLM with the LoRA loaded; return `serveUrl`. `terminatePod` already
   exists; add TTL enforcement.
2. **`inferOnModel(serveUrl, model, prompt): Promise<string>`** (`packages/inference`):
   thin OpenAI-compatible client returning generated code. Used by **both** eval and
   "try it." `model` selects base vs adapter.
3. **`runEval(config, serveUrl, k, emit)`** (`packages/inference`):
   - generate K **held-out** tasks via the existing Challenger using the run's
     `intent`/`domain_framing` (held-out = freshly generated, not in training set);
   - for each: `inferOnModel` for base code and tuned code; audit **both** via the
     existing `audit` (createInteraction → extractAuditSteps → parseAuditReport);
     score each via existing S(M,T,C); emit `eval_task_result`;
   - aggregate win/tie/loss + `mean_score_delta` → emit `eval_complete`.
   - a failed audit ⇒ mark task `inconclusive`, continue, exclude from aggregates.

### 4.3 Trigger — user-triggered (not automatic)
Training completes → pod kept alive briefly → UI shows "Evaluate (≈K×2 audits;
estimated cost & time computed from K)" + "Try it." User opts in knowingly.
Rationale: eval is the expensive
tail (~$0.87 & ~7–11 min per audit ⇒ K=3 ≈ $5 & ~40–70 min); automatic eval would
surprise-spend. Consistent with expand-then-review.

### 4.4 Routes & registry
- `POST /api/eval/stream` — body `{ runId }` → run `runEval` against the run's
  served pod; stream `eval_*` events. `BBB_DEMO_MODE=1` → deterministic report.
- `POST /api/model/infer` — body `{ runId, prompt, model: 'base' | 'tuned' }` →
  proxy to the pod's vLLM for the "try it" box.
- **Serve registry:** persist `runId → { podId, serveUrl, expiresAt }` on
  `RunModel` (new optional `serve` subdoc) so eval/try-it survive across separate
  SSE connections; DB-down degrades to live-session-only serving. Wiring:
  `runGemmaLoraTraining` emits the `serveUrl`/`expires_at` (surfaced as a
  `model_serving` event by `runPrimeTraining`); the visual-loop stream route's
  `emit` handler writes it into `RunModel.serve`, exactly as it already persists
  `pair_committed` → `PairModel`.

### 4.5 UI
After training completes, a "Model ready" panel: eval button with cost/time
estimate; results (win/tie/loss, mean score delta, per-task base-vs-tuned);
side-by-side "Try it" prompt box (base vs tuned); the HF Hub link; and
extend/teardown controls for the serve window.

---

## 5. Error handling
- Intent expand: empty → 400; LLM junk → schema-validate, fall back to defaults +
  narration.
- vLLM/pod death → eval/infer return clear errors; teardown attempted in `finally`.
- **Pod TTL auto-terminate** bounds serve-window spend.
- Eval audit failure → task `inconclusive`, eval continues.
- DB down → degrade like existing routes (serve registry unavailable ⇒ try-it
  limited to the live session).

---

## 6. Testing
- **Unit:** `expandIntent` (mock LLM → schema-valid patch + fallback on junk);
  `buildChallengerPrompt` includes framing/framework when present and is unchanged
  when absent; `runEval` aggregation math (win/tie/loss, mean delta, inconclusive
  handling) with mocked `inferOnModel` + `audit`; `serveAdapter` command
  construction; TTL teardown.
- **Schema:** new `EvalReport`/`AgentEvent` variants parse; `GenerationConfig`
  back-compat (no intent still valid).
- **Routes:** `/api/intent/expand` (happy + invalid); `/api/eval/stream` emits
  `eval_*` in order; `/api/model/infer` proxies. Follow existing `*.route.test.ts`
  patterns + `BBB_DEMO_MODE` stubs.
- **Demo stubs:** extend demo-runner with deterministic intent expansion + eval
  report for CI/e2e.

---

## 7. Acceptance criteria
- Typing an intent yields an editable derived plan; running it produces tasks
  visibly aligned to the intent (framing reaches the Challenger).
- After a training run, the user can trigger a paired eval and see win/tie/loss +
  score delta + per-task results from the real auditor on held-out tasks.
- The user can prompt base vs tuned side-by-side and get real outputs from the
  served pod.
- The serve pod always terminates (explicit teardown or TTL); no leaked GPU.
- `pnpm -r test build type-check` green; no regressions to existing loop/training.
