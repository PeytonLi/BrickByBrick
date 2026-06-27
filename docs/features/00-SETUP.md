# Feature Brief — Setup Agent

**Runs:** first, alone, on `main`. **Blocks:** A/B/C until done + spike green.
**Goal:** freeze the shared contracts, reconcile deps, prove the live APIs, leave a green build.

> **STATUS: code-side complete (2026-06-27).** Steps 1–4 done; `pnpm turbo run build type-check test` is green. Step 5 (the live API spike) is scaffolded under `scripts/spike/` and awaits the user's real keys in `.env.local`. See "What was done" at the bottom.

## Prereqs
Read [`../ARCHITECTURE.md`](../ARCHITECTURE.md) and [`../DECISIONS.md`](../DECISIONS.md).

## Tasks

### 1. Dependency reconciliation
- Add to `packages/inference`: `@google/genai`. Remove `@anthropic-ai/sdk`, `openai`.
- **Remove the `packages/agentbox` package entirely** — the Antigravity wrapper folds into `packages/inference` (it's just Gemini-key REST calls). Drop `@brickbybrick/agentbox` from `apps/web` deps + `next.config.ts` `transpilePackages`.
- Add to `apps/web`: `livekit-server-sdk`, `@livekit/components-react`, `livekit-client`, `@google/genai`.
- Add dev: `vitest` (all packages), `@testing-library/react` + `@testing-library/jest-dom` + `@vitejs/plugin-react` + `jsdom` (web).
- **Remove `react-dropzone`** (no doc ingestion — task bank instead) and `shadcn` from runtime deps (CLI; use `pnpm dlx shadcn@latest add`).
- Keep: zustand, recharts, react-diff-viewer-continued, lucide-react.

### 2. Freeze `@brickbybrick/core` (the contract)
Implement `packages/core/src/schemas.ts` (Zod + inferred types), re-export from `index.ts`. Must include:
- `VisualTask` — task-bank item (id, prompt, target_mechanism, criteria[]).
- `GenerationConfig` — challenger weights, τ, diversity threshold (0.82), mutate-every-N.
- `AuditStep` — `{ screenshot: string /*b64*/, action, intent, viewport }`.
- `TrainingPair` — `{ task, weak_code, defect, strong_code, u_score }`.
- `LossPoint` — `{ step, loss, epoch }`.
- `AgentEvent` — discriminated union, exactly the variants in ARCHITECTURE §6.
- Type alias for the engine entry: `RunVisualLoop = (config: GenerationConfig, emit: (e: AgentEvent) => void) => Promise<void>`.
- SSE envelope helper + the API route request/response types.

**This file is frozen after this commit.** Feature agents import from it and must not edit it.

### 3. Test infrastructure
- `vitest.config.ts` per package + web; add a `test` task to `turbo.json` (`"test": { "dependsOn": ["^build"] }`).
- Root scripts: `pnpm turbo run test`.

### 4. Env
- Rewrite `.env.example` with the vars in ARCHITECTURE §8.
- Create `.env.local` from user-supplied real keys (do not commit; it's gitignored).

### 5. ⛔ Go/No-Go API spike (gate)
Write throwaway scripts under `scripts/spike/` (not shipped) that confirm, with the real keys:
- **a.** Antigravity handshake: `POST /v1beta/interactions` returns `environment_id` + `steps`. **Capture a real response that includes a screenshot step** and commit it to `packages/inference/__fixtures__/interaction.sample.json`. (`node scripts/spike/antigravity.mjs`)
- **b.** Gemini 3.5 Pro responds.
- **c.** Gemma 4 responds on the Gemini key. *(If not: fall back to smallest Gemini Flash as "weak"; record in DECISIONS.)*
- **d.** `prime` CLI authed; `prime availability list` works. Capture a `prime train metrics` sample → `packages/trainer/__fixtures__/metrics.sample.txt`. (`bash scripts/spike/prime.sh <run-id>`)
- **e.** LiveKit token mints + a test audio track connects. (`node scripts/spike/livekit.mjs`)

### 6. Exit criteria
- `pnpm install && pnpm turbo run build type-check` green.
- Fixtures committed. Spike notes appended to `DECISIONS.md` (esp. the Gemma 4 result).
- Commit. **Then** create worktrees and spawn A/B/C off this commit.

## Done when
Green build + green spike + frozen core + committed fixtures.

---

## What was done (2026-06-27)

**Steps 1–4 complete; build/type-check/test green; step 5 awaits real keys.**

- **Contracts frozen** in `packages/core/src/`: `schemas.ts` (VisualTask, GenerationConfig, AuditStep, Defect, TrainingPair, LossPoint, the `AgentEvent` discriminated union, and the `RunVisualLoop` type), `sse.ts` (`formatSSE`/`parseSSEData`/`SSE_HEADERS`), `contracts.ts` (route request/response types). Smoke test `src/__tests__/schemas.test.ts` — **8 passing**.
- **Deps reconciled**: `agentbox` package deleted; `@anthropic-ai/sdk`/`openai`/`react-dropzone`/`shadcn` removed; `@google/genai`, `livekit-*`, vitest + RTL added. `next.config.ts` + web deps no longer reference agentbox.
- **Test infra**: vitest config per package + web (jsdom + RTL setup), `test` task in `turbo.json` + root script, `passWithNoTests` so empty feature packages stay green.
- **Env**: `.env.example` + `.env.local` template rewritten to the real var set; `.env.local*` gitignored.
- **Spike scripts**: `scripts/spike/{gemini,antigravity,livekit}.mjs`, `prime.sh`, `_env.mjs`, `README.md` — dependency-free, run with real keys; write the two fixtures.
- **Build fix**: removed the broken `@import "shadcn/tailwind.css"` from `globals.css` (scaffold bug — that file never existed). `next build` now compiles.

**Remaining before spawning A/B/C:** put real keys in `.env.local`, run the four spike scripts, confirm all five checks pass (esp. the Antigravity screenshot fixture + Gemma 4 availability), commit the fixtures.
