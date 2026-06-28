# Go / No-Go Spike

Run these with real keys in `.env.local` **before** spawning the parallel feature
agents (engine / infra / ui). This is the main de-risking lever for the pure-live,
no-fallback demo. All five must pass.

```bash
node scripts/spike/gemini.mjs        # (b)(c) Gemini 3.1 Pro + Gemma 4 respond
node scripts/spike/antigravity.mjs   # (a)  Antigravity sandbox + screenshot steps  ← HARD GATE
node scripts/spike/livekit.mjs       # (e)  LiveKit token mint
bash  scripts/spike/prime.sh         # (d)  prime CLI authed (+ <run-id> to capture metrics)
```

Outputs two committed fixtures:
- `packages/inference/__fixtures__/interaction.sample.json`
- `packages/trainer/__fixtures__/metrics.sample.txt`

If `gemini.mjs` reports the weak model 404, set `WEAK_MODEL=gemini-3.5-flash` in
`.env.local` and record it in `docs/DECISIONS.md`.
