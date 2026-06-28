# Feature Brief - B Infra Agent

`packages/trainer` owns the real Prime Intellect integration.

## Current Reality

Prime Hosted Training (`prime train`) is useful for Prime-managed environments, but it
does not currently list Gemma in `prime train models`. The exact-Gemma demo therefore
uses Prime compute pods:

1. Provision an H100 pod with `prime pods create`.
2. Wait for `prime pods status --output json` to expose SSH.
3. Copy committed-pair JSONL and `train_gemma_lora.py` to the pod.
4. Run 4-bit QLoRA against `google/gemma-4-26B-A4B-it`.
5. Parse JSON loss lines into `LossPoint`.
6. Terminate the pod unless `BBB_KEEP_POD=1`.

## Trainer Surface

- `runGemmaLoraTraining(opts, callbacks)` - full exact-Gemma pod training flow.
- `provisionPod(opts)` - noninteractive pod creation using `--plain`, `--yes`, and either `PRIME_GPU_ID` or `H100_80GB`.
- `getPodStatus(podId)` / `waitForPodSsh(podId)` - status polling.
- `parseSshTarget`, `copyToPod`, `runRemote` - SSH/SCP helpers.
- `streamMetrics(runId, onPoint)` - compatibility wrapper for Prime Hosted Training metrics JSON.
- `terminatePod(podId)` - noninteractive teardown.

## Test Focus

- Mock `child_process` and verify argument-array command construction.
- Parse Prime status and metrics JSON.
- Convert `TrainingPair[]` into chat JSONL for SFT.
- Ensure training failure and teardown failure paths are observable.

## Demo Checks

- `pnpm demo:preflight` must pass before any recording.
- `BBB_ALLOW_PAID_REHEARSAL=1 pnpm demo:rehearsal` must emit at least one metric line before relying on the live demo.
