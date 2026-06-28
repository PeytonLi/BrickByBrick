# BrickByBrick

> **Find your model's blind spots. Collect them as training data. Fix them on real GPUs. Ship the improvement.**
>
> An autonomous visual-agentic pipeline that maps a small model's UI-coding failures, curates them into a training set, and LoRA-fine-tunes the model on H100 GPUs — all live, all autonomous.

---

## What It Does

Small models are cheap and fast but fail in ways invisible to text evals. A model can emit React that *compiles* yet overflows on mobile, traps focus in a modal, or freezes on empty state. BrickByBrick finds these failures, collects them, and trains the model to stop making them.

```
You say:  "a model good at React responsive design"
                |
                v
    Four AI agents collaborate in real time
    +-----------+    +------------+    +----------+    +-----------+
    | Challenger| -> | Weak Solver| -> | Auditor  | -> | Strong    |
    | invents   |    | drafts     |    | finds    |    | Solver    |
    | UI tasks  |    | buggy code |    | bugs in  |    | fixes     |
    |           |    |            |    | browser  |    | the code  |
    +-----------+    +------------+    +----------+    +-----------+
                                                             |
                                              pair committed (utility > 0.4)
                                                             |
                                                             v
                                              +-----------------------+
                                              |  H100 GPU QLoRA       |
                                              |  1,515 pairs x 3 epochs|
                                              |  adapter on HF Hub    |
                                              +-----------------------+
```

---

## 60-Second Demo

| Time | What |
|------|------|
| :00 | **[Training page](https://brickbybrick-xxxxx.ondigitalocean.app/training)** — Loss dropped 6.17 → 5.68. 1,515 pairs, 16 mechanisms, 25 min on H100, $0.98. |
| :10 | **[Live Demo](https://brickbybrick-xxxxx.ondigitalocean.app)** — Type intent → Derive plan → Start loop |
| :20 | Four agents collaborate: Challenger invents, Weak drafts, Auditor finds bugs with real browser screenshots, Strong fixes |
| :40 | **Two-way voice** — Click Connect Audio, speak to steer the AI through LiveKit |
| :50 | Training runs on H100 GPUs, adapter ships to Hugging Face Hub. Deployed on DigitalOcean App Platform. |

---

## Live Training Results

Fine-tuned **Gemma 4 26B** (4-bit QLoRA, r=16) on 1,515 mechanism-specific UI pairs.

| Metric | Value |
|--------|-------|
| Initial loss | 6.17 |
| Final loss | 5.68 |
| Best loss | 5.51 |
| Reduction | 7.9% |
| Epochs | 3 (570 steps) |
| GPU | H100 80GB @ $2.35/hr |
| Duration | ~25 min |
| Cost | $0.98 |
| Adapter | [peytonali/gemma-bbb-lora](https://huggingface.co/peytonali/gemma-bbb-lora) |

**16 mechanisms** in the training set: responsive-grid (110), modal-focus-trap (110), form-validation (90), dropdown-menu (80), toast-system, carousel, tabs, accordion, infinite-scroll, drag-drop, tooltip, search-autocomplete, data-table, stepper-wizard, pagination, skeleton-loader.

View the full loss chart and configuration at `/training`.

---

## Architecture

Everything runs on **one `GEMINI_API_KEY`** (orchestrator + both solvers + computer-use), plus **LiveKit** (audio narration) and **Prime Intellect** (GPU training).

| Layer | Tech |
|---|---|
| Monorepo | pnpm 10 + Turborepo |
| Frontend | Next.js 15 (App Router, React 19), Tailwind v4, shadcn/ui |
| Live media | LiveKit (two-way audio) + SSE screenshot stream |
| Orchestrator | Google **Antigravity Managed Agents** |
| Visual audit | Gemini Flash Computer Use (real Chromium sandbox) |
| Strong solver | Gemini 3.5 Pro |
| Weak/target | Gemma 4 26B |
| Narration | Gemini Live → LiveKit audio bridge |
| Training | Prime Intellect `prime` CLI (QLoRA on GPU spot nodes) |
| Persistence | MongoDB Atlas (runs, pairs, events) |
| Deployment | DigitalOcean App Platform (Dockerfile, `output: 'standalone'`) |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full event contract and API shapes.

---

## Repo Layout

```
apps/web/            Next.js dashboard (sidebar nav + 3 sections)
                      ├── Live Demo    — visual loop control center
                      ├── Training     — loss chart + config + mechanisms
                      └── Models       — HF model browser + eval
packages/core/       Zod schemas + shared contracts (frozen interface)
packages/inference/  Gemini clients + Antigravity wrapper + loop engine + prompts
packages/trainer/    Prime CLI wrapper + dataset export + QLoRA training script
packages/db/         MongoDB Atlas persistence (Mongoose: runs, pairs, events)
docs/                Architecture, math, build plan, decisions, handoff
scripts/demo/        Full training launcher, poll scripts, inference tester
```

---

## Getting Started

```bash
pnpm install
cp .env.example .env.local   # fill in GEMINI_API_KEY, LIVEKIT_*, PRIME_API_KEY, HF_TOKEN
pnpm turbo run build type-check
pnpm dev                      # opens http://localhost:3000
```

### Required env vars

| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY` | Powers all AI agents (Challenger, solvers, auditor, narration) |
| `LIVEKIT_URL` | WebRTC audio for narration + two-way voice |
| `LIVEKIT_API_KEY` | LiveKit authentication |
| `LIVEKIT_API_SECRET` | LiveKit token signing |
| `PRIME_API_KEY` | GPU pod provisioning |
| `HF_TOKEN` | Hugging Face model download + adapter push |
| `MONGODB_ATLAS_URI` | Run/pair persistence (optional — loop works without it) |

---

## Deployment

Deployed on **DigitalOcean App Platform** via `app.yaml`:

- Containerized Next.js (`output: 'standalone'`)
- Autodeploy from GitHub on push to `main`
- MongoDB Atlas for persistence
- LiveKit Cloud for audio
- Linux glibc Docker image — full two-way voice works in production

```bash
# From your machine (GPU training requires prime CLI):
BBB_ALLOW_PAID_REHEARSAL=1 pnpm tsx scripts/demo/full-train.ts
```

See [`docs/RUNBOOK.md`](docs/RUNBOOK.md) for operational details.

---

## Status

**~95% built** (2026-06-28). All core systems implemented and tested (192 tests green):

- ✅ Visual loop (Challenger → Weak → Audit → Strong)
- ✅ Antigravity sandbox with real browser screenshots
- ✅ Quality gate (utility threshold + diversity filter)
- ✅ 1,515-pair seed dataset (16 mechanisms)
- ✅ QLoRA training on H100 (detached mode, epochs, cosine LR)
- ✅ HF Hub push (peytonali/gemma-bbb-lora)
- ✅ LiveKit two-way audio (server bridge + mic → Gemini)
- ✅ MongoDB persistence (runs, pairs, events)
- ✅ DigitalOcean deployment (Dockerfile + app.yaml)
- ✅ Training results dashboard (loss chart + mechanism breakdown)
- ✅ Sidebar navigation (Live Demo / Training / Models)

Remaining: before/after model eval with vLLM serving.

See [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) and [`docs/DECISIONS.md`](docs/DECISIONS.md).
