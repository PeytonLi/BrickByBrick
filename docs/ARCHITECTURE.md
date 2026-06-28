# Architecture

This document is the source of truth for the **real** external API shapes and the internal data flow. The original PRD's code snippets used wrong endpoints (e.g. `api.google.dev/.../sessions`, `from prime_intellect import ComputeCluster`) that **do not exist** — use the shapes below instead.

## 1. Stack & credential map

Everything that "thinks" runs on a single `GEMINI_API_KEY`:

| Role | Model / service | Auth |
|---|---|---|
| Orchestrator + in-sandbox visual auditor | Antigravity Managed Agent (`antigravity-preview-05-2026`) | `GEMINI_API_KEY` |
| Strong solver (the fix) | Gemini 3.1 Pro | `GEMINI_API_KEY` |
| Weak / target solver | Gemma 4 26B | `GEMINI_API_KEY` |
| Browser control | Gemini 3.5 Flash Computer Use (June 24 2026: native to Flash) | `GEMINI_API_KEY` |
| Spoken narration | Gemini Live → LiveKit audio | `GEMINI_API_KEY` + LiveKit |
| Live audio transport | LiveKit Cloud | `LIVEKIT_URL/API_KEY/API_SECRET` |
| LoRA training | Prime Intellect `prime` CLI | `PRIME_API_KEY` |

> Anthropic and Nebius keys are **not used** in the pivoted design. The unmerged `worktree-agent-ad6131657bf7e7c53` branch (Nebius+Claude, text-based) is reference-only; its schema/loop *structure* informs `packages/inference`, but its model clients are replaced by Gemini.

## 2. Antigravity Managed Agents (Interactions API)

**Start a session (provision a fresh sandbox):**
```http
POST https://generativelanguage.googleapis.com/v1beta/interactions
x-goog-api-key: $GEMINI_API_KEY
Content-Type: application/json

{
  "agent": "antigravity-preview-05-2026",
  "input": [{ "type": "text", "text": "<prompt>" }],
  "environment": { "type": "remote" },
  "stream": true
}
```

**Response:**
```json
{
  "id": "interaction_...",
  "environment_id": "environment_...",
  "output_text": "agent's final response",
  "steps": [ /* reasoning, tool calls, code execution, screenshots */ ]
}
```

**Continue (multi-turn, same sandbox):**
```json
{
  "agent": "antigravity-preview-05-2026",
  "previous_interaction_id": "<id from step 1>",
  "environment": "<environment_id from step 1>",
  "input": [{ "type": "text", "text": "<follow-up>" }]
}
```
The API tracks two independent dimensions: **conversation context** (`previous_interaction_id`) and **environment state** (`environment`). Persist both per session.

**Download sandbox files (the JSONL dataset, artifacts):**
```http
GET https://generativelanguage.googleapis.com/v1beta/files/environment-{ENV_ID}:download?alt=media
x-goog-api-key: $GEMINI_API_KEY      # → TAR archive
```

**Saved agent (optional, to mount AGENTS.md / SKILL.md):**
```http
POST https://generativelanguage.googleapis.com/v1beta/agents
{ "id": "...", "base_agent": "antigravity-preview-05-2026",
  "system_instruction": "...",
  "base_environment": { "type": "remote", "sources": [
    { "type": "inline", "target": "AGENTS.md", "content": "..." } ] } }
```

The sandbox can **write code, run a server, and browse the web** itself — so we instruct it to perform the entire visual audit and we just consume its `steps`. **We do not run Playwright ourselves.**

> ⚠️ The exact screenshot encoding inside `steps` must be captured by the **setup go/no-go spike** and committed as a fixture (`packages/inference/__fixtures__/`). The engine agent's screenshot extraction + tests build against that real sample.

## 3. Gemini 3.5 Flash Computer Use (for reference)

Native to Flash since 2026-06-24. Screenshot-in → structured UI action out on a **0–999 normalized coordinate grid**. Actions: `click`, `double_click`, `right_click`, `type` (+`press_enter`), `scroll` (direction + magnitude), `navigate`, `go_back`/`go_forward`, `press_key`, `hotkey`, `drag_and_drop`, `take_screenshot`. Some actions carry a `safety_decision` (`require_confirmation`). In our design the **Antigravity agent runs this loop internally**; this section documents what's happening under the hood.

## 4. Prime Intellect (CLI, via `child_process`)

Exact Gemma training runs on Prime compute pods, not Prime Hosted Training. Hosted Training currently exposes Prime-managed model/environment runs and does not list Gemma as a trainable model, so the trainer provisions an H100 pod and runs our own QLoRA script.

```bash
prime availability list --gpu-type H100_80GB --output json
prime pods create --id <h100-id> --name bbb-lora --yes --plain
prime pods status <pod-id> --output json      # wait for ACTIVE + ssh
scp dataset.jsonl train_gemma_lora.py <ssh>:/workspace/<run>/
ssh <ssh> 'HF_TOKEN=... python train_gemma_lora.py ...'
prime pods terminate <pod-id> --yes --plain
```

The remote script trains `google/gemma-4-26B-A4B-it` with 4-bit QLoRA, r=16, alpha=32, target `q/k/v/o_proj`, and streams JSON loss lines back to the UI.

## 5. The Visual Break-and-Fix Loop

