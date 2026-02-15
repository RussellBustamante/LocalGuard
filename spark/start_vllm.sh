#!/usr/bin/env bash
set -euo pipefail

# Persistent vLLM launcher for Spark.
# Keeps HF cache on host so model weights are not re-downloaded after container restarts.

CONTAINER_NAME="${CONTAINER_NAME:-vllm-cosmos}"
HF_CACHE_DIR="${HF_CACHE_DIR:-/home/asus/.cache/huggingface}"
VLLM_CACHE_DIR="${VLLM_CACHE_DIR:-/home/asus/.cache/vllm}"
IMAGE="${IMAGE:-nvcr.io/nvidia/vllm:26.01-py3}"
MODEL="${MODEL:-nvidia/Cosmos-Reason1-7B}"
GPU_UTIL="${GPU_UTIL:-0.7}"
MAX_MODEL_LEN="${MAX_MODEL_LEN:-16384}"
MAX_NUM_SEQS="${MAX_NUM_SEQS:-1}"

mkdir -p "$HF_CACHE_DIR" "$VLLM_CACHE_DIR"

docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

docker run --gpus all -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  -p 8000:8000 \
  --shm-size=16g \
  -v "$HF_CACHE_DIR:/root/.cache/huggingface" \
  -v "$VLLM_CACHE_DIR:/root/.cache/vllm" \
  "$IMAGE" \
  python3 -m vllm.entrypoints.openai.api_server \
    --model "$MODEL" \
    --trust-remote-code \
    --port 8000 \
    --gpu-memory-utilization "$GPU_UTIL" \
    --max-model-len "$MAX_MODEL_LEN" \
    --max-num-seqs "$MAX_NUM_SEQS"

echo "Started $CONTAINER_NAME with persistent caches."
