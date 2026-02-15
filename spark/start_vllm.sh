#!/usr/bin/env bash
set -euo pipefail

# Multi-model vLLM launcher for DGX Spark (128 GB unified memory).
# Launches three vLLM containers sequentially with 30s delays to avoid
# memory profiling race conditions.
#
# Usage:
#   ./start_vllm.sh              # launch all three models
#   ./start_vllm.sh all          # same
#   ./start_vllm.sh cosmos-2b    # restart only Cosmos-Reason2-2B
#   ./start_vllm.sh cosmos-8b    # restart only Cosmos-Reason2-8B
#   ./start_vllm.sh nemotron     # restart only Nemotron

HF_CACHE_DIR="${HF_CACHE_DIR:-/home/asus/.cache/huggingface}"
VLLM_CACHE_DIR="${VLLM_CACHE_DIR:-/home/asus/.cache/vllm}"
IMAGE="${IMAGE:-nvcr.io/nvidia/vllm:26.01-py3}"
HF_TOKEN="${HF_TOKEN:-$(cat "$HF_CACHE_DIR/token" 2>/dev/null || echo "")}"

mkdir -p "$HF_CACHE_DIR" "$VLLM_CACHE_DIR"

launch_model() {
  local name="$1"
  local model="$2"
  local port="$3"
  local gpu_util="$4"
  local max_model_len="$5"
  shift 5
  local extra_args=("$@")

  echo ">> Stopping old container: $name"
  docker rm -f "$name" >/dev/null 2>&1 || true

  echo ">> Launching $name ($model) on port $port (gpu_util=$gpu_util)"
  docker run --gpus all -d \
    --name "$name" \
    --restart unless-stopped \
    -p "$port:8000" \
    --shm-size=16g \
    -e "HF_TOKEN=$HF_TOKEN" \
    -v "$HF_CACHE_DIR:/root/.cache/huggingface" \
    -v "$VLLM_CACHE_DIR:/root/.cache/vllm" \
    "$IMAGE" \
    python3 -m vllm.entrypoints.openai.api_server \
      --model "$model" \
      --trust-remote-code \
      --port 8000 \
      --gpu-memory-utilization "$gpu_util" \
      --max-model-len "$max_model_len" \
      "${extra_args[@]}"

  echo "   Started $name."
}

launch_cosmos_2b() {
  launch_model "vllm-cosmos-2b" \
    "nvidia/Cosmos-Reason2-2B" \
    8001 \
    0.20 \
    4096 \
    --served-model-name cosmos-fast \
    --reasoning-parser qwen3 \
    --max-num-seqs 2
}

launch_cosmos_8b() {
  launch_model "vllm-cosmos-8b" \
    "nvidia/Cosmos-Reason2-8B" \
    8002 \
    0.40 \
    8192 \
    --served-model-name cosmos-deep \
    --reasoning-parser qwen3 \
    --max-num-seqs 1
}

launch_nemotron() {
  launch_model "vllm-nemotron" \
    "nvidia/Nemotron-3-Nano-30B-A3B-FP8" \
    8003 \
    0.30 \
    8192 \
    --served-model-name nemotron \
    --enable-auto-tool-choice \
    --tool-call-parser qwen3_coder \
    --kv-cache-dtype fp8 \
    --max-num-seqs 4
}

wait_for_health() {
  local ports=("$@")
  local timeout=300  # 5 minutes
  local start=$SECONDS

  echo ""
  echo ">> Waiting for all models to become healthy (timeout ${timeout}s)..."

  for port in "${ports[@]}"; do
    while true; do
      if curl -sf "http://localhost:${port}/health" >/dev/null 2>&1; then
        echo "   Port $port: healthy"
        break
      fi

      if (( SECONDS - start >= timeout )); then
        echo "   TIMEOUT waiting for port $port"
        exit 1
      fi

      sleep 5
    done
  done

  echo ">> All models healthy."
}

# Remove old single-container setup if present
docker rm -f "vllm-cosmos" >/dev/null 2>&1 || true

TARGET="${1:-all}"

case "$TARGET" in
  cosmos-2b)
    launch_cosmos_2b
    wait_for_health 8001
    ;;
  cosmos-8b)
    launch_cosmos_8b
    wait_for_health 8002
    ;;
  nemotron)
    launch_nemotron
    wait_for_health 8003
    ;;
  all)
    launch_cosmos_2b
    echo "   Waiting 30s before next model..."
    sleep 30

    launch_cosmos_8b
    echo "   Waiting 30s before next model..."
    sleep 30

    launch_nemotron

    wait_for_health 8001 8002 8003
    ;;
  *)
    echo "Usage: $0 [cosmos-2b|cosmos-8b|nemotron|all]"
    exit 1
    ;;
esac
