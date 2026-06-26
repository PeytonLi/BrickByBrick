# Feature Agent D — UI: Synthesis Page

## Context

You are Feature Agent D. Monorepo scaffold exists. Working in git worktree on branch `feat/ui-synthesis`. Read `.claude/context/ARCHITECTURE.md` for full context.

**Your scope**:
- `apps/web/app/synthesis/page.tsx`
- `apps/web/app/api/synthesis/stream/route.ts`
- `apps/web/components/orchestration-ribbon.tsx`
- `apps/web/components/challenger-terminal.tsx`
- `apps/web/components/strong-solver-transcript.tsx`
- `apps/web/components/verifier-logs.tsx`
- `apps/web/components/weak-solver-deck.tsx`
- `apps/web/components/recipe-viewer.tsx`

**Do not modify**: `lib/store.ts` (owned by Agent C). Import from it but don't change it.

## Design System

Dark mode, `#0a0a0a` background. This page is the drama of the demo — live streaming terminals, side-by-side diffs, blinking status lights. Make it feel like a war room.

Each agent card has a distinct color accent:
- Challenger: `text-purple-400` / `border-purple-800`
- Strong Solver (Claude): `text-blue-400` / `border-blue-800`
- Verifier: `text-green-400` / `border-green-800`
- Weak Solver: `text-orange-400` / `border-orange-800`
- Recipe: `text-red-400` / `border-red-800`

## app/synthesis/page.tsx

Full-page layout:

```
┌─────────────────────────────────────────────────────────────────┐
│  ORCHESTRATION RIBBON (sticky top)                               │
│  [RUNNING] Pairs: 7/20  |  Filter Rate: 68%  |  [STOP]         │
├──────────────┬──────────────┬──────────────┬────────────────────┤
│  CHALLENGER  │ STRONG SOLVER│   VERIFIER   │   WEAK SOLVER      │
│  Terminal    │  Transcript  │    Logs      │  Comparison Deck   │
│              │              │              │                     │
│  (scrolling) │  (scrolling) │  (scrolling) │  (diff viewer)     │
├──────────────┴──────────────┴──────────────┴────────────────────┤
│  RECIPE EVOLUTION VIEWER (full width, animated JSON diff)        │
└─────────────────────────────────────────────────────────────────┘
```

The page:
1. On mount, reads `generationConfig` and `vectorizedChunks` from Zustand store
2. Opens an EventSource to `/api/synthesis/stream` (POST via fetch SSE)
3. Routes each incoming `AgentEvent` to the appropriate component via Zustand `appendAgentEvent`
4. Shows the orchestration ribbon at the top, sticky
5. Four equal-width agent cards in the middle (CSS grid, `grid-cols-4`)
6. Recipe viewer full-width at the bottom

The start button triggers `fetch('/api/synthesis/stream', { method: 'POST', body: JSON.stringify(config) })` and reads the response body as a stream. Parse SSE manually:
```ts
const reader = response.body?.getReader()
const decoder = new TextDecoder()
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  const text = decoder.decode(value)
  // parse "data: {...}\n\n" lines
}
```

## components/orchestration-ribbon.tsx

Sticky top bar (`position: sticky, top: 0, z-index: 50`):

```tsx
'use client'
// Shows: status indicator (pulsing green dot when running), pairs counter, filter rate,
// dataset size in tokens (estimated), and a red STOP button
// Reads from Zustand store
```

Metrics displayed:
- `● RUNNING` / `● STOPPED` (colored dot)
- `Pairs: {pairsCompleted}/{totalTarget}`
- `Filter Rate: {(filteredCount / totalAttempted * 100).toFixed(1)}%`
- `Est. Tokens: {(trainingPairs.length * 420).toLocaleString()}`
- `[Emergency Stop]` button — sets isRunning to false in store, closes the SSE connection

## components/challenger-terminal.tsx

Terminal-style streaming output. Shows the last N challenger outputs:

```tsx
// Shows each challenger event as it arrives
// Format: "► PAIR #7\n{content}\n---"
// Auto-scroll to bottom using useEffect + ref
// Purple color scheme
// Shows "Querying vector index..." as placeholder when idle
```

## components/strong-solver-transcript.tsx

Structured CoT display:

```tsx
// Each strong_solver event shows a formatted CoT
// Parse numbered steps from the content (look for "1. ", "2. ", etc.)
// Render each step as a separate line with step number highlighted
// Highlight the final "Answer:" line in bright white
// Blue color scheme
// Claude logo/badge in corner
```

## components/verifier-logs.tsx

Raw code execution output:

```tsx
// Shows the Python code the verifier wrote
// Shows the execution output (stdout/stderr)
// Green = exit code 0, Red = exit code 1
// Render code in a styled <pre> block with syntax highlighting
// (basic: keywords in yellow, strings in green)
// Green color scheme
```

## components/weak-solver-deck.tsx

Side-by-side diff showing where the weak model failed:

```tsx
// Left side: "GROUND TRUTH" (strong solver answer)
// Right side: "NEMOTRON ANSWER" (weak solver output)
// Use react-diff-viewer-continued for the comparison
// Import: import ReactDiffViewer from 'react-diff-viewer-continued'
// Red/green highlighting makes the failure obvious
// Orange color scheme header
// Only shows when filter_gate === true (a gap was found)
```

## components/recipe-viewer.tsx

The centerpiece of the demo — animated JSON diff:

```tsx
'use client'
import ReactDiffViewer from 'react-diff-viewer-continued'

// Shows the evolving GenerationConfig
// Left side: previous config (JSON.stringify, 2 spaces)
// Right side: current config (JSON.stringify, 2 spaces)
// When a recipe event arrives with config_patch:
//   - Animate in the new diff
//   - Show the Claude explanation of WHY the recipe changed above the diff
//   - Keep a history of all recipe changes in local state
// Add a "Recipe Evolution" header with step count: "v3 of config"
// Wide viewport, full width
```

## app/api/synthesis/stream/route.ts

```ts
import { runAgentLoop } from '@brickbybrick/inference'
import { createEnvironment, executeCode, destroyEnvironment } from '@brickbybrick/agentbox'
import type { GenerationConfig, AgentEvent } from '@brickbybrick/core'

export const runtime = 'nodejs'
export const maxDuration = 300  // 5 minutes

export async function POST(request: Request) {
  const config: GenerationConfig = await request.json()
  
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: AgentEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      
      const env = await createEnvironment()
      try {
        const runCode = async (code: string) => {
          const result = await executeCode(env, code)
          return { exitCode: result.exitCode, output: result.stdout + result.stderr }
        }
        
        // Retrieve stored chunks from request or use demo chunks
        const vectorChunks = (config as any).vectorChunks ?? DEMO_MATH_CHUNKS
        
        await runAgentLoop(config, vectorChunks, emit, runCode)
      } finally {
        await destroyEnvironment(env)
        controller.close()
      }
    }
  })
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }
  })
}

// Demo data for when no document is uploaded
const DEMO_MATH_CHUNKS = [
  "A matrix is diagonalizable if and only if it has n linearly independent eigenvectors...",
  "The eigenvalues of a triangular matrix are the diagonal entries...",
  "For a 2x2 matrix A = [[a,b],[c,d]], the characteristic polynomial is λ² - (a+d)λ + (ad-bc)...",
  "The spectral theorem states that every real symmetric matrix is orthogonally diagonalizable...",
  "Jordan normal form represents matrices that are not diagonalizable...",
]
```

## Build Check

`cd apps/web && pnpm type-check` — exit 0.

## Commit

`git add -A && git commit -m "feat(ui): synthesis page, agent cards, SSE streaming"`
