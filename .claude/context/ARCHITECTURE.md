# BrickByBrick — Architecture & All Decisions

> Hackathon project. 12-hour window. Every decision below is final — do not re-derive.

## What It Is

BrickByBrick is a **Closed-Loop Multi-Agent Data Synthesizer**. It takes a source document (e.g. a math arXiv paper), runs a 4-agent adversarial loop to generate high-quality training pairs, filters for pairs where a strong model succeeds but the weak target model fails, then fine-tunes the weak model on Prime Intellect spot hardware.

---

## Monorepo Layout

```
BrickByBrick/
├── apps/
│   └── web/                        # Next.js 15 App Router
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── page.tsx            # Route /  (Thesis Hub / Landing)
│       │   ├── ingest/page.tsx     # Route /ingest  (Knowledge Grounding)
│       │   ├── synthesis/page.tsx  # Route /synthesis  (Debate Matrix)
│       │   └── training/page.tsx   # Route /training  (Cluster Orchestrator)
│       ├── app/api/
│       │   ├── ingest/route.ts     # File upload → AgentBox ingest
│       │   ├── synthesis/
│       │   │   └── stream/route.ts # SSE: live agent loop output
│       │   └── training/
│       │       └── stream/route.ts # SSE: Prime Intellect training status
│       ├── components/
│       │   ├── ui/                 # shadcn/ui generated components
│       │   ├── dropzone.tsx
│       │   ├── rag-profiler.tsx
│       │   ├── target-config.tsx
│       │   ├── orchestration-ribbon.tsx
│       │   ├── challenger-terminal.tsx
│       │   ├── strong-solver-transcript.tsx
│       │   ├── verifier-logs.tsx
│       │   ├── weak-solver-deck.tsx
│       │   ├── recipe-viewer.tsx
│       │   ├── loss-graph.tsx
│       │   ├── status-blueprint.tsx
│       │   └── download-center.tsx
│       └── lib/
│           └── store.ts            # Zustand global state
├── packages/
│   ├── core/                       # Zod schemas + TypeScript types (no runtime deps)
│   ├── inference/                  # Nebius + Anthropic API clients + orchestration loop
│   ├── agentbox/                   # GMI AgentBox SDK wrapper + document ingest
│   └── trainer/                    # Prime Intellect CLI wrapper
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

## Package Names

| Directory | npm name |
|---|---|
| packages/core | `@brickbybrick/core` |
| packages/inference | `@brickbybrick/inference` |
| packages/agentbox | `@brickbybrick/agentbox` |
| packages/trainer | `@brickbybrick/trainer` |
| apps/web | `web` |

---

## Environment Variables (.env)

```bash
NEBIUS_API_KEY=
ANTHROPIC_API_KEY=
AGENTBOX_API_KEY=
PRIME_INTELLECT_API_KEY=
```

---

## External Services

### 1. Nebius Token Factory

OpenAI-compatible API. Use the `openai` npm package:

```ts
import OpenAI from 'openai'

export const nebiusClient = new OpenAI({
  baseURL: 'https://api.tokenfactory.nebius.com/v1/',
  apiKey: process.env.NEBIUS_API_KEY,
})
```

Models (exact IDs on Nebius — agent must verify against actual available models):
- **Challenger**: `Qwen/Qwen3-235B-A22B` (or closest Qwen3.6 27B MTP available)
- **Verifier**: Same Qwen model
- **Weak Solver**: `nvidia/Nemotron-3-Nano-Omni` (confirmed exact ID from user)

Embedding model for RAG: `Qwen/Qwen3-Embedding` (or `BAAI/bge-en-icl` as fallback)

### 2. Anthropic Claude (Strong Solver)

```ts
import Anthropic from '@anthropic-ai/sdk'

export const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})
```

Model: `claude-sonnet-4-6` (current session model — most capable available)

### 3. AgentBox (GMI Cloud)

Published SDK (user has downloaded it). The agent building `packages/agentbox` must:
1. Find the SDK — check `~/Downloads/`, pip-installed packages, or ask user for the npm package name
2. Write a thin wrapper with a mock fallback (`AGENTBOX_MOCK=true`)
3. Key operations: `createEnvironment()`, `executeCode(env, code)`, `destroyEnvironment(env)`, `ingestDocument(env, buffer)`

Mock mode must return deterministic fake outputs so the UI renders correctly even without a real AgentBox key.

### 4. Prime Intellect

Use the `prime` CLI. The trainer package:
1. Writes `configs/train.toml` dynamically
2. Executes `prime train run configs/train.toml` via Node `child_process`
3. Parses stdout for loss metrics and streams them

Example `train.toml`:
```toml
[model]
name = "Qwen/Qwen2.5-7B-Instruct"
lora_rank = 16

[data]
path = "/tmp/brickbybrick-dataset.jsonl"
format = "conversational"

[training]
epochs = 3
batch_size = 4
learning_rate = 2e-4
```

If `prime` CLI is not installed or fails, fall back to streaming mock loss data (0.95 → 0.12 over 100 steps).

---

## Core Data Schema (packages/core/src/schemas.ts)

```ts
import { z } from 'zod'

export const TrainingPairSchema = z.object({
  id: z.string().uuid(),
  question: z.string(),
  ground_truth_cot: z.string(),       // Claude's full Chain-of-Thought
  ground_truth_answer: z.string(),    // Final answer extracted from CoT
  weak_answer: z.string(),            // Nemotron's attempt
  verification_passed: z.boolean(),   // Verifier sandbox exit code 0
  filter_gate: z.boolean(),           // true = strong correct, weak wrong
  error_category: z.string(),         // e.g. "fraction_arithmetic"
  schema_version: z.number().default(1),
  created_at: z.string().datetime(),
})

