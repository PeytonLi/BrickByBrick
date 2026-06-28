# Intent Front-Door (Feature A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user type a plain-language goal ("a model good at React") and turn it into an editable `GenerationConfig` that steers the existing visual loop.

**Architecture:** A new strong-model call (`expandIntent`) maps free text → a partial `GenerationConfig` (`domain_framing`, `framework`, `challenger_weights`) + sample task titles. A new `POST /api/intent/expand` returns it; the dashboard shows an editable "Run plan" card, then posts the (edited) config to the existing `/api/agent/visual-loop/stream`. The Challenger prompt gains an additive steering block. The verifier (Antigravity audit) is untouched.

**Tech Stack:** TypeScript, Zod, Next.js (App Router, route handlers), Zustand, Vitest, pnpm workspaces.

## Global Constraints

- Additive `@brickbybrick/core` changes only — never break existing `GenerationConfigSchema` / `AgentEvent` consumers. A config with no intent must still parse and run.
- Front-end-UI domain only (scope A1). No new verifiers, no non-visual domains.
- Every new API route supports `BBB_DEMO_MODE=1` with a deterministic stub (CI/e2e never makes live calls).
- Model ids resolve via existing `STRONG_MODEL()` env indirection — never hardcode.
- Follow existing patterns: routes mirror `apps/web/app/api/agent/visual-loop/stream/route.ts`; store changes mirror `reduceAgentState` in `apps/web/lib/store.ts`.
- Run all commands from the repo root `C:\Users\lipey\Code\BrickByBrick`.

---

### Task 1: Core contract — intent fields + `intent_expanded` event

**Files:**
- Modify: `packages/core/src/schemas.ts` (`GenerationConfigSchema` ~33-47; `AgentEventSchema` ~148-171)
- Test: `packages/core/src/schemas.test.ts` (create if absent)

**Interfaces:**
- Produces: `GenerationConfig.intent?: string`, `GenerationConfig.domain_framing?: string`, `GenerationConfig.framework?: string`; `AgentEvent` variant `{ type: 'intent_expanded'; config: Partial<GenerationConfig>; sample_titles: string[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/schemas.test.ts
import { describe, it, expect } from 'vitest'
import { GenerationConfigSchema, AgentEventSchema } from './schemas'

describe('GenerationConfig intent fields (Feature A)', () => {
  it('still parses an empty config (back-compat)', () => {
    const c = GenerationConfigSchema.parse({})
    expect(c.tau).toBe(0.4)
    expect(c.intent).toBeUndefined()
  })
  it('accepts intent / domain_framing / framework', () => {
    const c = GenerationConfigSchema.parse({
      intent: 'good at react',
      domain_framing: 'React responsive layouts',
      framework: 'react',
    })
    expect(c.framework).toBe('react')
  })
})

describe('intent_expanded AgentEvent (Feature A)', () => {
  it('parses an intent_expanded event', () => {
    const e = AgentEventSchema.parse({
      type: 'intent_expanded',
      config: { domain_framing: 'x', challenger_weights: { 'responsive-card-grid': 3 } },
      sample_titles: ['A', 'B'],
    })
    expect(e.type).toBe('intent_expanded')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @brickbybrick/core test -- schemas`
Expected: FAIL — `intent_expanded` not in union / `framework` stripped.

- [ ] **Step 3: Add the fields and variant**

In `GenerationConfigSchema` object (after `focus_mechanism`):
```ts
  /** raw user goal that produced this config (Feature A; provenance) */
  intent: z.string().optional(),
  /** LLM-expanded steering paragraph injected into the Challenger (Feature A) */
  domain_framing: z.string().optional(),
  /** front-end framework hint, e.g. "react" | "vue" | "vanilla" (Feature A) */
  framework: z.string().optional(),
```
In `AgentEventSchema` discriminated union (add a member):
```ts
  z.object({
    type: z.literal('intent_expanded'),
    config: GenerationConfigSchema.partial(),
    sample_titles: z.array(z.string()),
  }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @brickbybrick/core test -- schemas`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schemas.ts packages/core/src/schemas.test.ts
