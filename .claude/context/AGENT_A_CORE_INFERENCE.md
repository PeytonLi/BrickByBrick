# Feature Agent A — packages/core + packages/inference

## Context

You are Feature Agent A for BrickByBrick. The monorepo scaffold already exists (Setup Agent completed). You are working in a git worktree on branch `feat/core-inference`. Read `.claude/context/ARCHITECTURE.md` for full system context.

**Your scope**: `packages/core` and `packages/inference` only. Do not touch `apps/web` or other packages.

## What You Build

### packages/core/src/schemas.ts

Implement the complete Zod schemas and TypeScript types. Replace the stub with:

```ts
import { z } from 'zod'

export const TrainingPairSchema = z.object({
  id: z.string().uuid(),
  question: z.string(),
  ground_truth_cot: z.string(),
  ground_truth_answer: z.string(),
  weak_answer: z.string(),
  verification_passed: z.boolean(),
  filter_gate: z.boolean(),
  error_category: z.string(),
  schema_version: z.number().default(1),
  created_at: z.string().datetime(),
})
export type TrainingPair = z.infer<typeof TrainingPairSchema>

export const GenerationConfigSchema = z.object({
  target_count: z.number().default(100),
  domain_hint: z.string(),
  error_rates: z.record(z.string(), z.number()).default({}),
  schema_version: z.number().default(1),
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

export const LossPointSchema = z.object({
  step: z.number(),
  train: z.number(),
  val: z.number(),
})
export type LossPoint = z.infer<typeof LossPointSchema>
```

### packages/inference/src/nebius.ts

Nebius is OpenAI-compatible. Use the `openai` package:

```ts
import OpenAI from 'openai'

export const nebiusClient = new OpenAI({
  baseURL: 'https://api.tokenfactory.nebius.com/v1/',
  apiKey: process.env.NEBIUS_API_KEY ?? '',
})

// Check the actual available models via: GET https://api.tokenfactory.nebius.com/v1/models
// Use the closest available Qwen3 model for challenger/verifier
export const NEBIUS_MODELS = {
  challenger: 'Qwen/Qwen3-235B-A22B',    // verify this ID is available
  verifier: 'Qwen/Qwen3-235B-A22B',       // same model
  weak_solver: 'nvidia/Nemotron-3-Nano-Omni', // confirmed
  embedding: 'BAAI/bge-en-icl',           // for RAG
} as const
```

Export typed wrapper functions for each model call. Use streaming where possible. Handle rate limits with exponential backoff (3 retries, 2s base delay).

### packages/inference/src/anthropic.ts

```ts
import Anthropic from '@anthropic-ai/sdk'

export const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? '',
})

export const CLAUDE_MODEL = 'claude-sonnet-4-6'
```

Export a `runStrongSolver(question: string, context: string): Promise<{ cot: string; answer: string }>` function that:
1. Sends the question to Claude with a system prompt instructing step-by-step reasoning
2. Extracts the final answer from the CoT (look for "Therefore," or "The answer is")
3. Returns `{ cot, answer }`

### packages/inference/src/loop.ts

The orchestration core. Export:

```ts
export async function runAgentLoop(
  config: GenerationConfig,
  vectorChunks: string[],      // from agentbox ingest
  emit: (event: AgentEvent) => void,
  runCode: (code: string) => Promise<{ exitCode: number; output: string }>,  // agentbox sandbox
): Promise<TrainingPair[]>
```

The loop:
1. **Challenger**: Call Nebius Qwen with a prompt that extracts a complex question from `vectorChunks`. Return `{ question, raw_answer }`.
2. **Strong Solver**: Call Claude with `question`. Get `{ cot, answer }`. If answer differs wildly from challenger's raw_answer, emit a note but proceed.
3. **Verifier**: Prompt Nebius Qwen to write a Python snippet that verifies `answer` is correct (e.g. eval a math expression, check a logical proof). Execute via `runCode()`. If exit code != 0, skip this pair.
4. **Weak Solver**: Call Nebius Nemotron with just the `question` (no CoT). Get `weak_answer`.
5. **FilterGate**: `verification_passed && weak_answer.trim() !== answer.trim()` → emit pair
6. Every 10 pairs, call **Recipe Synthesizer** (Claude): analyze error categories in the last 10 pairs, return a JSON patch to `config`. Apply the patch. Emit `{ agent: 'recipe', config_patch }`.
7. When `pairs_completed >= config.target_count`, return the pairs array.

Emit `AgentEvent` at each step. Include the full model output in `content`.

### packages/inference/src/prompts.ts

Keep all system prompts here as named constants. This is important — prompts are the product.

```ts
export const CHALLENGER_SYSTEM = `You are a curriculum designer generating evaluation questions...`
export const STRONG_SOLVER_SYSTEM = `You are a meticulous mathematician solving problems step by step...`
export const VERIFIER_SYSTEM = `You write Python 3 code that verifies a mathematical answer...`
export const WEAK_SOLVER_SYSTEM = `Solve the following problem. Give only the final answer.`
export const RECIPE_SYNTHESIZER_SYSTEM = `You analyze model error patterns and return a JSON patch...`
```

Write complete, production-quality prompts. They drive the hackathon demo.

### packages/inference/src/index.ts

Export everything:
```ts
export * from './nebius'
export * from './anthropic'
export * from './loop'
export * from './prompts'
```

## Build Check

Run `pnpm --filter @brickbybrick/core type-check && pnpm --filter @brickbybrick/inference type-check` before finishing. Both must exit 0.

## Commit

`git add -A && git commit -m "feat(core,inference): schemas, API clients, and agent loop"`
