# Agent C · Inference — DO Serverless Fallback

**Owns:** `packages/inference/src/` (refactor + add `providers/`)  
**Must not touch:** `packages/core/`, `packages/trainer/`, `apps/web/`  
**Depends on:** Nothing (parallel with A, B, D)  
**Master plan:** `PLAN_DO_ATLAS.md`

## What you're building

A provider abstraction that lets the loop use Gemini (primary) with automatic fallback to DigitalOcean serverless inference. No loop logic changes, no prompt changes — just the client layer gets a retry-with-fallback wrapper.

## Architecture

```
packages/inference/src/
├── gemini.ts              # KEEP, EDIT: extract model call functions into SolverSet factory
├── providers/             # NEW directory
│   ├── interface.ts       # ChatProvider, EmbedProvider, SolverSet types
│   ├── gemini.ts          # GeminiSolverSet — wraps current gemini.ts functions
│   ├── do-serverless.ts   # DOServerlessSolverSet — OpenAI-compatible DO client
│   └── fallback.ts        # createFallbackSolverSet(primary, fallback) → SolverSet
├── prompts.ts             # NO CHANGE
├── antigravity.ts         # NO CHANGE
├── loop.ts                # MINIMAL EDIT: accept optional SolverSet in defaultDeps()
├── metrics.ts             # NO CHANGE
├── training.ts            # NO CHANGE
└── index.ts               # EDIT: export providers/
```

## Step-by-step

### Step 1: Create `providers/interface.ts`

```ts
import type { VisualTask, Defect } from '@brickbybrick/core'

export interface ChatProvider {
  generate(model: string, systemPrompt: string, userPrompt: string): Promise<string>
}

export interface EmbedProvider {
  embed(text: string): Promise<number[]>
}

/** The set of solver capabilities the loop needs. */
export interface SolverSet {
  /** The strong model (Gemini 3.1 Pro / Claude 4.6 Sonnet) — used for challenger + strongSolver */
  strongModel: string
  /** The weak model (Gemma 4 / Llama 3.3) */
  weakModel: string
  /** One-shot generation */
  generate(model: string, systemPrompt: string, userPrompt: string): Promise<string>
  /** Text embedding for diversity gate */
  embed(text: string): Promise<number[]>
}
```

### Step 2: Create `providers/gemini.ts`

Refactor the existing `packages/inference/src/gemini.ts` functions into a `SolverSet` factory:

```ts
import type { SolverSet } from './interface'
import { STRONG_MODEL, WEAK_MODEL, generateContent, embed as geminiEmbed } from '../gemini'

export function createGeminiSolverSet(): SolverSet {
  return {
    strongModel: STRONG_MODEL(),
    weakModel: WEAK_MODEL(),
    generate: generateContent,
    embed: geminiEmbed,
  }
}
```

**Important:** Keep the original `gemini.ts` functions (`generateContent`, `weakSolver`, `strongSolver`, `embed`, `stripCodeFences`, `withRetry`) working as-is — they're imported by `loop.ts` `defaultDeps()`. Only add the new `createGeminiSolverSet()` export. Do NOT break the existing public API.

### Step 3: Create `providers/do-serverless.ts`

```ts
import OpenAI from 'openai'
import type { SolverSet } from './interface'

const DO_BASE_URL = 'https://inference.do-ai.run/v1/'

function apiKey(): string {
  const key = process.env.DIGITALOCEAN_MODEL_ACCESS_KEY
  if (!key) throw new Error('DIGITALOCEAN_MODEL_ACCESS_KEY is not set')
  return key
}

function resolveModel(envKey: string, fallback: string): string {
  return process.env[envKey] || fallback
}

function createDOClient(): OpenAI {
  return new OpenAI({ baseURL: DO_BASE_URL, apiKey: apiKey() })
}

export function createDOSolverSet(): SolverSet {
  const strongModel = resolveModel('DO_STRONG_MODEL', 'anthropic-claude-4.6-sonnet')
  const weakModel = resolveModel('DO_WEAK_MODEL', 'llama3.3-70b-instruct')

  return {
    strongModel,
    weakModel,
    generate: async (model, systemPrompt, userPrompt) => {
      const client = createDOClient()
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
      messages.push({ role: 'user', content: userPrompt })

      const res = await client.chat.completions.create({
        model,
        messages,
        max_completion_tokens: 8192,
      })
      return res.choices[0]?.message?.content ?? ''
    },
    embed: async (text) => {
      const embedModel = process.env.DO_EMBED_MODEL || 'gte-large'
      const client = createDOClient()
      const res = await client.embeddings.create({
        model: embedModel,
        input: text,
      })
      return res.data[0]?.embedding ?? []
    },
  }
}
```

**Dependency:** Install `openai` in `packages/inference/package.json`:
```bash
pnpm add openai --filter @brickbybrick/inference
```

### Step 4: Create `providers/fallback.ts`