git commit -m "feat(core): add intent fields + intent_expanded event (Feature A)"
```

---

### Task 2: Intent expander — prompt + `expandIntent()`

**Files:**
- Modify: `packages/inference/src/prompts.ts` (add `INTENT_EXPANDER_SYSTEM`)
- Create: `packages/inference/src/intent.ts`
- Modify: `packages/inference/src/index.ts` (add `export * from './intent'`)
- Test: `packages/inference/src/intent.test.ts`

**Interfaces:**
- Consumes: `generateContent`, `STRONG_MODEL`, `stripCodeFences`, `RetryOptions` from `./gemini`; `GenerationConfigSchema` from `@brickbybrick/core`.
- Produces: `expandIntent(intent: string, opts?: RetryOptions): Promise<{ config: Partial<GenerationConfig>; sample_titles: string[] }>`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/inference/src/intent.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { expandIntent } from './intent'

const noSleep = async () => {}
function mockGenerate(jsonText: string) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: jsonText }] } }] }),
    text: async () => '',
  })))
}
afterEach(() => vi.unstubAllGlobals())

describe('expandIntent', () => {
  it('maps intent to a partial GenerationConfig + sample titles', async () => {
    mockGenerate(JSON.stringify({
      domain_framing: 'React responsive grids',
      framework: 'react',
      challenger_weights: { 'responsive-card-grid': 3, 'modal-focus-trap': 2 },
      focus_mechanism: null,
      sample_titles: ['Pricing grid', 'Photo wall'],
    }))
    const r = await expandIntent('I want a model good at react', { sleep: noSleep })
    expect(r.config.intent).toBe('I want a model good at react')
    expect(r.config.framework).toBe('react')
    expect(r.config.challenger_weights).toMatchObject({ 'responsive-card-grid': 3 })
    expect(r.sample_titles).toHaveLength(2)
  })
  it('rejects empty intent', async () => {
    await expect(expandIntent('   ')).rejects.toThrow(/empty/)
  })
  it('throws on non-JSON model output', async () => {
    mockGenerate('not json at all')
    await expect(expandIntent('x', { sleep: noSleep })).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @brickbybrick/inference test -- intent`
Expected: FAIL — `./intent` not found.

- [ ] **Step 3: Add the prompt**

Append to `packages/inference/src/prompts.ts`:
```ts
export const INTENT_EXPANDER_SYSTEM = `You translate a user's plain-language goal for a fine-tuned FRONT-END UI model into a
generation plan for an adversarial visual-UI curriculum. This product ONLY trains front-end
(React/CSS/HTML) UI skills — map any goal onto front-end UI mechanisms.

Respond with EXACTLY this JSON (no markdown, no code fences):
{
  "domain_framing": "<1-3 sentences telling the challenger what UI domain/style to target>",
  "framework": "<react|vue|svelte|vanilla>",
  "challenger_weights": { "<ui-mechanism-kebab-id>": <relative weight 1..5> },
  "focus_mechanism": "<single mechanism to focus on, or null>",
  "sample_titles": ["<short example task title>", "..."]
}

Rules:
- 3-6 challenger_weights, each a concrete UI mechanism (e.g. "responsive-card-grid",
  "modal-focus-trap", "sticky-header-on-scroll", "long-text-truncation", "virtualized-list").
- Weights > 1 mean "prefer"; the loop samples toward them.
- sample_titles: 2-3 plausible task titles so the user can sanity-check direction.
- If the goal is not front-end-shaped, still pick the closest front-end mechanisms and say so in domain_framing.`
```

- [ ] **Step 4: Write `intent.ts`**

