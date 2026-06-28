# Demo Runbook

The live demo has two real external legs:

- Gemini + Antigravity generate, audit, repair, and commit a training pair.
- Prime Intellect provisions an H100 compute pod and runs exact Gemma QLoRA on the committed pair.

Prime Hosted Training is not used for the exact-Gemma demo because `prime train models`
does not currently list Gemma. The app uses Prime compute pods over SSH instead.

## 1. Preflight

Required `.env.local` keys:

```bash
GEMINI_API_KEY=
ANTIGRAVITY_AGENT=antigravity-preview-05-2026
STRONG_MODEL=gemini-3.1-pro-preview
WEAK_MODEL=gemma-4-26b-a4b-it
GEMINI_EMBED_MODEL=gemini-embedding-001

LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=

PRIME_API_KEY=
PRIME_GPU_ID=                 # optional: pin a known-good H100 availability id
PRIME_SSH_KEY_PATH=           # optional: defaults to ~/.ssh/id_rsa

HF_TOKEN=                     # Hugging Face access to google/gemma-4-26B-A4B-it
BBB_GEMMA_MODEL=google/gemma-4-26B-A4B-it
BBB_TRAINING_MAX_STEPS=20
```

Run:

```bash
pnpm install
pnpm demo:preflight
pnpm turbo run build type-check lint test
pnpm --filter web exec playwright install chromium
pnpm --filter web run e2e
```

`pnpm demo:preflight` verifies Gemini, LiveKit token minting, Prime auth, visible H100
capacity, the Prime SSH key, and Hugging Face model access.

## 2. Paid Rehearsal

Before recording, run the smallest paid exact-Gemma training job:

```powershell
$env:BBB_ALLOW_PAID_REHEARSAL="1"
$env:BBB_TRAINING_MAX_STEPS="5"
pnpm demo:rehearsal
```

Expected output:

- JSON `status` lines for `provisioning`, `streaming_dataset`, `training`, `saving`, `complete`.
- JSON `metric` lines with `step`, `loss`, and `epoch`.
- A final adapter path such as `/workspace/bbb-rehearsal-.../adapter`.

If this OOMs on 1x H100, set `PRIME_GPU_ID` to a 2x H100 availability id from preflight
and rerun.

## 3. Recording Flow

Run with `BBB_DEMO_MODE` unset.

1. Open the dashboard.
2. Set target pairs to `1`.
3. Start the visual loop.
4. Narrate the live events:
   - `challenge_generated`
   - `weak_code_drafted`
   - streamed `audit_step` screenshots
   - `defect_found`
   - `strong_fix_generated`
   - `audit_pass`
   - `pair_committed`
5. Stay on Section C while the app provisions the Prime H100 pod and runs exact Gemma QLoRA.
6. Show the streamed loss curve and final adapter narration.

Reality check: one pair can take 15-25 minutes before training starts. The H100 pod may
then spend several minutes booting and installing Python dependencies before the first
loss metric appears.

## 4. Failure Modes

| Symptom | Likely cause | Action |
|---|---|---|
| `pair_rejected: too_easy` | Weak model passed the challenge | Let the loop retry, or use a known-hard focus mechanism. |
| Audit takes many minutes | Normal Antigravity browser work | Keep narrating architecture; this is live, not cached. |
| `HF_TOKEN is required` or 401 | Missing token or model license not accepted | Add `HF_TOKEN`, accept Gemma terms, rerun preflight. |
| No loss curve | Pod boot, SSH wait, or dependency install still running | Keep Section A/B visible until metrics arrive. |
| Prime pod hangs | SSH key or provider issue | Check `prime pods status <pod> --output json`; terminate stale pods. |
| OOM | 1x H100 insufficient for selected settings | Use 2x H100 via `PRIME_GPU_ID` or reduce `BBB_TRAINING_MAX_STEPS`/sequence length. |
| LiveKit silent | Token/project issue | Continue; visual SSE stream is the core demo. |

## 5. Cleanup

The app terminates the Prime pod after training unless `BBB_KEEP_POD=1` is set.
Always verify:

```bash
prime pods list --output json
```

Terminate anything left running:

```bash
prime pods terminate <pod-id> --yes --plain
```

If using the DO GPU training provider (`BBB_TRAINING_PROVIDER=do-gpu`), the app
deletes the droplet in the stream's `finally` block. Verify nothing lingers:

```bash
doctl compute droplet list --format ID,Name,Status
doctl compute droplet delete <id> --force   # if any remain
```

## 6. Deploying to DigitalOcean App Platform

The dashboard ships as a containerized Next.js app (`output: 'standalone'`).

1. **Build locally to verify the image** (optional but recommended):
   ```bash
   docker build -t bbb-web .
   docker run -p 8080:8080 --env-file .env.local bbb-web
   # → dashboard at http://localhost:8080
   ```
2. **Create / update the app** from `app.yaml` (edit the `github.repo` field first):
   ```bash
   doctl apps create --spec app.yaml          # first time
   doctl apps update <app-id> --spec app.yaml # subsequent
   ```
3. **Set secrets** in the DO console (or `doctl apps update` with values): all keys
   marked `type: SECRET` in `app.yaml` — `GEMINI_API_KEY`, `LIVEKIT_*`, `PRIME_API_KEY`,
   `DIGITALOCEAN_MODEL_ACCESS_KEY`, `DO_API_TOKEN`, `MONGODB_ATLAS_URI`,
   `NEXT_PUBLIC_TRAINING_BUCKET_URI`.
4. **CD**: `deploy_on_push: true` rebuilds on every push to `main`.
5. **Verify health**: open the app URL, run a loop in demo mode, then
   `GET /api/runs` — persisted runs should return.

### Verify DO serverless fallback

Force a Gemini failure (e.g. invalid `GEMINI_API_KEY`) with a valid
`DIGITALOCEAN_MODEL_ACCESS_KEY` set; the loop should emit a narration event noting
the fallback and continue against DO serverless models.
