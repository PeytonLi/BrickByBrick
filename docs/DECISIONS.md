# Decisions & Handoff Context

Read this first if you're an agent picking up cold. It records **what was decided, why, the current repo state, and where we left off.**

## Where we are

- **Phase:** **WP-0 complete, WP-1 in progress, 2026-06-27.** `@brickbybrick/core` contracts frozen; all packages have passing tests (core 8, db 13, inference 78, trainer 40, web 17). HF-Hub LoRA adapter push feature landed. Seed dataset (~60 pairs, 16 UI mechanisms) generated and schema-validated.
- **Packages now:** `core`, `inference`, `trainer` (the `agentbox` package was **removed** — Antigravity folds into `inference`). `apps/web` pages are still one-line placeholders.
- **Next step:** put real keys in `.env.local`, run the **go/no-go spike** (`scripts/spike/`), confirm all five checks + commit the two fixtures — **then** create the three worktrees and spawn A/B/C.

## The pivot (most important context)

The pasted PRD and the scaffolded repo described **two different systems**. We chose to **fully pivot to the PRD** (visual, Gemini/Antigravity/LiveKit/Prime) and treat the repo's text-based Nebius+Claude foundation as reference-only.

- The unmerged branch `worktree-agent-ad6131657bf7e7c53` (commit `2473c0f`) has a complete **text-based** loop (Nebius Qwen/Nemotron + Claude). **We reuse its schema/loop *structure*, not its code** — model clients are replaced by Gemini. The other 4 `worktree-agent-*` branches are empty (== main).
- The 8 deleted `.claude/context/*.md` docs describe the *old* text-based plan; superseded by `docs/`.

## PRD corrections (the PRD's code would fail as written)

| PRD said | Reality (use this) |
|---|---|
| `POST api.google.dev/v1/agents/antigravity-preview-05-2026/sessions` | `POST https://generativelanguage.googleapis.com/v1beta/interactions`, header `x-goog-api-key` |
| `from prime_intellect import ComputeCluster, TrainingJob` | `prime` **CLI** via `child_process` (`prime pods create`, `prime train …`) |
| Antigravity has a generic `ENVIRONMENT_BROWSER` tool you wire | The managed agent **browses in-sandbox**; we just stream its `steps` |
| LiveKit streams the cloud browser video | LiveKit = **audio only**; browser shown via **screenshot stream** |
| Strong=Gemini Pro, Weak=Gemma, plus Nebius/Anthropic | All brains on **one `GEMINI_API_KEY`**; Nebius/Anthropic dropped |

These are detailed in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Locked decisions (with rationale)

