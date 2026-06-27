# Architecture

This document is the source of truth for the **real** external API shapes and the internal data flow. The original PRD's code snippets used wrong endpoints (e.g. `api.google.dev/.../sessions`, `from prime_intellect import ComputeCluster`) that **do not exist** — use the shapes below instead.

## 1. Stack & credential map

Everything that "thinks" runs on a single `GEMINI_API_KEY`:

| Role | Model / service | Auth |
|---|---|---|
| Orchestrator + in-sandbox visual auditor | Antigravity Managed Agent (`antigravity-preview-05-2026`) | `GEMINI_API_KEY` |
| Strong solver (the fix) | Gemini 3.5 Pro | `GEMINI_API_KEY` |
| Weak / target solver | Gemma 4 9B | `GEMINI_API_KEY` |
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

```bash
prime login                            # or PRIME_API_KEY env
prime availability list --gpu-type H100_80GB
prime pods create --name bbb-lora
prime train init                       # generates a training TOML
prime train <config>.toml              # launch LoRA job → run-id
prime train logs <run-id> -f           # stream logs
prime train metrics <run-id>           # → loss points (parse for the curve)
prime train checkpoints <run-id>       # fetch trained adapter
prime pods terminate <pod-id>          # teardown (kill idle spend)
```
LoRA is a built-in trainer arg (`use_lora`, `lora_rank`, `lora_alpha`, `lora_dropout`, `lora_target_modules`). Base model `google/gemma-4-9b-it`, r=16, α=32, target `q/v/k/o_proj`, epochs=3.

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

```bash
GEMINI_API_KEY=
ANTIGRAVITY_AGENT=antigravity-preview-05-2026
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
PRIME_API_KEY=
NEXT_PUBLIC_TRAINING_BUCKET_URI=
```
