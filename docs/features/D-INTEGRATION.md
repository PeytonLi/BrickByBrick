# Feature Brief — D · Integration Agent

**Runs:** last, sequential, on `main`. **Owns:** the merge, e2e, live rehearsal, runbook.

## Prereqs
A/B/C worktree branches (`feat/engine`, `feat/infra`, `feat/ui`) complete and individually green. Read [`../DECISIONS.md`](../DECISIONS.md).

## Tasks

### 1. Merge
- `git merge --no-ff feat/engine feat/infra feat/ui` into `main` (or sequentially). Resolve cross-package imports.
- If any agent needed a `@brickbybrick/core` addition, apply it here once and re-verify all consumers.
- Remove the now-stale `.claude/context/*.md` deletions from the working tree (the docs are superseded by `docs/`).

### 2. Wire & verify
- Ensure `.env.local` has all real keys (ARCHITECTURE §8).
- `pnpm install && pnpm turbo run build type-check lint test` → green everywhere.

### 3. End-to-end (Playwright)
Add `apps/web/e2e/`:
- Load dashboard → start visual loop → assert ≥1 `pair_committed` appears in Section B → trigger training → assert the loss curve renders in Section C.
- Quarantine flakes; upload screenshots/trace on failure.

### 4. Full live rehearsal (real keys)
- Run the complete loop once end-to-end: real Antigravity screenshots stream into Section A, a real `defect_found` → `pair_committed` with a real 𝒰, and the **pre-warmed** Prime Intellect job's real loss curve streams in Section C.
- Record timings (audit latency/pair, provisioning lead time).

### 5. Demo runbook (`docs/RUNBOOK.md`)
- Pre-flight: keys, `prime login`, LiveKit project.
- **Pre-warm timing:** when to launch the real `prime train` job before going on stage so the loss curve is mid-descent during the demo.
- On-stage sequence: start loop → narrate the gap → show a pair lock in → cut to the streaming loss curve.
- Failure modes & what to say (pure-live, no fallback — see DECISIONS risks).

## Done when
Merged to `main`, full green build+test, Playwright e2e passing, one clean live rehearsal recorded, runbook written.
