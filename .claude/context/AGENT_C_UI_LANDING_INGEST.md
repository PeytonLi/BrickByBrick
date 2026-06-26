# Feature Agent C — UI: Landing Page + Ingest Page

## Context

You are Feature Agent C. The monorepo scaffold exists. You are in a git worktree on branch `feat/ui-landing-ingest`. Read `.claude/context/ARCHITECTURE.md` for full system context.

**Your scope**:
- `apps/web/app/page.tsx` (Route `/`)
- `apps/web/app/ingest/page.tsx` (Route `/ingest`)
- `apps/web/components/dropzone.tsx`
- `apps/web/components/rag-profiler.tsx`
- `apps/web/components/target-config.tsx`
- `apps/web/lib/store.ts`
- `apps/web/app/api/ingest/route.ts`

## Design System

Dark mode. Background `#0a0a0a`, surface `#111111`, borders `#1f1f1f`. High-contrast white type. Monospace for all code/data output. This is a technical hackathon demo — minimal, precise, dramatic.

shadcn/ui components are in `apps/web/components/ui/`. The setup agent initialized shadcn. Use Button, Card, Badge, Progress, ScrollArea, Tabs from shadcn. Import via `@/components/ui/...`.

The `cn` utility is at `@/lib/cn`.

## lib/store.ts

Implement the complete Zustand store. This is the single source of truth for the entire app:

```ts
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { TrainingPair, GenerationConfig, AgentEvent } from '@brickbybrick/core'

interface IngestState {
  uploadedFiles: { name: string; size: number; status: 'uploading' | 'processing' | 'done' | 'error' }[]
  vectorizedChunks: string[]
  chunkCount: number
  ragStreamLines: string[]        // streaming output from RAG profiler
  generationConfig: GenerationConfig
}

interface SynthesisState {
  isRunning: boolean
  agentEvents: AgentEvent[]
  trainingPairs: TrainingPair[]
  currentConfig: GenerationConfig
  pairsCompleted: number
  totalTarget: number
}

interface TrainingState {
  trainingStatus: 'idle' | 'provisioning' | 'training' | 'complete' | 'error'
  lossHistory: { step: number; train: number; val: number }[]
  downloadUrl: string | null
  currentStep: number
  totalSteps: number
}

interface Actions {
  addFile: (file: { name: string; size: number }) => void
  updateFileStatus: (name: string, status: IngestState['uploadedFiles'][0]['status']) => void
  setChunks: (chunks: string[]) => void
  appendRagLine: (line: string) => void
  setGenerationConfig: (config: Partial<GenerationConfig>) => void
  setRunning: (running: boolean) => void
  appendAgentEvent: (event: AgentEvent) => void
  addTrainingPair: (pair: TrainingPair) => void
  updateCurrentConfig: (config: GenerationConfig) => void
  setTrainingStatus: (status: TrainingState['trainingStatus']) => void
  appendLossPoint: (point: { step: number; train: number; val: number }) => void
  setDownloadUrl: (url: string) => void
}

export const useStore = create<IngestState & SynthesisState & TrainingState & Actions>()(
  persist(
    (set) => ({
      // Initial state
      uploadedFiles: [],
      vectorizedChunks: [],
      chunkCount: 0,
      ragStreamLines: [],
      generationConfig: {
        target_count: 20,
        domain_hint: 'linear algebra and matrix operations',
        error_rates: {},
        schema_version: 1,
        volumetric_multipliers: {},
        structural_additions: [],
      },
      isRunning: false,
      agentEvents: [],
      trainingPairs: [],
      currentConfig: {
        target_count: 20,
        domain_hint: 'linear algebra and matrix operations',
        error_rates: {},
        schema_version: 1,
        volumetric_multipliers: {},
        structural_additions: [],
      },
      pairsCompleted: 0,
      totalTarget: 20,
      trainingStatus: 'idle',
      lossHistory: [],
      downloadUrl: null,
      currentStep: 0,
      totalSteps: 0,
      // Actions
      addFile: (file) => set(s => ({ uploadedFiles: [...s.uploadedFiles, { ...file, status: 'uploading' }] })),
      updateFileStatus: (name, status) => set(s => ({
        uploadedFiles: s.uploadedFiles.map(f => f.name === name ? { ...f, status } : f)
      })),
      setChunks: (chunks) => set({ vectorizedChunks: chunks, chunkCount: chunks.length }),
      appendRagLine: (line) => set(s => ({ ragStreamLines: [...s.ragStreamLines.slice(-100), line] })),
      setGenerationConfig: (config) => set(s => ({ generationConfig: { ...s.generationConfig, ...config } })),
      setRunning: (running) => set({ isRunning: running }),
      appendAgentEvent: (event) => set(s => ({ agentEvents: [...s.agentEvents.slice(-200), event] })),
      addTrainingPair: (pair) => set(s => ({
        trainingPairs: [...s.trainingPairs, pair],
        pairsCompleted: s.pairsCompleted + 1,
      })),
      updateCurrentConfig: (config) => set({ currentConfig: config }),
      setTrainingStatus: (status) => set({ trainingStatus: status }),
      appendLossPoint: (point) => set(s => ({ lossHistory: [...s.lossHistory, point] })),
      setDownloadUrl: (url) => set({ downloadUrl: url }),
    }),
    {
      name: 'brickbybrick-store',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({
        generationConfig: s.generationConfig,
        vectorizedChunks: s.vectorizedChunks,
        chunkCount: s.chunkCount,
        trainingPairs: s.trainingPairs,
      }),
    }
  )
)
```