1. **Full PRD pivot.** User wants maximum wow; the APIs turned out to be real in this 2026 timeline.
2. **Everything live, no mock, no fallback net.** User's explicit call. ⇒ the setup go/no-go spike is the main de-risking lever; one flawless run is the goal.
3. **Antigravity drives the whole visual audit in-sandbox.** Simplest, single API surface, matches PRD; we don't run Playwright.
4. **LiveKit audio-only + SSE screenshot stream.** A headless sandbox browser can't publish WebRTC on its own; this keeps the LiveKit demo element without video-egress infra.
5. **Generic web-app task bank** (forms/modals/responsive layouts). No doc-ingestion/RAG — more controllable, reproducible failures.
6. **Verify both sides** of the gap: weak must FAIL, strong fix must PASS, before commit. Legit 𝒰 ≥ τ. ~2× audit calls accepted.
7. **Pre-warm a real Prime Intellect job;** stream its real loss on stage. Avoids dead air while staying 100% real.
8. **~3–8 pairs generated live** (proves the mechanism) + **real pre-built seed dataset** (~60 pairs across 16 UI mechanisms) for training iteration.
9. **Crew:** setup → 3 fat worktree agents (TDD) → integration. User chose "fewer, fatter agents" to minimize merge thrash.
10. **Removed the `agentbox` package** (2026-06-27). It was a vestige of the old GMI-sandbox design; the Antigravity wrapper is just Gemini-key REST calls, so it lives in `packages/inference`. Also dropped unused deps: `@anthropic-ai/sdk`, `openai` (Nebius), `react-dropzone` (no doc ingestion), `shadcn` runtime dep (it's a CLI). Removed a broken `@import "shadcn/tailwind.css"` the scaffold shipped (file never existed) — that had silently broken `next build`.

## DigitalOcean + MongoDB Atlas integration (2026-06-27)

11. **MongoDB Atlas** chosen for managed persistence (`@brickbybrick/db`). Runs, pairs, events, and the task bank persist beyond ephemeral `sessionStorage`. Separate from DO for multi-cloud flexibility. DB writes from the SSE routes are fire-and-forget — a DB outage degrades to an unpersisted stream rather than breaking the loop.
12. **Gemini primary, DigitalOcean serverless as fallback.** A `FallbackProvider` wraps each solver/embed call and switches to DO (Claude 4.6 Sonnet / Llama 3.3 70B / GTE Large) on 429/5xx, emitting a narration event on the switch. The Gemini primary path is unchanged.
13. **DO GPU Droplets as an alternative to Prime Intellect**, selected by `BBB_TRAINING_PROVIDER`. Prime remains the default; DO GPU uses `doctl` + SSH for provisioning, dataset transfer, metric streaming, and teardown. Both providers expose the same logical interface.
14. **DigitalOcean App Platform** for production deployment. `output: 'standalone'` Next.js, multi-stage pnpm-monorepo Dockerfile, port 8080, CD from GitHub via `app.yaml`.

## Confirmed credentials (per user)

Anthropic ✓ · Gemini ✓ · LiveKit ✓ · Prime Intellect ✓. Antigravity confirmed reachable with the **same Gemini key** (verified against docs). Gemma 4 availability on the Gemini key is the one thing the **setup spike must confirm** (fallback: smallest Gemini Flash variant as "weak").

## Model ID reconciliation (2026-06-27)

The architecture doc assumed `gemini-3.5-pro` / `gemma-4-9b-it`. Both return 404 on the live key. Queried `/v1beta/models?pageSize=1000` to find real IDs:

| Role | Planned ID | Actual live ID |
|---|---|---|
| Strong (Gemini) | `gemini-3.5-pro` | `gemini-3.1-pro-preview` |
| Weak (Gemma) | `gemma-4-9b-it` | `gemma-4-26b-a4b-it` |
| Embeddings | `text-embedding-004` | `gemini-embedding-001` |

These are now the defaults in `packages/inference/src/gemini.ts` and can be overridden via `STRONG_MODEL` / `WEAK_MODEL` / `GEMINI_EMBED_MODEL` env vars. Gemini spike (both models → 200) confirmed on 2026-06-27.

## Open risks

- **Antigravity `steps` screenshot encoding** is only fully known after the setup spike → capture a real fixture, build engine TDD against it. **Hard gate.**
- **Audit latency** (~30–60s/pair, multi-turn) → keep live target at 3–8 pairs.
- **Prime provisioning lag** → mitigated by pre-warm.
- **No safety net** by user choice — don't spawn feature agents until the spike is green.

## How to resume

1. Read this file + [`ARCHITECTURE.md`](ARCHITECTURE.md) + [`BUILD_PLAN.md`](BUILD_PLAN.md).
2. Execute [`features/00-SETUP.md`](features/00-SETUP.md). Confirm the spike + green build.
3. Create worktrees; dispatch [`features/A-ENGINE.md`](features/A-ENGINE.md), [`features/B-INFRA.md`](features/B-INFRA.md), [`features/C-UI.md`](features/C-UI.md) in parallel under TDD.
4. Run [`features/D-INTEGRATION.md`](features/D-INTEGRATION.md).
