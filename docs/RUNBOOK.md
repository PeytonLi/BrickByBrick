# Demo Runbook

The pure-live, no-fallback demo (see [DECISIONS.md](DECISIONS.md) risks). This is the
operator's script for taking BrickByBrick on stage: pre-flight, pre-warm timing, the
on-stage sequence, and what to say when something stalls.

> **Reality check (measured, 2026-06-27).** One in-sandbox Antigravity audit takes
> **~7–21 min** depending on how much the agent explores: ~10 min on a defective UI
> (validated live: 9.7 min, 9 thumbnails + verdict), but up to ~21 min when the UI is
> clean and it probes exhaustively before passing. The loop runs **two audits per pair**
> (the weak draft must FAIL, the strong fix must PASS), so budget **~15–25 min per
> committed pair**. Generate **1–2 pairs live**; the "2,000-pair" scale comes from the
> pre-built JSONL, not live generation.
>
> **Challenger difficulty (tune before stage).** In rehearsal the weak model sometimes
> *passes* the challenger's task (→ `pair_rejected: too_easy`, no pair, ~20 min wasted).
> The gating is correct, but to reliably get a live pair the challenger prompt must bias
> toward mechanisms the weak model demonstrably fails (overflow / responsive collapse /
> focus traps). Pre-select a known-hard `focus_mechanism` in the on-stage config, or
> pre-warm a committed pair before going live.

---

## 1. Pre-flight (T-60 min)

### Keys — `.env.local` at the repo root (gitignored)
All "thinking" runs on one `GEMINI_API_KEY` (ARCHITECTURE §8). Required:

```bash
GEMINI_API_KEY=            # Gemini + Antigravity (same key)
ANTIGRAVITY_AGENT=antigravity-preview-05-2026
LIVEKIT_URL=               # wss://...
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
PRIME_API_KEY=
NEXT_PUBLIC_TRAINING_BUCKET_URI=
# Model reconciliation (plan ids 404 — see DECISIONS "Model ID reconciliation"):
STRONG_MODEL=gemini-3.1-pro-preview
WEAK_MODEL=gemma-4-26b-a4b-it
GEMINI_EMBED_MODEL=gemini-embedding-001
```

Smoke-test the keys before anything else:
```bash
node scripts/spike/gemini.mjs        # strong + weak models → 200
node scripts/spike/livekit.mjs       # token mints
bash scripts/spike/prime.sh          # prime CLI reachable
```

### Tooling
```bash
pnpm install
pnpm turbo run build type-check lint test     # must be fully green (13/13 tasks)
prime login                                    # PRIME_API_KEY in env
pnpm --filter web exec playwright install chromium
pnpm --filter web run e2e                       # dashboard happy path (demo-mode, ~45s)
```

### LiveKit
Confirm the LiveKit Cloud project is live and `LIVEKIT_URL` points at it. The browser is
shown via the **SSE screenshot stream**, not WebRTC video — LiveKit carries **audio
narration only**.

---

## 2. Pre-warm the training job (T-10 min)

The loss curve must be **mid-descent** when you cut to it on stage, so launch the real
Prime job before you go on — do **not** wait until the live loop finishes.

```bash
# 1. Provision the GPU pod (provisioning lead time ~3–5 min):
#    trainer: provisionPod()  ->  prime pods create --name bbb-demo --gpu-type H100_80GB
# 2. Kick training on the pre-built JSONL (this is the curve you'll show):
#    trainer: launchTraining(configPath, datasetPath)  ->  prime train <config> --dataset <jsonl>
# 3. Note the runId it prints — Section C tails it via:
#    trainer: streamMetrics(runId)  ->  prime train metrics <runId>
```

**Timing:** launch `prime train` **~8–10 min before** you cut to Section C. Provisioning
eats ~3–5 min, then loss starts at ~2.4 and descends; by minute ~8 it's visibly falling.
If you launch too early it bottoms out (boring flat line); too late and it's still
provisioning (dead air). Aim to hit the steep part of the curve on screen.

Keep the `runId` on a sticky note — you type it (or it's pre-filled) in Section C.

---

## 3. On-stage sequence (~6–8 min of stage time)

> Run with the **real** backend — make sure `BBB_DEMO_MODE` is **unset** (it is only for
> e2e/CI). The dev/prod server reads the real `runVisualLoop` + `streamMetrics`.

1. **Open the dashboard.** "This is a small model's UI-coding blind spot, found live."
2. **Start the loop** (Control center → *Run loop*, target = 1). Narrate as events stream:
   - *challenge_generated* — "The challenger just invented an adversarial UI task."
   - *weak_code_drafted* → *audit_step* thumbnails appear in Section A — "The weak model's
     draft is being driven in a real browser at 1280 / 768 / 375 px."
   - *defect_found* — "There's the gap: a real overflow at mobile width." (Show the defect
     screenshot + category/severity.)
   - *strong_fix_generated* — "The strong model repairs exactly that defect."
   - *audit_pass* → *pair_committed* — "Re-audited, it passes. That's a committed training
     pair with a real utility score 𝒰." Point at the **U gap** in Section B.
3. **Cut to Section C** (the pre-warmed job): "While that ran, we've been fine-tuning the
   weak model on GPUs — here's the live loss curve, mid-descent." Show the streaming loss.
4. **Close the loop:** "Find the blind spot, turn it into data, train it away — autonomously."

Because a pair takes ~15–20 min, **start the loop talking-track early** and let it run in
the background while you cover the architecture; come back to lock the pair in. The
pre-warmed loss curve covers any dead air.

---

## 4. Failure modes & what to say

Pure-live, no fallback net (DECISIONS #2). Have these ready:

| Symptom | Cause | What to do / say |
|---|---|---|
| Loop sits on "Auditing…" for minutes | Normal — an audit is ~7–10 min | "The agent is driving a real browser in a cloud sandbox — this is real, not a cached clip." Keep narrating architecture. |
| `pair_rejected: too_easy` | Weak model happened to pass | "The weak model got that one right — no learning signal, so we discard and the challenger raises the difficulty." It retries automatically. |
| Strong fix fails re-audit | Hard task | "Even the strong model didn't fully fix it — we discard rather than commit a bad pair. That filter is the point." |
| Antigravity 5xx / stream stalls | Upstream | The client retries with backoff. If it persists, stop and restart the loop; lean on the pre-warmed Section C. |
| Loss curve flat | Pre-warm launched too early | Re-launch `prime train`; talk through the dataset/JSONL while it warms. |
| Loss curve absent | Job still provisioning | "GPUs are spinning up" — switch to Section A/B until `streamMetrics` connects. |
| LiveKit silent | Token/project | Audio narration is a nice-to-have; the visual SSE stream is the substance — proceed without it. |

**Golden rule:** the ~7–10 min audit latency is a *feature* to narrate ("this is really
happening in a real browser"), not dead air to apologize for. The pre-warmed loss curve is
always there to cut to.

---

## 5. Post-demo

- Stop the loop (*Stop*), then tear down the Prime pod to stop GPU spend.
- Antigravity sandboxes self-expire; `destroyEnvironment(envId)` force-closes one early.
- Committed pairs + the dataset live in `NEXT_PUBLIC_TRAINING_BUCKET_URI`.
