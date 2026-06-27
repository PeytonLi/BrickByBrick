# Feature Brief — C · UI Agent

**Worktree:** `feat/ui` off the setup commit. **Owns:** `apps/web`.
**Method:** TDD-lite — vitest + React Testing Library for the store and event handling; Playwright deferred to integration.
**Imports only** from frozen `@brickbybrick/core` (schemas + `AgentEvent` + route types). Never edits `packages/core`. Calls the engine via the typed `runVisualLoop` signature inside the API route.

## Prereqs
Read [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §6–7. shadcn/ui (base-nova), Tailwind v4, recharts, zustand, lucide are already installed.

## Deliverables

### API routes (Node runtime, SSE)
- `app/api/agent/visual-loop/stream/route.ts` — calls `runVisualLoop(config, emit)`; pipes each `AgentEvent` as an SSE message.
- `app/api/training/stream/route.ts` — SSE wrapping `trainer.streamMetrics` → `training_event`s.
- `app/api/livekit/token/route.ts` — mints a LiveKit access token (`livekit-server-sdk`).
- Narration bridge: relay Gemini Live audio into the LiveKit room (or expose `narration` text + TTS).

### State — `lib/store.ts` (zustand, sessionStorage persist)
Loop state, committed pairs + 𝒰 scores, latest audit screenshots, training state (loss points, instance, cost, status). Single reducer that consumes `AgentEvent`. **Resolve the duplicate `lib/cn.ts` vs `lib/utils.ts`** (keep `lib/utils.ts`).

### Dashboard — single page, 3 sections + `components/nav.tsx`
- **A · Live Media Room:** `@livekit/components-react` room (audio) + `AgentAudioVisualizer` + a screenshot-stream `<img>` swapping on each `audit_step`. High-contrast dark block.
- **B · Adversarial Matrix:** challenger / weak-solver / visual-auditor / strong-solver cards; live 𝒰 gap meter; "Synthesized Pairs N / target" counter; amber blink + fade on `pair_rejected`, green flash + lock on `pair_committed`. Radix/base-ui tabs + lucide indicators.
- **C · Weight Compute Console:** recharts loss curve from `training_event`; active instance name; live micro-cent cost; status timeline.
- Wire the existing `app/{ingest,synthesis,training}` stub pages into the layout/nav (or collapse into the single control center per the PRD mock).

## TDD focus
- Store reducer: each `AgentEvent` variant updates state correctly (counter increments only on `pair_committed`, screenshots update on `audit_step`, loss points append on `training_event`).
- An SSE event handler that decodes the frozen `AgentEvent` schema.
- Component smoke: sections render with mocked store state.

## Done when
Store + handler tests green; `pnpm --filter web test build type-check lint` green; `pnpm dev` renders the 3-section dashboard; LiveKit token route signs without WebRTC timeout (against mocked/stub stream — real run validated by integration).
