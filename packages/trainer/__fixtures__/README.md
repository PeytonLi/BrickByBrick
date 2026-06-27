# trainer fixtures

`metrics.sample.txt` is captured by `scripts/spike/prime.sh <run-id>` — real output
of `prime train metrics`. The trainer agent's `streamMetrics` parser is written and
tested against this sample so the `LossPoint` parsing matches reality.
