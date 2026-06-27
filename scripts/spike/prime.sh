#!/usr/bin/env bash
# Spike (d): confirm the Prime Intellect CLI is installed + authed, and capture a
# metrics sample for the trainer's parser. Run: bash scripts/spike/prime.sh [run-id]
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if ! command -v prime >/dev/null 2>&1; then
  echo "✗ prime CLI not installed — see https://github.com/PrimeIntellect-ai/prime"
  exit 1
fi
echo "✓ prime CLI: $(command -v prime)"

if prime availability list >/dev/null 2>&1; then
  echo "✓ prime availability list ok (authed)"
else
  echo "✗ prime availability list failed — run 'prime login' or set PRIME_API_KEY"
  exit 1
fi

RUN_ID="${1:-}"
if [ -n "$RUN_ID" ]; then
  mkdir -p "$ROOT/packages/trainer/__fixtures__"
  prime train metrics "$RUN_ID" | tee "$ROOT/packages/trainer/__fixtures__/metrics.sample.txt"
  echo "  wrote packages/trainer/__fixtures__/metrics.sample.txt"
else
  echo "  (pass a run-id to capture a metrics sample: bash scripts/spike/prime.sh <run-id>)"
fi
