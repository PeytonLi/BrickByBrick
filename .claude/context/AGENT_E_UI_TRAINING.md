# Feature Agent E — UI: Training Page + Shared Components

## Context

You are Feature Agent E. Monorepo scaffold exists. Working in git worktree on branch `feat/ui-training`. Read `.claude/context/ARCHITECTURE.md` for full context.

**Your scope**:
- `apps/web/app/training/page.tsx`
- `apps/web/app/api/training/stream/route.ts`
- `apps/web/components/loss-graph.tsx`
- `apps/web/components/status-blueprint.tsx`
- `apps/web/components/download-center.tsx`
- `apps/web/components/ui/` — add any missing shadcn components needed

**Do not modify**: `lib/store.ts` (owned by Agent C).

## Design System

Dark mode. This page is the payoff — training is running, loss is dropping, the model is being born. Graphs, status indicators, progress bars. Make it feel like mission control.

## app/training/page.tsx

Full-page layout:

```
┌─────────────────────────────────────────────────────────────────┐
│  TRAINING STATUS HEADER                                          │
│  [PROVISIONING → TRAINING → COMPLETE]  Node: RTX 4090 × 1      │
├─────────────────────────────────────────┬───────────────────────┤
│                                         │                       │
│  LOSS GRAPH                             │  STATUS BLUEPRINT     │
│  (full training + val loss curves)      │  (timeline of events) │
│                                         │                       │
├─────────────────────────────────────────┴───────────────────────┤
│  MODEL WEIGHTS DOWNLOAD CENTER                                   │
│  (illuminates when training complete)                            │
└─────────────────────────────────────────────────────────────────┘
```

The page:
1. Reads `trainingPairs` from Zustand (to know how many pairs were generated)
2. Shows a "Start Training" button if `trainingStatus === 'idle'`
3. On start, POSTs to `/api/training/stream` with the dataset config
4. Reads SSE stream and dispatches events to Zustand
5. The loss graph and status blueprint react to Zustand store changes
6. Download center illuminates when `trainingStatus === 'complete'`

Show a dataset summary before starting:
- Total pairs collected: N
- Filter gate pass rate: X%
- Estimated dataset size: Y tokens
- Target model: nvidia/Nemotron-3-Nano-Omni
- LoRA rank: 16

## components/loss-graph.tsx

```tsx
'use client'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useStore } from '@/lib/store'

export function LossGraph() {
  const lossHistory = useStore(s => s.lossHistory)
  
  return (
    <div className="...">
      <h3 className="text-sm font-mono text-muted mb-4">TRAINING LOSS</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={lossHistory}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
          <XAxis dataKey="step" stroke="#6b7280" tick={{ fontSize: 10 }} />
          <YAxis stroke="#6b7280" tick={{ fontSize: 10 }} domain={[0, 1]} />
          <Tooltip
            contentStyle={{ background: '#111', border: '1px solid #1f1f1f', borderRadius: 4 }}
          />
          <Legend />
          <Line type="monotone" dataKey="train" stroke="#3b82f6" dot={false} strokeWidth={2} name="Train Loss" />
          <Line type="monotone" dataKey="val" stroke="#22c55e" dot={false} strokeWidth={2} name="Val Loss" />
        </LineChart>
      </ResponsiveContainer>
      {lossHistory.length > 0 && (
        <div className="mt-2 flex gap-4 text-xs font-mono text-muted">
          <span>Current Train: {lossHistory[lossHistory.length - 1]?.train.toFixed(4)}</span>
          <span>Current Val: {lossHistory[lossHistory.length - 1]?.val.toFixed(4)}</span>
          <span>Steps: {lossHistory[lossHistory.length - 1]?.step}</span>
        </div>
      )}
    </div>
  )
}
```

## components/status-blueprint.tsx

A vertical timeline of provisioning events:

```tsx
'use client'
// Shows a timeline of TrainingEvent messages
// Each event is a row: [timestamp] [icon] [message]
// Icons: ⬡ for provisioning, ↻ for training, ✓ for complete, ✗ for error
// Animate in each new event with a fade
// Shows the current step/totalSteps as a progress bar when training
```

Example timeline items:
- `[10:42:01] ⬡ Allocating RTX 4090 spot node on Prime Intellect...`
- `[10:42:08] ⬡ Node a4d3f2 ready. Distributing dataset (247 pairs)...`
- `[10:42:15] ↻ Training started. Epoch 1/3`
- `[10:43:22] ↻ Step 50/300 — loss converging`

## components/download-center.tsx

```tsx
'use client'
// Hidden/dimmed when trainingStatus !== 'complete'
// When complete: illuminates with a success animation (green glow)
// Shows:
//   - "Training Complete" header with checkmark
//   - Model name: "brickbybrick-lora-v1"
//   - Base model: "Qwen/Qwen2.5-7B-Instruct"
//   - LoRA rank: 16
//   - Final val loss (from last lossHistory entry)
//   - A prominent "Download Weights" button linking to downloadUrl
//   - A copyable config token (just format the downloadUrl as a styled copy button)
```

## app/api/training/stream/route.ts

```ts
import { startTraining } from '@brickbybrick/trainer'
import { exportDataset } from '@brickbybrick/trainer'
import type { TrainingPair } from '@brickbybrick/core'

export const runtime = 'nodejs'
export const maxDuration = 600  // 10 minutes for real training

export async function POST(request: Request) {
  const { pairs }: { pairs: TrainingPair[] } = await request.json()
  
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }
      
      // Export dataset to temp file
      const datasetPath = exportDataset(pairs, '/tmp/brickbybrick-dataset.jsonl')
      
      const config = {
        modelName: 'Qwen/Qwen2.5-7B-Instruct',
        datasetPath,
        loraRank: 16,
        epochs: 3,
        batchSize: 4,
        learningRate: 2e-4,
        outputDir: '/tmp/brickbybrick-output',
      }
      
      for await (const event of startTraining(config)) {
        emit(event)
        if (event.type === 'complete' || event.type === 'error') break
      }
      
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

## Additional shadcn Components

Install any missing shadcn components you need:
```bash
pnpm dlx shadcn@latest add progress separator badge
```

## Navigation Component

Create `apps/web/components/nav.tsx` — a minimal top navigation used across all pages:

```tsx
// Links: BrickByBrick (home) | Ingest | Synthesis | Training
// Current page highlighted
// Clean monospace font
// Used in layout or page-level
```

Add it to `apps/web/app/layout.tsx` if it's a global nav.

## Build Check

`cd apps/web && pnpm type-check` — exit 0.

## Commit

`git add -A && git commit -m "feat(ui): training page, loss graph, Prime Intellect status"`