```ts
// packages/inference/src/intent.ts
import { GenerationConfigSchema, type GenerationConfig } from '@brickbybrick/core'
import { generateContent, STRONG_MODEL, stripCodeFences, type RetryOptions } from './gemini'
import { INTENT_EXPANDER_SYSTEM } from './prompts'

export interface ExpandedIntent {
  config: Partial<GenerationConfig>
  sample_titles: string[]
}

function parseJsonObject(text: string): Record<string, unknown> {
  const cleaned = stripCodeFences(text)
  try {
    return JSON.parse(cleaned) as Record<string, unknown>
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (m) return JSON.parse(m[0]) as Record<string, unknown>
    throw new Error('intent expander returned non-JSON output')
  }
}

function isWeightRecord(v: unknown): v is Record<string, number> {
  return (
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.values(v as Record<string, unknown>).every((x) => typeof x === 'number')
  )
}

export async function expandIntent(
  intent: string,
  opts: RetryOptions = {},
): Promise<ExpandedIntent> {
  const text = intent.trim()
  if (!text) throw new Error('intent is empty')

  const raw = await generateContent(STRONG_MODEL(), INTENT_EXPANDER_SYSTEM, text, opts)
  const obj = parseJsonObject(raw)

  const config = GenerationConfigSchema.partial().parse({
    intent: text,
    domain_framing: typeof obj.domain_framing === 'string' ? obj.domain_framing : undefined,
    framework: typeof obj.framework === 'string' ? obj.framework : undefined,
    challenger_weights: isWeightRecord(obj.challenger_weights) ? obj.challenger_weights : undefined,
    focus_mechanism: typeof obj.focus_mechanism === 'string' ? obj.focus_mechanism : undefined,
  })

  const sample_titles = Array.isArray(obj.sample_titles)
    ? (obj.sample_titles.filter((t) => typeof t === 'string') as string[]).slice(0, 3)
    : []

  return { config, sample_titles }
}
```
Then add to `packages/inference/src/index.ts`: `export * from './intent'`

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @brickbybrick/inference test -- intent`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/inference/src/intent.ts packages/inference/src/prompts.ts packages/inference/src/index.ts packages/inference/src/intent.test.ts
git commit -m "feat(inference): add expandIntent + INTENT_EXPANDER_SYSTEM (Feature A)"
```

---

### Task 3: Challenger prompt steering

**Files:**
- Modify: `packages/inference/src/loop.ts` (`buildChallengerPrompt` ~292-305 — add `export`, add framing/framework lines)
- Test: `packages/inference/src/loop.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `GenerationConfig` (now with `domain_framing`/`framework`).
- Produces: `export function buildChallengerPrompt(config: GenerationConfig): string` (now exported for testing).

- [ ] **Step 1: Write the failing test**

```ts
// add to packages/inference/src/loop.test.ts
import { buildChallengerPrompt } from './loop'
import { GenerationConfigSchema } from '@brickbybrick/core'