## app/page.tsx — The Thesis Hub

This is a narrative landing page for hackathon judges. Build it beautifully.

Layout:
1. **Header**: Full-width dark nav with `BrickByBrick` logo (text) and a "System Status" badge showing `LIVE`
2. **Hero Section**: 
   - Tagline: "Precision Data. Not Massive Models."
   - Subtext explaining the core thesis (2-3 sentences from PRD)
   - Two live metric counters (animate via `useEffect`): "Synthetic Tokens Generated" (count up from 0 to 2,847,291) and "Active Filter Gates" (count up to 4)
3. **The Math Exhibit** (key section):
   - Render the filter gate equation using Unicode math or a styled `<pre>` block
   - Explain: Strong Solver succeeds, Weak Solver fails → high-value training objective
   - Show a sample training pair card (hardcoded demo data — a math question about matrix eigenvalues)
4. **Architecture Diagram**: ASCII art of the 4-agent topology from the PRD, styled in a monospace `<pre>` block with color-coded agent names
5. **CTA**: Button `→ Deploy BrickByBrick Agent Worker` linking to `/ingest`

Use `next/link` for navigation. Animate the page sections with CSS transitions on mount (simple `opacity` + `translateY`).

## app/ingest/page.tsx — Knowledge Grounding Interface

Layout (three columns on desktop, stacked on mobile):

**Left column: File Dropzone** (component: `components/dropzone.tsx`)
- Drag-and-drop using `react-dropzone`
- Accept: `.pdf`, `.md`, `.txt`, `.json`
- Show file list below the dropzone with status badges
- On drop, POST to `/api/ingest` with FormData

**Center column: RAG Profiler Panel** (component: `components/rag-profiler.tsx`)
- Stream output from the ingest API
- Show raw chunk text as it's parsed, scrolling terminal style
- Show a progress bar: "Vectorized N / total chunks"
- Use `ScrollArea` from shadcn, auto-scroll to bottom

**Right column: Target Configuration** (component: `components/target-config.tsx`)
- Form fields:
  - Domain hint (text input, default: "linear algebra")
  - Target pair count (number input, default: 20 for demo)
  - Base model (dropdown: "nvidia/Nemotron-3-Nano-Omni")
- On submit, save to Zustand store and route to `/synthesis`
- Show a green "Ready to Synthesize" state once files are uploaded

## components/dropzone.tsx

```tsx
'use client'
import { useDropzone } from 'react-dropzone'
import { useStore } from '@/lib/store'
// ...
```

Build a proper dropzone with:
- Visual drag state (border changes to blue when dragging over)
- File type icons
- Upload progress per file
- Error state for unsupported file types

## components/rag-profiler.tsx

Terminal-style streaming display. Auto-scrolls. Shows each chunk as it arrives with its index and first 80 chars. Use `font-mono text-xs text-green-400`.

## components/target-config.tsx

Clean form with shadcn Card, Input, Select, Button. Validates before submitting. Shows Zustand state values.

## app/api/ingest/route.ts

```ts
export async function POST(request: Request) {
  const formData = await request.formData()
  const file = formData.get('file') as File
  // Parse file, call agentbox ingestDocument, stream chunks back via SSE
  // Use ReadableStream with text/event-stream
}
```

Call `@brickbybrick/agentbox` ingest functions. Return SSE stream of `{ chunk: string, index: number }` events.

## Build Check

`cd apps/web && pnpm type-check` — must exit 0.

## Commit

`git add -A && git commit -m "feat(ui): landing page, ingest UI, Zustand store"`