```ts
import type { SolverSet } from './interface'

export interface FallbackOptions {
  /** Called when fallback is activated (for narration/logging) */
  onFallback?: (method: string, primaryError: Error) => void
  /** HTTP status codes that trigger fallback */
  retryOn?: number[]
}

export function createFallbackSolverSet(
  primary: SolverSet,
  fallback: SolverSet,
  options: FallbackOptions = {},
): SolverSet {
  const onFallback = options.onFallback
  const retryOn = new Set(options.retryOn ?? [429, 500, 502, 503, 504])

  function shouldFallback(err: unknown): boolean {
    if (err instanceof Error) {
      const statusMatch = err.message.match(/\b(\d{3})\b/)
      if (statusMatch && retryOn.has(Number(statusMatch[1]))) return true
    }
    return false
  }

  async function tryWithFallback<T>(
    method: string,
    primaryFn: () => Promise<T>,
    fallbackFn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await primaryFn()
    } catch (err) {
      if (shouldFallback(err)) {
        onFallback?.(method, err instanceof Error ? err : new Error(String(err)))
        return fallbackFn()
      }
      throw err
    }
  }

  return {
    strongModel: primary.strongModel,   // use primary model names; fallback maps internally
    weakModel: primary.weakModel,
    generate: (model, system, user) =>
      tryWithFallback(
        'generate',
        () => primary.generate(primary.strongModel, system, user),
        () => fallback.generate(fallback.strongModel, system, user),
      ),
    embed: (text) =>
      tryWithFallback(
        'embed',
        () => primary.embed(text),
        () => fallback.embed(text),
      ),
  }
}
```

### Step 5: Edit `loop.ts` — inject SolverSet into `defaultDeps()`

The current `defaultDeps()` at line 290 directly calls `generateContent(STRONG_MODEL(), ...)` for the challenger and `geminiEmbed` for embeddings. Add an optional `solverSet` parameter:

**Change the function signature (line 290):**
```ts
export function defaultDeps(opts?: { solverSet?: SolverSet }): VisualLoopDeps {
  const solver = opts?.solverSet

  return {
    challenge: async (config) => {
      const raw = solver
        ? await solver.generate(solver.strongModel, buildChallengerPrompt(config), 'Generate one adversarial UI task now.')
        : await generateContent(STRONG_MODEL(), buildChallengerPrompt(config), 'Generate one adversarial UI task now.')
      const parsed = safeJson<unknown>(raw)
      return VisualTaskSchema.parse(parsed)
    },
    weakSolver,     // unchanged — still uses existing weakSolver from gemini.ts
    strongSolver: (task, defect, weakCode) => strongSolver(task, defect, weakCode),  // unchanged
    // ...
    embed: solver
      ? solver.embed
      : geminiEmbed,  // fallback to original if no SolverSet provided
    // ... rest unchanged
  }
}
```

**Add import at top:**
```ts
import type { SolverSet } from './providers/interface'
```

### Step 6: Edit `index.ts` — export new symbols

```ts
export * from './metrics'
export * from './prompts'
export * from './gemini'
export * from './antigravity'
export * from './loop'
export * from './training'

// New — provider abstraction
export * from './providers/interface'
export { createGeminiSolverSet } from './providers/gemini'
export { createDOSolverSet } from './providers/do-serverless'
export { createFallbackSolverSet } from './providers/fallback'
```

### Step 7: Create `__tests__/providers/`

```
packages/inference/__tests__/
└── providers/
    ├── gemini.test.ts
    ├── do-serverless.test.ts
    └── fallback.test.ts
```

#### fallback.test.ts
- Mock primary that throws 429 → fallback used, result returned
- Mock primary that throws 500 → fallback used
- Mock primary succeeds → fallback NOT called
- Mock both fail → error propagates
- `onFallback` callback called on switch

#### do-serverless.test.ts
- Verify payload shape matches OpenAI chat completions format
- Verify `DIGITALOCEAN_MODEL_ACCESS_KEY` required (throws if missing)
- Embedding call returns number array

## Environment variables (Agent E adds to .env.example)

```
DIGITALOCEAN_MODEL_ACCESS_KEY=
DO_STRONG_MODEL=anthropic-claude-4.6-sonnet
DO_WEAK_MODEL=llama3.3-70b-instruct
DO_EMBED_MODEL=gte-large
```

## Key rules

1. **Do NOT remove or rename existing exports from `gemini.ts`.** `loop.ts`, `antigravity.ts`, and `training.ts` import them. Add, don't replace.
2. **The existing behavior when no `solverSet` is passed to `defaultDeps()` must remain identical.** No regression.
3. **`openai` npm package is a new dependency** for `@brickbybrick/inference`. Install it.
4. **DO serverless base URL is `https://inference.do-ai.run/v1/`** — OpenAI SDK compatible.
5. **Embeddings on DO use a different endpoint** (`/v1/embeddings`). Check the DO docs for available embedding model IDs.

## Verification

```bash
pnpm install
pnpm turbo run build --filter=@brickbybrick/inference
pnpm turbo run type-check --filter=@brickbybrick/inference
pnpm turbo run test --filter=@brickbybrick/inference
```
