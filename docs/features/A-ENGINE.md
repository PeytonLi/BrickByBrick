# Feature Brief — A · Engine Agent

**Worktree:** `feat/engine` off the setup commit. **Owns:** `packages/inference` (the Antigravity wrapper now lives here too — the `agentbox` package was removed).
**Method:** TDD (`superpowers:test-driven-development`) — RED → GREEN → REFACTOR.
**Imports only** from frozen `@brickbybrick/core`. Never edits `packages/core`.

## Prereqs
Read [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §2–6 and the setup fixture (`packages/inference/__fixtures__/interaction.sample.json`).

## Deliverables

### `packages/inference/src/antigravity.ts`
Wrapper over the Interactions API (real shapes in ARCHITECTURE §2):
- `createInteraction(prompt): { id, environmentId, steps, outputText }`
- `continueInteraction(prevId, envId, input): …` (multi-turn)
- streaming parse (`stream:true` deltas)
- `extractScreenshots(steps): AuditStep[]` — **build against the committed fixture**
- `destroyInteraction(interactionId)` → `DELETE /v1beta/interactions/{id}` for sandbox teardown (no FS-download endpoint exists, so the full-res TAR path was dropped — thumbnails are the dataset image source)

### `packages/inference/src/gemini.ts`
- `strongSolver(task, defect): code` — Gemini 3.5 Pro.
- `weakSolver(task): code` — Gemma 4 (or Flash fallback per setup notes).
- `withRetry` exponential backoff. (Mirror the structure of the reference branch `2473c0f`'s `withRetry`.)

### `packages/inference/src/prompts.ts`
`CHALLENGER_SYSTEM`, `WEAK_SOLVER_SYSTEM`, `STRONG_SOLVER_SYSTEM`, `ANTIGRAVITY_AUDIT_SYSTEM` (instructs the sandbox: write the code, `npm`-serve on :3000, open a browser, resize to mobile widths, inject fringe/boundary input data, run ≥5 exploratory clicks, capture screenshots + DOM trace of any layout collision/overflow/frozen-state, report pass/fail), `RECIPE_SYNTHESIZER_SYSTEM`.

### `packages/inference/src/loop.ts`
`runVisualLoop(config, emit)` implementing ARCHITECTURE §5 exactly:
challenge → weak draft → audit (fail required) → strong fix → re-audit (pass required) → `𝒰 = S(strong) − S(weak)` → commit iff `𝒰 ≥ τ` → cosine-sim diversity gate (reject > 0.82, using Gemini embeddings) → `recipe_mutated` every N. Emits the full `AgentEvent` sequence including streamed `audit_step`s and a `narration` per phase.

## TDD focus (mock Gemini + Antigravity with fixtures)
- Filter gate: weak-pass ⇒ `pair_rejected: too_easy`.
- 𝒰 computation from criteria scores; commit boundary at τ.
- Diversity gate: > 0.82 ⇒ `pair_rejected: redundant`.
- Recipe mutation cadence (every N; and 3-consecutive-same-failure rule).
- `emit` event ordering matches §5.
- Screenshot extraction against the real fixture.

## Done when
All engine unit tests green; `runVisualLoop` matches the frozen `RunVisualLoop` type; `pnpm --filter @brickbybrick/inference test build type-check` green.
