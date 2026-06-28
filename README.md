# BrickByBrick

> An autonomous visual-agentic data factory that finds a small model's UI-coding blind spots, turns them into a training set, and LoRA-fine-tunes the model on real GPUs — live.

## The Problem

Small language models (SLMs) are cheap and fast, but they fail in ways that are invisible to text-based evals. A model can emit React/CSS that **compiles and returns `200 OK`** yet is broken for a human: a layout collision, an off-screen render, a frozen event loop. Static prompt engineering and brute-force web-scraped datasets don't target these specific, *visual* failure modes — so the small model never improves where it actually hurts.

## The Solution

BrickByBrick is a closed-loop **Recursive Self-Improvement (RSI)** platform. It spends *inference-time compute* to map a target model's exact visual blind spots, programmatically curates a synthetic dataset centred entirely on those failures, and converts it into **permanent weight optimization** via LoRA fine-tuning on decentralized GPU spot nodes. The thesis: a localized 9B model can match frontier performance in a targeted domain at a fraction of the cost.

It extends Meta FAIR's **Autodata** framework (text/compiler verification) into the **visual** domain, using a hosted agent that actually *drives a browser* to verify UI correctness.

## How It Works

```
Built-in UI task bank
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  ANTIGRAVITY HOSTED SANDBOX  (Gemini, ephemeral Linux)       │
│   1. Challenger          → synthesizes a UI assembly task    │
│   2. Weak Solver (Gemma 4)→ writes draft React/CSS           │
│   3. Visual Auditor       → serves :3000, opens a browser,   │
│      (Flash Computer Use)   resizes to mobile, injects fringe │
│                             data, stress-clicks → screenshots │
│   4. Strong Solver (Gemini│ 3.5 Pro) → produces the fix       │
│      → re-audit: fix must PASS, weak must FAIL                │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
              Structured JSONL training pairs
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  PRIME INTELLECT SPOT NODE                                   │
│   Freeze base Gemma 4 ──► train custom LoRA adapter          │
└─────────────────────────────────────────────────────────────┘
```

A pair is committed to the dataset **only if** the strong model passes the visual audit and the weak model fails it (the *discriminative gap*), and only if it's not a near-duplicate of a recent failure. Every N pairs, a Recipe Synthesizer mutates the generation config to chase whichever UI mechanism the weak model keeps failing.

The dashboard tells the story live: a WebRTC **audio** track narrates the agent's thoughts, a **screenshot stream** shows the browser being driven in real time, an **adversarial matrix** shows pairs filtering in/out by their gap score, and a **compute console** streams the real LoRA training loss curve.

## Architecture

Everything runs on **one `GEMINI_API_KEY`** (orchestrator + both solvers + computer-use), plus **LiveKit** (audio) and **Prime Intellect** (training).

| Layer | Tech |
|---|---|
| Monorepo | pnpm 10 + Turborepo |
| Frontend | Next.js 15 (App Router, React 19), Tailwind v4, shadcn/ui (base-nova) |
| Live media | LiveKit (audio + `AgentAudioVisualizer`) + SSE screenshot stream |
| Orchestrator | Google **Antigravity Managed Agents** — `POST /v1beta/interactions` |
| Visual audit | **Gemini 3.5 Flash Computer Use** (driven inside the sandbox) |
| Strong solver | **Gemini 3.5 Pro** |
| Weak/target | **Gemma 4 9B** |
| Narration | **Gemini Live** → LiveKit audio |
| Training | **Prime Intellect** `prime` CLI (LoRA on GPU spot nodes) |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the real API request/response shapes and the full event contract.

## The Math

- **Discriminative reward gap** — a pair is kept iff `𝒰(T) = S(M_strong) − S(M_weak) ≥ τ`, `τ ∈ [0.4, 1.0]`, where `S` scores criteria passing under the visual audit.
- **LoRA forward pass** — base weights `W₀` frozen; `h = W₀x + (α/r)·BAx`, `r ≪ min(d,k)` → ~70% less memory, no catastrophic forgetting.
- **Diversity filter** — reject a new failure if `cos(E_new, E_j) > 0.82` against any recent failure embedding.

Full derivations in [`docs/MATH.md`](docs/MATH.md).

## Repo Layout

```
apps/web/            Next.js dashboard (3-section control center)
packages/core/       Zod schemas + shared contracts (the frozen interface)
packages/inference/  Gemini clients (strong/weak) + Antigravity wrapper + loop + prompts
                     + DigitalOcean serverless fallback provider
packages/trainer/    Prime Intellect CLI wrapper + dataset export + DO GPU droplet provider
packages/db/         MongoDB Atlas persistence (Mongoose models: runs, pairs, events, tasks)
docs/                Architecture, math, build plan, per-feature briefs, handoff
```

## Getting Started

```bash
pnpm install
cp .env.example .env.local   # fill in GEMINI_API_KEY, LIVEKIT_*, PRIME_API_KEY
pnpm turbo run build type-check
pnpm dev
```

## Deployment

Deployed on **DigitalOcean App Platform** (containerized Next.js, `output: 'standalone'`)
with **MongoDB Atlas** for run/pair/event persistence. CD from GitHub via `app.yaml`;
see [`docs/RUNBOOK.md`](docs/RUNBOOK.md) §6. Inference falls back to DigitalOcean
serverless models on Gemini 429/5xx, and training can target DO GPU droplets via
`BBB_TRAINING_PROVIDER=do-gpu`.

> **Status:** ~80% built. Core contracts frozen; engine loop, Antigravity/Gemini clients, trainer (Prime + DO GPU), MongoDB persistence, 3-section dashboard, and narration bridge all implemented and unit-tested. Seed dataset committed (~60 pairs). Remaining: loop hardening, closed-loop UI, live rehearsal. See [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) and [`docs/DECISIONS.md`](docs/DECISIONS.md).
