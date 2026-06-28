#!/usr/bin/env bash
# Self-contained training script that runs entirely on the pod.
# Can be launched via: ssh root@host 'bash -s' < pod-train.sh
set -euo pipefail

REMOTE_DIR="${1:-/home/ubuntu/bbb-train}"
HF_TOKEN="${2:-}"
MODEL="${3:-google/gemma-4-26B-A4B-it}"
EPOCHS="${4:-3}"
HUB_REPO="${5:-}"
MAX_STEPS="${6:-}"

cd "$REMOTE_DIR"

# --- Install conda env if missing ---
if [ ! -x .py/bin/python ]; then
  rm -rf .miniconda .py
  wget -q -O /tmp/miniforge.sh https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-x86_64.sh \
    || curl -sSL -o /tmp/miniforge.sh https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-x86_64.sh
  bash /tmp/miniforge.sh -b -p "$REMOTE_DIR/.miniconda"
  "$REMOTE_DIR/.miniconda/bin/conda" create -y -p "$REMOTE_DIR/.py" python=3.10 pip
fi

export PIP_ROOT_USER_ACTION=ignore
"$REMOTE_DIR/.py/bin/python" -m pip install --upgrade pip
"$REMOTE_DIR/.py/bin/python" -m pip install --upgrade torch --index-url https://download.pytorch.org/whl/cu124
"$REMOTE_DIR/.py/bin/python" -m pip install --upgrade \
  "transformers>=4.49.0" "datasets>=3.0.0" "accelerate>=1.2.0" \
  "peft>=0.14.0" "trl>=0.25.0" "bitsandbytes>=0.45.0" \
  "pillow>=11.0.0" "huggingface_hub>=0.27.0"

# --- Build training args ---
PUSH_FLAG=""
if [ -n "$HUB_REPO" ]; then
  PUSH_FLAG="--push-to-hub $HUB_REPO"
fi

STEPS_FLAG=""
if [ -n "$MAX_STEPS" ]; then
  STEPS_FLAG="--max-steps $MAX_STEPS"
else
  STEPS_FLAG="--epochs $EPOCHS"
fi

# --- Launch training (detached, output to log) ---
export HF_TOKEN
nohup "$REMOTE_DIR/.py/bin/python" train_gemma_lora.py \
  --dataset dataset.jsonl \
  --output adapter \
  --model "$MODEL" \
  $STEPS_FLAG \
  $PUSH_FLAG \
  > "$REMOTE_DIR/training.log" 2>&1 &

TRAIN_PID=$!
echo "TRAIN_PID=$TRAIN_PID" > "$REMOTE_DIR/train.pid"
echo "Training launched with PID $TRAIN_PID"
echo "Monitor: tail -f $REMOTE_DIR/training.log"
echo "Progress: grep '\"type\":\"metric\"' $REMOTE_DIR/training.log | tail -1"
