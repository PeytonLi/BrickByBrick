# Agent A · DB — MongoDB Atlas Persistence

**Owns:** `packages/db/` (new package — you create everything)  
**Must not touch:** `packages/core/`, `packages/inference/`, `packages/trainer/`, `apps/web/`  
**Depends on:** Nothing (parallel with B, C, D)  
**Master plan:** `PLAN_DO_ATLAS.md`

## What you're building

A Mongoose-based persistence layer for the visual break-and-fix loop:
- Connection singleton (Next.js hot-reload safe)
- 4 models: Run, Pair, Event, Task
- Tests with `mongodb-memory-server` (zero external deps for CI)

## Package scaffold

```
packages/db/
├── package.json
├── tsconfig.json
├── src/
│   ├── connect.ts        # Mongoose connection singleton
│   ├── models/
│   │   ├── run.ts         # LoopRun model
│   │   ├── pair.ts        # TrainingPair model
│   │   ├── event.ts       # AgentEvent model
│   │   ├── task.ts        # VisualTask bank model
│   │   └── index.ts       # Barrel + model registration
│   ├── types.ts           # DB-specific types
│   └── index.ts           # Public exports
└── __tests__/
    ├── connect.test.ts
    ├── run.test.ts
    └── pair.test.ts
```

## Models — exact specs

### RunModel

```ts
// types.ts
export interface LoopRun {
  runId: string
  config: GenerationConfig       // from @brickbybrick/core
  status: 'running' | 'complete' | 'failed'
  startedAt: Date
  completedAt?: Date
  pairsCommitted: number
  totalIterations: number
}
```

**Schema rules:**
- `runId`: String, unique index, required
- `config`: Mixed (store the full GenerationConfig as-is)
- `status`: String enum, default `'running'`
- `startedAt`: Date, default `Date.now`
- `completedAt`: Date, optional
- `pairsCommitted`: Number, default 0
- `totalIterations`: Number, default 0

**Static methods:**
- `RunModel.latest(limit?: number)` → find most recent runs, sorted by `startedAt` desc
- `RunModel.byId(runId: string)` → find one by runId

### PairModel

```ts
// Mirrors TrainingPair from core + adds DB fields
export interface PersistedPair {
  pairId: string              // from TrainingPair.id
  runId: string               // which loop run this belongs to
  task: VisualTask            // embedded
  weak_code: string
  defect: Defect              // embedded
  strong_code: string
  u_score: number
  createdAt: Date
}
```

**Schema rules:**
- `pairId`: String, unique index, required
- `runId`: String, index, required
- `task`: Mixed (embedded sub-document)
- `weak_code`, `strong_code`: String
- `defect`: Mixed (embedded sub-document)
- `u_score`: Number, index
- `createdAt`: Date, default `Date.now`

**Static methods:**
- `PairModel.byRun(runId: string)` → find all pairs for a run
- `PairModel.byMechanism(mechanism: string)` → find by `task.target_mechanism`
- `PairModel.recent(limit?: number)` → most recent pairs

### EventModel

```ts
export interface PersistedEvent {
  runId: string
  sequence: number           // auto-incrementing per run
  type: AgentEventType        // from core
  payload: AgentEvent         // the full event
  timestamp: Date
}
```

**Schema rules:**
- `runId`: String, required
- `sequence`: Number, required
- `type`: String, required
- `payload`: Mixed (the full discriminated union)
- `timestamp`: Date, default `Date.now`
- Compound index: `{ runId: 1, sequence: 1 }`

**Static methods:**
- `EventModel.forRun(runId: string)` → all events for a run, sorted by sequence
- `EventModel.insertBatch(runId: string, events: AgentEvent[], startSeq: number)` → bulk insert

### TaskModel

```ts
export interface PersistedTask {
  id: string                  // from VisualTask.id
  prompt: string
  target_mechanism: string
  criteria: Criterion[]
  timesUsed: number
  createdAt: Date
}
```

**Schema rules:**
- `id`: String, unique index
- `target_mechanism`: String, index
- `timesUsed`: Number, default 0
- `createdAt`: Date, default `Date.now`

**Static methods:**
- `TaskModel.byMechanism(mechanism: string)` → filter by target_mechanism

## Connection singleton

```ts
// connect.ts
import mongoose from 'mongoose'

declare global {
  var __bbbMongoose: Promise<typeof mongoose> | undefined
}

export function connectDB(): Promise<typeof mongoose> {
  if (globalThis.__bbbMongoose) return globalThis.__bbbMongoose
  const uri = process.env.MONGODB_ATLAS_URI
  if (!uri) throw new Error('MONGODB_ATLAS_URI is not set')
  globalThis.__bbbMongoose = mongoose.connect(uri, {
    dbName: process.env.MONGODB_DB_NAME || 'brickbybrick',
  })
  return globalThis.__bbbMongoose
}

export async function disconnectDB(): Promise<void> {
  if (globalThis.__bbbMongoose) {
    const m = await globalThis.__bbbMongoose
    await m.disconnect()
    delete globalThis.__bbbMongoose
  }
}
```

## package.json

```json
{
  "name": "@brickbybrick/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "build": "tsc",
    "type-check": "tsc --noEmit",
    "test": "vitest run",
    "lint": "echo ok"
  },
  "dependencies": {
    "@brickbybrick/core": "workspace:*",
    "mongoose": "^8.10.0"
  },
  "devDependencies": {
    "mongodb-memory-server": "^10.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

## tsconfig.json

Extend the root `tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

## index.ts — public exports

```ts
export { connectDB, disconnectDB } from './connect'
export * from './models/index'
export * from './types'
```

## Tests

### connect.test.ts
- Verify `connectDB()` returns the same promise on multiple calls (singleton)
- Verify `connectDB()` throws when `MONGODB_ATLAS_URI` is not set
- Verify `disconnectDB()` clears the global

### run.test.ts
- Connect to in-memory MongoDB (`MongoMemoryServer`)
- Create a run, read it back, verify fields
- Update status to 'complete', verify
- `RunModel.latest()` returns correctly sorted runs

### pair.test.ts
- Create pairs, query by runId
- Query by mechanism
- Query by u_score range

## Key rules

1. **Do NOT import from `@brickbybrick/inference` or `@brickbybrick/trainer`.** Only `@brickbybrick/core` for types.
2. **Do NOT edit `packages/core/`.** Your DB types are additive.
3. **All Mongoose schemas use `{ _id: false }` for nested objects** (Criterion, Defect, etc.) unless they need their own ID.
4. **Tests must pass without Atlas.** Use `mongodb-memory-server`.
5. **Run `pnpm install` from repo root** after creating `package.json` to link the workspace dep.

## Verification

```bash
pnpm install
pnpm turbo run build --filter=@brickbybrick/db
pnpm turbo run type-check --filter=@brickbybrick/db
pnpm turbo run test --filter=@brickbybrick/db
```
