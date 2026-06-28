# Handoff — Finish BrickByBrick (audit remediation plan)

**Date:** 2026-06-27
**Branch at handoff:** `feat/hf-hub-adapter-save` — **WP-0 ✅ landed to `main` (2026-06-27); build is GREEN** (`pnpm turbo run type-check test build` → 15/15, exit 0)
**Context:** A full intended-vs-implemented audit was done (2026-06-27). The system is ~80% built (engine loop, Antigravity wrapper, Gemini clients, trainer, DO providers, Mongo, 3-section dashboard, narration bridge all implemented + unit-tested against a real captured fixture). The gaps are unfinished threads + unverified live integration, not missing foundations.

Read first, do not re-derive:
- [`ARCHITECTURE.md`](ARCHITECTURE.md) (§5 loop, §6 event contract, §9–11 DO/Mongo) — source of truth for shapes
- [`DECISIONS.md`](DECISIONS.md) — locked product decisions + the pivot
- [`BUILD_PLAN.md`](BUILD_PLAN.md) — the original setup→parallel-worktrees→integration model (this plan reuses it)
- [`features/A-ENGINE.md`](features/A-ENGINE.md), [`features/B-INFRA.md`](features/B-INFRA.md), [`features/C-UI.md`](features/C-UI.md) — per-package briefs

The audit findings (A–H) are summarized inline per work package below; they are NOT saved elsewhere in the repo, so treat this doc as their record.

---

## Sequencing model (mirror the existing BUILD_PLAN)

```
WP-0 (blocker, SEQUENTIAL, land to main first)
        │  build goes GREEN here
        ▼
┌──────────────────────────────────────────────┐
│  WP-1 trainer   WP-2 inference   WP-3 apps/web │  ← parallel, separate worktrees
└──────────────────────────────────────────────┘
        ▼
WP-4 Integration + live rehearsal + docs (SEQUENTIAL, last)
```

**Rule:** disjoint directory ownership = safe parallelism. One agent per package; do NOT split a single package across two agents (merge thrash). WP-2 bundles three small inference changes into one agent for exactly this reason.

---

## WP-0 — Get the build GREEN (blocker, do alone, FIRST)

**✅ DONE (2026-06-27).** Landed to `main`. The LoRA adapter → private Hugging Face Hub push is complete (`BBB_HF_HUB_REPO`); `resolveHubRepo` is now a pure resolver so its unit tests no longer read the real `.env.local`. Full build green (`pnpm turbo run type-check test build` → 15/15, exit 0). **WP-1/2/3 can now branch off `main`.**

**Owns:** `packages/trainer` · **Worktree:** none — finished on the `feat/hf-hub-adapter-save` branch, landed to `main`.
**Why first:** `pnpm turbo run type-check test` currently FAILS (`@brickbybrick/trainer` build error + 6 failing tests). Nothing else should branch until main is green, exactly like the original "setup commit" gate.

This is the half-finished **LoRA adapter → private Hugging Face Hub** save feature (the answer to the earlier "where does the trained Gemma model get saved?" — nowhere yet; HF Hub push is the intended answer). The Python side (`packages/trainer/src/remote-script.ts`) already fully supports `--push-to-hub`. The TS wiring is incomplete:
- `resolveHubRepo` (in `prime.ts` ~line 384) is not exported in `internalPrimeTestUtils` → test error "resolveHubRepo is not a function".
- `buildRemoteTrainingCommand` never appends the `--push-to-hub <repo>` flag → assertion in `prime.test.ts` fails.
- `hubRepo` is on the opts interfaces but not threaded into `runGemmaLoraTraining` → `streamRemoteTraining` → `buildRemoteTrainingCommand`.

**Done when:** `pnpm turbo run type-check test build` green; the existing `prime.test.ts` HF-Hub tests pass; `--push-to-hub` flag is shell-quoted and only added when a repo resolves. Add `BBB_HF_HUB_REPO` to `.env.example`.