describe('buildChallengerPrompt — intent steering (Feature A)', () => {
  it('is unchanged when no intent fields are set', () => {
    const p = buildChallengerPrompt(GenerationConfigSchema.parse({}))
    expect(p).not.toMatch(/Target domain:/)
    expect(p).not.toMatch(/framework/i)
  })
  it('injects domain_framing and framework when present', () => {
    const p = buildChallengerPrompt(
      GenerationConfigSchema.parse({ domain_framing: 'React dashboards', framework: 'react' }),
    )
    expect(p).toMatch(/Target domain: React dashboards/)
    expect(p).toMatch(/react framework/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @brickbybrick/inference test -- loop`
Expected: FAIL — `buildChallengerPrompt` not exported.

- [ ] **Step 3: Export and extend `buildChallengerPrompt`**

Replace the function in `loop.ts`:
```ts
export function buildChallengerPrompt(config: GenerationConfig): string {
  const parts = [CHALLENGER_SYSTEM];
  if (config.domain_framing) parts.push(`Target domain: ${config.domain_framing}`);
  if (config.framework)
    parts.push(`Implement every task for the ${config.framework} framework.`);
  if (config.focus_mechanism) {
    parts.push(`Focus exclusively on the UI mechanism: ${config.focus_mechanism}.`);
  }
  const weighted = Object.entries(config.challenger_weights)
    .filter(([, w]) => w > 1)
    .map(([m]) => m);
  if (weighted.length)
    parts.push(`Prefer these mechanisms: ${weighted.join(", ")}.`);
  return parts.join("\n\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @brickbybrick/inference test -- loop`
Expected: PASS (existing loop tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add packages/inference/src/loop.ts packages/inference/src/loop.test.ts
git commit -m "feat(inference): steer Challenger from intent domain_framing/framework (Feature A)"
```

---

### Task 4: `POST /api/intent/expand` route + demo stub

**Files:**
- Create: `apps/web/app/api/intent/expand/route.ts`
- Test: `apps/web/app/api/intent/expand/route.test.ts`

**Interfaces:**
- Consumes: `expandIntent` from `@brickbybrick/inference` (live); `BBB_DEMO_MODE` for stub.
- Produces: `POST /api/intent/expand` body `{ intent: string }` → `{ config: Partial<GenerationConfig>; sample_titles: string[]; warning?: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/api/intent/expand/route.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { POST } from './route'

describe('POST /api/intent/expand', () => {
  beforeEach(() => { process.env.BBB_DEMO_MODE = '1' })
  afterEach(() => { delete process.env.BBB_DEMO_MODE })

  it('400s on empty intent', async () => {
    const res = await POST(new Request('http://t/api/intent/expand', {
      method: 'POST', body: JSON.stringify({ intent: '' }),
    }))
    expect(res.status).toBe(400)
  })
  it('returns a deterministic plan in demo mode', async () => {
    const res = await POST(new Request('http://t/api/intent/expand', {
      method: 'POST', body: JSON.stringify({ intent: 'good at react' }),
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.config.intent).toBe('good at react')
    expect(Array.isArray(body.sample_titles)).toBe(true)
    expect(Object.keys(body.config.challenger_weights ?? {}).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ./apps/web exec vitest run app/api/intent/expand`
Expected: FAIL — `./route` not found.

- [ ] **Step 3: Write the route**

```ts
// apps/web/app/api/intent/expand/route.ts
import { NextResponse } from 'next/server'
import type { GenerationConfig } from '@brickbybrick/core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ExpandResult {
  config: Partial<GenerationConfig>
  sample_titles: string[]
  warning?: string
}

function demoExpand(intent: string): ExpandResult {
  return {
    config: {
      intent,
      domain_framing: `Front-end UI tasks aligned to: ${intent}`,
      framework: 'react',
      challenger_weights: { 'responsive-card-grid': 3, 'modal-focus-trap': 2, 'long-text-truncation': 2 },
    },
    sample_titles: ['Responsive pricing grid', 'Accessible modal dialog', 'Truncated card titles'],
  }
}

export async function POST(request: Request) {
  let intent = ''
  try {
    intent = (((await request.json()) as { intent?: string }).intent ?? '').trim()
  } catch {
    intent = ''
  }
  if (!intent) {
    return NextResponse.json({ error: 'intent is required' }, { status: 400 })
  }

  if (process.env.BBB_DEMO_MODE === '1') {
    return NextResponse.json(demoExpand(intent))
  }

  try {
    const { expandIntent } = (await import('@brickbybrick/inference')) as {
      expandIntent: (t: string) => Promise<ExpandResult>
    }
    return NextResponse.json(await expandIntent(intent))
  } catch (error) {
    // Never block a run on a bad expansion — fall back to a minimal usable config.
    return NextResponse.json({
      config: { intent } as Partial<GenerationConfig>,
      sample_titles: [],
      warning: error instanceof Error ? error.message : 'intent expansion failed',
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter ./apps/web exec vitest run app/api/intent/expand`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/intent/expand/route.ts apps/web/app/api/intent/expand/route.test.ts
git commit -m "feat(web): POST /api/intent/expand with demo stub (Feature A)"
```

---

### Task 5: Dashboard intent UI — store + control center

**Files:**
- Modify: `apps/web/lib/store.ts` (state + `reduceAgentState` + initial state + `persistedSnapshot`)
- Modify: `apps/web/components/dashboard/control-center.tsx`
- Test: `apps/web/lib/store.test.ts` (add an `intent_expanded` case)

**Interfaces:**
- Consumes: `intent_expanded` AgentEvent; `POST /api/intent/expand`.
- Produces: store fields `derivedConfig: Partial<GenerationConfig> | null`, `sampleTitles: string[]`; UI posts merged config to `/api/agent/visual-loop/stream`.

- [ ] **Step 1: Write the failing store test**

```ts
// add to apps/web/lib/store.test.ts
import { reduceAgentState, initialAgentState } from './store'

describe('reduceAgentState — intent_expanded (Feature A)', () => {
  it('records derivedConfig and sample titles', () => {
    const s = reduceAgentState(initialAgentState, {
      type: 'intent_expanded',
      config: { intent: 'react', framework: 'react', challenger_weights: { 'responsive-card-grid': 3 } },
      sample_titles: ['A', 'B'],
    })
    expect(s.derivedConfig?.framework).toBe('react')
    expect(s.sampleTitles).toEqual(['A', 'B'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ./apps/web exec vitest run lib/store`
Expected: FAIL — `derivedConfig` undefined.

- [ ] **Step 3: Extend the store**

In `AgentStoreSnapshot` add:
```ts
  derivedConfig: Partial<GenerationConfig> | null;
  sampleTitles: string[];
```
In `initialAgentState` add: `derivedConfig: null,` and `sampleTitles: [],`
In `reduceAgentState` switch add a case:
```ts
    case "intent_expanded":
      return { ...base, derivedConfig: event.config, sampleTitles: event.sample_titles };
```
In `persistedSnapshot` add: `derivedConfig: state.derivedConfig,` and `sampleTitles: state.sampleTitles,`

- [ ] **Step 4: Run store test to verify it passes**

Run: `pnpm --filter ./apps/web exec vitest run lib/store`
Expected: PASS.

- [ ] **Step 5: Wire the UI in `control-center.tsx`**

Add local state + a derive handler near the other handlers:
```tsx
const [intent, setIntent] = useState("");
const [deriving, setDeriving] = useState(false);
const derivedConfig = useAgentStore((s) => s.derivedConfig);
const sampleTitles = useAgentStore((s) => s.sampleTitles);

async function derivePlan() {
  if (!intent.trim()) return;
  setDeriving(true);
  try {
    const res = await fetch("/api/intent/expand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent }),
    });
    const data = (await res.json()) as {
      config: Record<string, unknown>;
      sample_titles: string[];
    };
    consumeEvent({ type: "intent_expanded", config: data.config, sample_titles: data.sample_titles });
  } finally {
    setDeriving(false);
  }
}
```
Change `runVisualLoop`'s body to merge the derived config:
```tsx
body: JSON.stringify({ config: { ...(derivedConfig ?? {}), max_pairs: targetPairs } }),
```
Add the intent input + plan card above the `<LiveMediaRoom .../>` (mirror existing Card/Badge styling):
```tsx
<section className="flex flex-col gap-3 border-b border-white/10 pb-5">
  <label className="text-sm text-zinc-300">What should the model get good at?</label>
  <div className="flex gap-2">
    <input
      className="h-9 flex-1 rounded-md border border-white/10 bg-black px-3 text-sm text-white outline-none focus:border-emerald-300"
      placeholder="e.g. a model good at responsive React layouts"
      value={intent}
      onChange={(e) => setIntent(e.target.value)}
      aria-label="Model intent"
    />
    <Button onClick={derivePlan} disabled={deriving || !intent.trim()}>
      {deriving ? <Loader2 className="size-4 animate-spin" /> : null} Derive plan
    </Button>
  </div>
  {derivedConfig ? (
    <div className="rounded-md border border-white/10 bg-white/[0.02] p-3 text-xs text-zinc-300">
      <div>Framework: <span className="text-white">{derivedConfig.framework ?? "—"}</span></div>
      <div className="mt-1">Framing: {derivedConfig.domain_framing ?? "—"}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {Object.entries(derivedConfig.challenger_weights ?? {}).map(([m, w]) => (
          <span key={m} className="rounded border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5">
            {m} ·{String(w)}
          </span>
        ))}
      </div>
      {sampleTitles.length ? (
        <div className="mt-2 text-zinc-400">e.g. {sampleTitles.join(" · ")}</div>
      ) : null}
    </div>
  ) : null}
</section>
```

- [ ] **Step 6: Verify build + type-check**

Run: `pnpm --filter ./apps/web exec tsc -p tsconfig.typecheck.json --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/store.ts apps/web/lib/store.test.ts apps/web/components/dashboard/control-center.tsx
git commit -m "feat(web): intent input + editable derived-plan card (Feature A)"
```

---

## Final verification

- [ ] Run `pnpm -r test build type-check` → all green.
- [ ] Manual (optional, costs ~cents): with real keys, type an intent, confirm the derived plan renders and "Run loop" generates tasks aligned to the intent.
