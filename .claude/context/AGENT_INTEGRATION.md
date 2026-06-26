# Integration Agent Brief

## Context

You are the Integration Agent for BrickByBrick. All five feature branches have been completed and merged into main. Your job is to:

1. Verify the build is green
2. Fix any cross-branch integration issues
3. Wire up any missing data-flow connections
4. Run E2E tests using /tdd-workflow

Read `.claude/context/ARCHITECTURE.md` for the complete system design.

## Branches to Merge

```bash
git merge feat/core-inference --no-ff -m "feat: merge core and inference packages"
git merge feat/agentbox-trainer --no-ff -m "feat: merge agentbox and trainer packages"
git merge feat/ui-landing-ingest --no-ff -m "feat: merge landing and ingest UI"
git merge feat/ui-synthesis --no-ff -m "feat: merge synthesis UI"
git merge feat/ui-training --no-ff -m "feat: merge training UI"
```

Resolve any merge conflicts by following the ARCHITECTURE.md decisions.

## Common Integration Issues to Fix

### 1. Zustand store import in lib/store.ts
Agent C owns this file. Check that Agents D and E import from the correct path:
```ts
import { useStore } from '@/lib/store'  // correct
```

### 2. AgentBox import in synthesis stream route
The synthesis stream route (Agent D) imports from `@brickbybrick/agentbox`. Verify the agentbox package exports are correct and the mock is used when `AGENTBOX_MOCK=true`.

### 3. Trainer imports in training stream route
Agent E's training route imports from `@brickbybrick/trainer`. Verify `exportDataset` and `startTraining` are properly exported from `packages/trainer/src/index.ts`.

### 4. Environment variables
Create `.env.local` in `apps/web/` with:
```
NEBIUS_API_KEY=<from user>
ANTHROPIC_API_KEY=<from user>
AGENTBOX_API_KEY=<from user>
PRIME_INTELLECT_API_KEY=<from user>
AGENTBOX_MOCK=true
```

### 5. Build verification
```bash
pnpm install
pnpm turbo run build
```

If Next.js build fails with SSR issues (importing node modules in client components), add `'use client'` directives where missing.

### 6. shadcn components
If any shadcn component is missing, add it:
```bash
cd apps/web && pnpm dlx shadcn@latest add [component-name]
```

## E2E Testing with /tdd-workflow

After the build is green, invoke the `/tdd-workflow` skill. The critical user journeys to test:

### Journey 1: File Upload Flow
1. Navigate to `/ingest`
2. Drop a file on the dropzone
3. Verify file appears in the list
4. Verify RAG profiler shows streaming output
5. Verify target config can be submitted
6. Verify redirect to `/synthesis`

### Journey 2: Agent Loop Start
1. Navigate to `/synthesis`
2. Click "Start" button
3. Verify orchestration ribbon shows "RUNNING"
4. Verify all 4 agent cards start receiving content
5. Verify pairs counter increments
6. Verify recipe viewer shows diff when config mutates
7. Emergency stop: click STOP, verify loop halts

### Journey 3: Training Flow
1. Navigate to `/training` (with pairs in store)
2. Click "Start Training"
3. Verify status blueprint shows provisioning events
4. Verify loss graph starts populating
5. Verify download center illuminates when complete

### Journey 4: Landing Page
1. Navigate to `/`
2. Verify metrics count up
3. Verify CTA button navigates to `/ingest`
4. Verify architecture diagram renders

## Test Setup

Install Playwright:
```bash
cd apps/web
pnpm add -D @playwright/test
pnpm exec playwright install chromium
```

Create `apps/web/playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:3000',
  },
  webServer: {
    command: 'pnpm dev',
    port: 3000,
    reuseExistingServer: true,
  },
})
```

Write tests in `apps/web/e2e/`. Use `AGENTBOX_MOCK=true` for all tests so no real API calls are made.

## Final Commit

After all tests pass:
```bash
git add -A && git commit -m "feat: integration complete, E2E tests passing"
```

## Success Criterion

- `pnpm turbo run build` exits 0
- All 4 pages load without errors
- The synthesis stream works in mock mode (AGENTBOX_MOCK=true)
- The training stream works with mock loss data
- E2E tests pass for all 4 journeys