---

## WP-1 — Pre-built training dataset seed (parallel)

**Owns:** `packages/trainer/__fixtures__` + a generator/seed script · **Worktree:** `../bbb-dataset` branch `feat/dataset`
**Finding C:** README + DECISIONS #8 promise "real pre-built JSONL for training scale (the '2,000')." Reality: `__fixtures__/demo-dataset.jsonl` = **5 rows**. The "train at scale" story has no data.

**DECIDED (user, 2026-06-27): small real seed + cut the claim.** Do NOT generate 2,000 synthetic rows. Ship a realistic ~50–100 row seed of schema-valid `TrainingPair` rows (reuse the `trainingPairToChatJsonl` shape in `prime.ts` and the `core` schemas), and **remove the "2,000" / "train at scale" claim** from README + DECISIONS #8 (coordinate the doc edits with WP-4 to avoid conflicts). Keep the seed import-free of live APIs so it runs in CI.
**Done when:** ~50–100 row seed committed; a test validates every row against the `core` schema; the "2,000" claim is gone from all docs.

---

## WP-2 — Loop hardening (parallel; ONE agent does all three)

**Owns:** `packages/inference` · **Worktree:** `../bbb-inference` branch `feat/loop-hardening`
Three small, same-package changes — bundle them so they don't collide:

- **Finding F — sandbox teardown.** `destroyEnvironment()` exists but the loop never calls it → Antigravity sandboxes leak / accrue idle spend. Add a `finally` in the audit path (or loop end) that calls `destroyEnvironment(envId)`. Note: `createInteraction` currently returns the consolidated result; you may need to surface `environmentId` to the loop to tear down. Also consider calling `downloadEnvironment()` for full-res dataset PNGs (currently dead code) — optional, flag to user.
- **Finding G — live cost.** `cost_microcents` is in the `AgentEvent` schema and the UI renders it, but nothing emits it. Emit `training_event{cost_microcents}` (and/or per-audit cost) from a real source — Antigravity `usage` tokens are in the fixture (`interaction.sample.json` has a `usage` block), and Prime exposes price. Wire at least one real cost number.
- **Finding E — screenshot-stream validation.** The spike proved screenshots are NOT in the stream; the `<<<AUDIT_STEP>>>` thumbnail-sentinel trick has **never been observed against the real API** (the captured fixture used a generic prompt with no sentinels). Tighten `ANTIGRAVITY_AUDIT_SYSTEM` so the sandbox reliably prints the sentinels, and add a test proving `parseAuditStepsFromText` extracts frames from a realistic sentinel-bearing sample. True validation happens in WP-4's live run — this WP just makes it as likely as possible.

**Done when:** `pnpm --filter @brickbybrick/inference test build type-check` green; teardown covered by a test (mock `destroyEnvironment`, assert called); a cost event is emitted in a unit test.

---

## WP-3 — Close the loop in the dashboard (parallel)

**Owns:** `apps/web` · **Worktree:** `../bbb-ui-training` branch `feat/closed-loop-ui`
**Finding B:** The engine closes the loop in code (`loop.ts` `train` dep calls `runGemmaLoraTraining` on committed pairs), but the **UI does not**. "Run loop" and "Stream metrics" are two disconnected buttons; "Stream metrics" tails a **manually typed** runId (default `"demo-run"`) against a *pre-existing* Prime run. There is no path from committed pairs → launch training → stream that run.

**Task:** Wire the handoff. Options (recommend to user): when the visual loop finishes committing its target pairs, the run should surface a real training runId (the loop already triggers training via its `train` dep) that the UI auto-subscribes to — or add an endpoint that runs loop-then-training and streams both phases over one SSE. Reference: `app/api/agent/visual-loop/stream/route.ts` already persists committed pairs; `app/api/training/stream/route.ts` is the metrics consumer. Avoid editing the frozen `packages/core` contracts; if a new request/event field is genuinely needed, flag it for WP-4 to add through integration (per BUILD_PLAN, core additions go through integration only).
**Done when:** from the dashboard, one operator action runs the loop and the compute console then streams that run's loss — no hand-typed runId. Store-reducer + route tests green.