export type TrainingPair = z.infer<typeof TrainingPairSchema>

export const GenerationConfigSchema = z.object({
  target_count: z.number().default(100),    // 20 for demo, 5000 for real
  domain_hint: z.string(),                  // e.g. "linear algebra"
  error_rates: z.record(z.string(), z.number()).default({}),
  schema_version: z.number().default(1),
  // Dynamic axes the Recipe Synthesizer can mutate:
  volumetric_multipliers: z.record(z.string(), z.number()).default({}),
  structural_additions: z.array(z.string()).default([]),
})

export type GenerationConfig = z.infer<typeof GenerationConfigSchema>

export const AgentEventSchema = z.discriminatedUnion('agent', [
  z.object({ agent: z.literal('challenger'), content: z.string(), pair_id: z.string() }),
  z.object({ agent: z.literal('strong_solver'), content: z.string(), pair_id: z.string() }),
  z.object({ agent: z.literal('verifier'), content: z.string(), pair_id: z.string(), exit_code: z.number() }),
  z.object({ agent: z.literal('weak_solver'), content: z.string(), pair_id: z.string() }),
  z.object({ agent: z.literal('recipe'), content: z.string(), config_patch: z.record(z.unknown()) }),
  z.object({ agent: z.literal('system'), content: z.string(), pairs_completed: z.number(), total: z.number() }),
])

export type AgentEvent = z.infer<typeof AgentEventSchema>
```

---

## The 4-Agent Loop (packages/inference/src/loop.ts)

```
[Challenger] → generates (question, raw_answer) from vector index
     ↓
[Strong Solver (Claude)] → generates full CoT + verified answer
     ↓ (if answer differs, back to challenger)
[Verifier (Qwen)] → writes Python unit test, runs in AgentBox sandbox
     ↓ (exit code 0 = passed)
[Weak Solver (Nemotron)] → attempts the question
     ↓
FilterGate: verification_passed AND weak_answer != ground_truth_answer
     ↓ (if true)
Emit TrainingPair → accumulate in dataset
     ↓ (every 10 pairs or error pattern detected)
[Recipe Synthesizer (Claude)] → mutates GenerationConfig
```

The loop runs as a Next.js API Route Handler (Node runtime, no edge). Each step emits SSE events via a `ReadableStream`. The loop stops when `pairs_completed >= target_count`.

---

## Frontend Architecture

### State Management: Zustand

```ts
// apps/web/lib/store.ts
interface BrickByBrickState {
  // Ingest
  uploadedFiles: File[]
  vectorizedChunks: number
  generationConfig: GenerationConfig
  
  // Synthesis
  isRunning: boolean
  agentEvents: AgentEvent[]
  trainingPairs: TrainingPair[]
  currentConfig: GenerationConfig
  
  // Training
  trainingStatus: 'idle' | 'provisioning' | 'training' | 'complete' | 'error'
  lossHistory: { step: number; train: number; val: number }[]
  downloadUrl: string | null
}
```

### Real-time Updates: Server-Sent Events (SSE)

Next.js Route Handler pattern:
```ts
// app/api/synthesis/stream/route.ts
export async function POST(request: Request) {
  const { generationConfig } = await request.json()
  
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const emit = (event: AgentEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      // run loop, emit events
      await runAgentLoop(generationConfig, emit)
      controller.close()
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
```

### Styling

- Tailwind CSS 3.4 + shadcn/ui
- Dark theme: background `#0a0a0a`, surface `#111111`, accent `#ffffff`, muted `#6b7280`
- Typography: `font-mono` for terminal outputs, `font-sans` for prose
- Charts: Recharts (already in `recharts` package)
- JSON diff: `react-diff-viewer-continued`

---

## Dependency Versions (all locked)

```json
{
  "next": "^15.3.4",
  "react": "^19.1.0",
  "react-dom": "^19.1.0",
  "typescript": "^5.7.3",
  "tailwindcss": "^3.4.20",
  "zustand": "^5.0.5",
  "zod": "^3.24.2",
  "@anthropic-ai/sdk": "^0.54.0",
  "openai": "^4.103.0",
  "recharts": "^2.15.3",
  "react-diff-viewer-continued": "^3.4.0",
  "react-dropzone": "^14.3.8"
}
```

---

## Agent Responsibilities Summary

| Agent | Packages / Files | Branch |
|---|---|---|
| **Setup** | Entire scaffold | main |
| **A: Core + Inference** | packages/core, packages/inference | feat/core-inference |
| **B: AgentBox + Trainer** | packages/agentbox, packages/trainer | feat/agentbox-trainer |
| **C: UI Landing + Ingest** | app/page.tsx, app/ingest/, components/dropzone,rag-profiler,target-config, lib/store.ts | feat/ui-landing-ingest |
| **D: UI Synthesis** | app/synthesis/, components/challenger-terminal,strong-solver-transcript,verifier-logs,weak-solver-deck,recipe-viewer,orchestration-ribbon, api/synthesis/stream | feat/ui-synthesis |
| **E: UI Training** | app/training/, components/loss-graph,status-blueprint,download-center, api/training/stream | feat/ui-training |
| **Integration** | Merge all branches, wire data flow, E2E tests | main |
