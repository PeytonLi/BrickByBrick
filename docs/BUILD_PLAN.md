# Build Plan & Orchestration

How the work is split across agents. The model: **setup (sequential) → 3 fat feature agents in git worktrees, in parallel, via TDD → integration (sequential)**. Disjoint directory ownership keeps merges clean.

## Crew & ownership

| Agent | Owns (disjoint dirs) | Brief |
|---|---|---|
| **Setup** | `packages/core`, root config, `.env*`, test infra | [`features/00-SETUP.md`](features/00-SETUP.md) ✅ done |
| **A · Engine** | `packages/inference` (incl. Antigravity wrapper) | [`features/A-ENGINE.md`](features/A-ENGINE.md) |
| **B · Infra** | `packages/trainer` | [`features/B-INFRA.md`](features/B-INFRA.md) |
| **C · UI** | `apps/web` | [`features/C-UI.md`](features/C-UI.md) |
| **D · Integration** | merge + e2e + runbook | [`features/D-INTEGRATION.md`](features/D-INTEGRATION.md) |

## Sequencing

```
        ┌──────────────────────────────────────┐
Setup → │  A·Engine   B·Infra   C·UI  (worktrees)│ → D·Integration → main
        └──────────────────────────────────────┘
          parallel, TDD, off the setup commit
```

1. **Setup runs first and alone.** It freezes `@brickbybrick/core` (schemas + `AgentEvent` + `runVisualLoop` signature + SSE/route contracts), reconciles deps, sets up vitest, and runs the **go/no-go API spike**. It commits **real API-response fixtures**. ⛔ Do not spawn A/B/C until the spike passes and `pnpm turbo run build type-check` is green.
2. **A, B, C run in parallel**, each in its own worktree branched off the setup commit, each following [`superpowers:test-driven-development`](RED→GREEN→REFACTOR). They build against the frozen core contracts only — they never edit `packages/core`.
3. **D integrates last:** merges the three branches `--no-ff`, wires real `.env.local`, runs Playwright e2e, does one full live rehearsal, writes the demo runbook.

## Why this split avoids merge conflicts

- The only cross-agent coupling is `@brickbybrick/core` — **frozen by setup**, edited by no feature agent (additions go through integration).
- File ownership is disjoint: A→`inference`, B→`trainer`, C→`apps/web`. Zero overlap.
- UI talks to the engine through the **typed `runVisualLoop` signature + the `AgentEvent` SSE contract**, not shared implementation. So UI and Engine compile independently.

## Worktree convention

```bash
git worktree add ../bbb-engine -b feat/engine <setup-commit>   # owns packages/inference
git worktree add ../bbb-infra  -b feat/infra  <setup-commit>   # owns packages/trainer
git worktree add ../bbb-ui     -b feat/ui     <setup-commit>   # owns apps/web
```
(See `superpowers:using-git-worktrees`.) Integration merges `feat/engine`, `feat/infra`, `feat/ui` into `main`.

## Definition of done

- `pnpm turbo run build type-check lint test` green across all packages + web.
- Dashboard loads; LiveKit audio token signs; visual loop streams real Antigravity screenshots; ≥1 pair commits with a real 𝒰 score; compute console streams a real Prime Intellect loss curve.
- Playwright e2e covers the happy path headless.
- Demo runbook (incl. pre-warm timing) written.

## Locked product decisions

See [`DECISIONS.md`](DECISIONS.md) for the full list and rationale. Headlines: full PRD pivot · everything live on `GEMINI_API_KEY`+LiveKit+Prime · Antigravity drives the audit in-sandbox · LiveKit audio-only + screenshot stream · generic UI task bank · verify both weak-fail & strong-pass · pre-warm real training · ~3–8 live pairs + pre-built JSONL · no fallback net.