---

## WP-4 — Integration, live rehearsal, docs (SEQUENTIAL, last)

**Owns:** merge + `docs/` + ops · **No parallel worktree** — runs after WP-1/2/3 merge to main.

- **Merge** `feat/dataset`, `feat/loop-hardening`, `feat/closed-loop-ui` `--no-ff`; resolve any `core` additions here.
- **Finding D — the real de-risk.** Nothing has been run end-to-end live; all green is mocks/fixtures. ARCHITECTURE's own Definition of Done requires a live run (real Antigravity screenshots, ≥1 pair committed with real 𝒰, real Prime loss curve). Run `pnpm demo:preflight`, then a gated `BBB_ALLOW_PAID_REHEARSAL=1 pnpm demo:rehearsal`. This simultaneously validates Findings E (does the sentinel screenshot trick actually work live?), F (does teardown fire?), and B (does the closed loop run?). ⚠️ Costs real money + ~14 min/pair latency + "no fallback net" (decision #2) — needs the user present with real keys in `.env.local`. **Do not run paid rehearsal without explicit user go-ahead.**
- **Finding H — stale docs.** README says "Status: scaffolded" and DECISIONS says "apps/web pages are still one-line placeholders" — both false now. Rewrite the README status block + DECISIONS "Where we are" to reflect ~80%-built reality. Reconcile the "2,000 pairs" claim per WP-1's decision (cut it).

**Done when:** main is green across all packages + web; one live rehearsal emitted ≥1 real pair + ≥1 real loss line (or the user explicitly defers the paid run); docs match reality.

---

## Parallelization summary

| WP | Parallel? | Worktree | Package owned |
|---|---|---|---|
| **WP-0** HF-Hub save / green build | ❌ first, alone | current branch → main | `packages/trainer` |
| **WP-1** dataset seed | ✅ parallel | `../bbb-dataset` (`feat/dataset`) | `packages/trainer/__fixtures__` |
| **WP-2** loop hardening (E+F+G) | ✅ parallel | `../bbb-inference` (`feat/loop-hardening`) | `packages/inference` |
| **WP-3** closed-loop UI | ✅ parallel | `../bbb-ui-training` (`feat/closed-loop-ui`) | `apps/web` |
| **WP-4** integration + rehearsal + docs | ❌ last, alone | none | merge + `docs/` |

WP-1/2/3 are mutually disjoint (trainer-fixtures / inference / apps-web) → safe to run simultaneously. WP-1 branches off the **post-WP-0** green commit (both touch trainer, but WP-0 lands first). WP-3 is the only one that might need a `core` addition → route that through WP-4, don't edit `core` in the worktree.

---

## Suggested skills for the next agent(s)

- `superpowers:using-git-worktrees` — create the three parallel worktrees off the green commit.
- `superpowers:test-driven-development` — every WP has tests; WP-0 is literally finishing a RED→GREEN cycle.
- `superpowers:dispatching-parallel-agents` — if spawning WP-1/2/3 concurrently (only if the user asks for subagents).
- `superpowers:systematic-debugging` — for WP-0's failing tests and WP-4's live rehearsal failures.
- `superpowers:verification-before-completion` — before claiming any WP done.
- `digitalocean-gradient` / `context7` — when touching DO provider or Prime/HF/LiveKit SDK specifics.
- `superpowers:finishing-a-development-branch` — at each WP merge.

## Notes / cautions
- Do not edit `packages/core` inside a feature worktree — it's the frozen contract; additions go through WP-4.
- `.env.local` holds live keys (Gemini/LiveKit/Prime/DO/HF/Mongo) — never commit or echo it; redact in any output.
