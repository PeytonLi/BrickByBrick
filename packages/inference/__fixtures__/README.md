# inference fixtures

Captured live by `scripts/spike/antigravity.mjs` against the real Antigravity
Interactions API (the "hard gate" spike, 2026-06-27). **Do not hand-edit** — these
are the ground-truth shapes `antigravity.ts` is built and tested against.

## Files

- **`interaction.stream.txt`** — the raw Server-Sent-Events stream. This is the real
  wire protocol (the documented flat `{id, environment_id, output_text, steps[]}`
  shape in early ARCHITECTURE.md was wrong). It is a typed event stream:

  ```
  event: interaction.created      data: {"interaction":{"id":…,"status":"in_progress"},"event_type":…}
  event: step.start               data: {"index":0,"step":{"type":"thought"},"event_type":…}
  event: step.delta               data: {"index":0,"delta":{"content":{"text":…},"type":"thought_summary"},…}
  event: step.stop                data: {"index":0,"usage":{…},"event_type":…}
  …                               (function_call / code_execution_call / code_execution_result …)
  event: interaction.completed    data: {"interaction":{…full consolidated object…},"event_type":…}
  ```

  The terminal `interaction.completed` (or `interaction.failed`) event carries the
  whole consolidated `interaction` object. `parseInteractionStream()` folds it.

- **`interaction.sample.json`** — that consolidated `interaction` object, extracted
  from the completed event: `{ id, environment_id, status, steps[] }`. 80 steps for
  the sample run. Step types seen: `thought`, `function_call`/`function_result`,
  `code_execution_call`/`code_execution_result`, and a final `model_output`.

## Key findings (drive the engine design)

1. **Screenshots are NOT in the response.** The agent ran its own Playwright via
   `code_execution` and saved PNGs to the sandbox filesystem; zero image bytes appear
   in the stream. The sandbox FS is NOT retrievable — the Interactions API exposes no
   environment/Files download endpoint (a finished interaction's only lifecycle call
   is `DELETE /v1beta/interactions/{id}`). So the audit prompt makes the agent print
   base64 JPEG thumbnails wrapped in `<<<AUDIT_STEP>>>…<<<END>>>` sentinels (parsed by
   `extractAuditSteps` / `parseAuditStepsFromText`); these stream to the UI live AND
   are the dataset's image source. The verdict rides the final `model_output` text as
   a `<<<VERDICT>>>…<<<END>>>` JSON block (parsed by `parseAuditReport`).
2. **Latency ≈ 7 min per audit** (the sample: 20:40:52 → 20:47:40). The loop runs two
   audits per pair, so plan for ~14 min/pair → small live targets (1–2 pairs).

The sample run used a generic prompt (no sentinel contract), so it contains no
`<<<AUDIT_STEP>>>`/`<<<VERDICT>>>` markers — `extractAuditSteps` returns `[]` for it,
which the tests assert as proof the real `steps` carry no inline screenshots.