```
runVisualLoop(config, emit):
  1. Challenger  → VisualTask                         emit challenge_generated
  2. Gemma 4     → draft React/CSS                     emit weak_code_drafted
  3. Antigravity → write code, serve :3000, open browser,
                   resize→mobile, inject fringe data, stress-click,
                   capture screenshots                 emit audit_step* (stream)
       └─ defect? ─ yes ─────────────────────────────  emit defect_found
                   no  → reject (too_easy)             emit pair_rejected
  4. Gemini Pro  → fix                                 emit strong_fix_generated
  5. Antigravity → re-audit the fix
       └─ pass? ─ no  → discard
                  yes →                                emit audit_pass
  6. 𝒰 = S(strong) − S(weak);  commit iff 𝒰 ≥ τ
     diversity gate: reject if cos-sim > 0.82          emit pair_committed | pair_rejected
  7. every N pairs: Recipe Synthesizer mutates config  emit recipe_mutated
```

## 6. Event contract (`AgentEvent`)

The SSE payload between the engine and the UI. Defined once in `@brickbybrick/core`, **frozen by the setup agent**, consumed by the web API routes. Variants:

`challenge_generated` · `weak_code_drafted` · `audit_step{screenshot,action,intent,viewport}` · `defect_found{screenshot,dom_trace,category,severity}` · `strong_fix_generated{code,diff}` · `audit_pass` · `pair_committed{pair,u_score}` · `pair_rejected{reason:'too_easy'|'redundant'}` · `recipe_mutated{patch}` · `narration{text}` · `training_event{loss?|status?|instance?|cost_microcents?}`

Engine entry signature (also in core): `runVisualLoop(config: GenerationConfig, emit: (e: AgentEvent) => void): Promise<void>`.

## 7. Dashboard (3 sections)

- **A — Live Media Room:** LiveKit audio room + `AgentAudioVisualizer` (Gemini Live narration) + screenshot-stream `<img>` fed by `audit_step`.
- **B — Adversarial Matrix:** challenger/weak/audit/strong cards, live 𝒰 gap meter, pair counter, amber "filtered-out" + green "committed" animations.
- **C — Weight Compute Console:** recharts loss curve from `training_event`, instance name, live micro-cent cost, status timeline.

## 8. Environment variables

See [`.env.example`](../.env.example) for the complete, commented inventory. Core keys:

```bash
GEMINI_API_KEY=
ANTIGRAVITY_AGENT=antigravity-preview-05-2026
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
PRIME_API_KEY=
NEXT_PUBLIC_TRAINING_BUCKET_URI=
MONGODB_ATLAS_URI=
DIGITALOCEAN_MODEL_ACCESS_KEY=
DO_API_TOKEN=
```

## 9. MongoDB Atlas persistence (`@brickbybrick/db`)

Every loop run is persisted to MongoDB Atlas via the `@brickbybrick/db` package
(Mongoose v8, connection singleton that survives Next.js hot reload):

- **Runs** — one document per loop invocation (config, status, timing, totals).
- **Pairs** — committed training pairs with their utility (𝒰) scores.
- **Events** — the full `AgentEvent` stream, batched (every 5 events) for replay.
- **Tasks** — the task bank with usage counters.

Wired into the SSE routes (`api/agent/visual-loop/stream`, `api/training/stream`)
as **fire-and-forget** writes — a DB failure degrades to an unpersisted stream
rather than breaking the loop. History is queryable via `GET /api/runs` and
`GET /api/runs/:id` (run + pairs + events). Tests use `mongodb-memory-server`,
so `pnpm test` needs no live Atlas.

## 10. DigitalOcean Serverless Inference (fallback)

When Gemini returns 429/5xx, the loop transparently falls back to DigitalOcean's
OpenAI-compatible serverless inference (`packages/inference/src/providers/`):
a `FallbackProvider` wraps each solver/embed method, emits a narration event on
switch, and retries against DO. Defaults: Claude 4.6 Sonnet (strong),
Llama 3.3 70B (weak), GTE Large (embeddings) — overridable via `DO_*_MODEL`.
The Gemini primary path is unchanged; DO only activates on error.

## 11. DigitalOcean GPU training (alternative to Prime Intellect)

`packages/trainer/src/providers/` adds a DO GPU Droplet provider alongside Prime.
`resolveTrainingProvider()` reads `BBB_TRAINING_PROVIDER` (`prime` default, or
`do-gpu`). The DO path uses `doctl` to provision an H100/A100/L40S droplet, `scp`
the dataset + TOML config, runs a LoRA fine-tune (`peft`/`transformers`) emitting
JSON-lines loss to a log, streams it back over SSH, then terminates the droplet.
Prime remains the default; both expose the same logical interface.

## §12. Persisting the trained adapter (Hugging Face Hub)

GPU pods/droplets are ephemeral — their disks are wiped on teardown — so the
trained LoRA **adapter** (the actual fine-tune output) must be pushed off-box or
it's lost. When `BBB_HF_HUB_REPO` (or the `hubRepo` training option) is set, the
remote training script pushes the saved adapter to that Hugging Face Hub repo
(private) right after `trainer.save_model`. The repo is validated up front with
`create_repo` **before** training starts, so a bad token or missing permission
fails in seconds rather than after an expensive run. On success the loop emits a
narration linking `https://huggingface.co/<repo>`. Leave `BBB_HF_HUB_REPO` blank
to skip the push (training still completes; the adapter just isn't persisted).
