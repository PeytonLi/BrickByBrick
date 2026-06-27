# trainer fixtures

`metrics.sample.txt` — representative output of `prime train metrics <run-id>`
(NDJSON: `{step, loss, lr, epoch}` per line). The trainer agent's `streamMetrics`
parser is written and tested against this sample.

`demo-dataset.jsonl` — hand-built set of 5 representative `TrainingPair` entries
(JSONL). Serves as a pre-built artifact the integration agent can point training at.
Generated offline; will be replaced by real engine-loop output once the spike runs.
