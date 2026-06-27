# Feature Brief — B · Infra Agent

**Worktree:** `feat/infra` off the setup commit. **Owns:** `packages/trainer`.
**Method:** TDD — RED → GREEN → REFACTOR.
**Imports only** from frozen `@brickbybrick/core`. Never edits `packages/core`.

## Prereqs
Read [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §4 and the setup fixture `packages/trainer/__fixtures__/metrics.sample.txt`.

## Deliverables

### `packages/trainer/src/prime.ts`
`child_process` wrappers over the `prime` CLI (real commands in ARCHITECTURE §4):
- `provisionPod(opts): { podId }` — `prime pods create`
- `launchTraining(configPath, datasetPath): { runId }` — `prime train <cfg>.toml`
- `streamMetrics(runId, onPoint): void` — parse `prime train metrics`/`logs -f` → `LossPoint[]` (build the parser against the fixture)
- `getCheckpoint(runId): path` — `prime train checkpoints`
- `terminatePod(podId): void` — `prime pods terminate` (call on completion to kill idle spend)

### `packages/trainer/src/dataset.ts`
- `exportDataset(pairs: TrainingPair[]): string` — emit JSONL (one trajectory packet per line: task → weak code → defect snapshot ref → strong fix).

### `packages/trainer/src/config.ts`
- `buildTrainingConfig(opts): TOML` — base `google/gemma-4-9b-it`, `lora_rank=16`, `lora_alpha=32`, `lora_target_modules=[q,v,k,o]_proj`, `epochs=3`, `batch_size=4`, `lr=2e-4`.

### Demo dataset
- Commit a **real pre-built JSONL** (the "2,000") as a fixture/artifact the integration agent points training at. Generate it by running the engine loop offline if available, else a representative hand-built set.

## TDD focus (mock `child_process`)
- `exportDataset` JSONL shape (valid JSON per line, schema-conformant).
- `streamMetrics` parsing → correct `LossPoint{step,loss,epoch}` from the fixture.
- `buildTrainingConfig` emits valid TOML with the LoRA params.
- `terminatePod` invoked on completion path.

## Done when
All trainer unit tests green; `pnpm --filter @brickbybrick/trainer test build type-check` green; demo JSONL committed.
