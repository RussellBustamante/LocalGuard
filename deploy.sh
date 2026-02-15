#!/usr/bin/env bash
set -euo pipefail

JETSON_SSH="${JETSON_SSH:-antwon@192.168.50.4}"
SPARK_SSH="${SPARK_SSH:-asus@192.168.50.2}"
ORANGEPI_SSH="${ORANGEPI_SSH:-ubuntu@192.168.50.3}"
SSH_OPTS="-o ConnectTimeout=5 -o StrictHostKeyChecking=no"
DIR="$(cd "$(dirname "$0")" && pwd)"

JETSON_REMOTE_FILE="${JETSON_REMOTE_FILE:-~/yolo/stream.py}"
SPARK_REMOTE_FILE="${SPARK_REMOTE_FILE:-~/cam-inference/spark_server.py}"
ORANGEPI_REMOTE_FILE="${ORANGEPI_REMOTE_FILE:-~/voice-assistant/voice_server.py}"

JETSON_STOP_CMD="${JETSON_STOP_CMD:-pkill -f '[p]ython3 stream.py' 2>/dev/null || true}"
SPARK_STOP_CMD="${SPARK_STOP_CMD:-pkill -f '[p]ython3 spark_server.py' 2>/dev/null || true}"
ORANGEPI_STOP_CMD="${ORANGEPI_STOP_CMD:-pkill -f '[p]ython3 voice_server.py' 2>/dev/null || true}"

JETSON_START_CMD="${JETSON_START_CMD:-cd ~/yolo && source .venv/bin/activate && nohup python3 stream.py > /tmp/stream.log 2>&1 < /dev/null &}"
SPARK_START_CMD="${SPARK_START_CMD:-cd ~/cam-inference && source .venv/bin/activate && nohup python3 spark_server.py > /tmp/spark_server.log 2>&1 < /dev/null &}"
ORANGEPI_START_CMD="${ORANGEPI_START_CMD:-cd ~/voice-assistant && source ~/voice-assistant-venv/bin/activate && nohup python3 voice_server.py > /tmp/voice_server.log 2>&1 < /dev/null &}"

deploy_jetson() {
  echo ">> Deploying jetson/stream.py → Jetson"
  scp $SSH_OPTS "$DIR/jetson/stream.py" "$JETSON_SSH:$JETSON_REMOTE_FILE"
  echo "   Restarting stream.py..."
  ssh $SSH_OPTS "$JETSON_SSH" "$JETSON_STOP_CMD"
  sleep 1
  ssh $SSH_OPTS -f "$JETSON_SSH" "$JETSON_START_CMD"
  echo "   Done."
}

deploy_spark() {
  echo ">> Deploying spark/spark_server.py → Spark"
  scp $SSH_OPTS "$DIR/spark/spark_server.py" "$SPARK_SSH:$SPARK_REMOTE_FILE"
  scp $SSH_OPTS "$DIR/spark/start_vllm.sh" "$SPARK_SSH:~/cam-inference/start_vllm.sh"
  ssh $SSH_OPTS "$SPARK_SSH" "chmod +x ~/cam-inference/start_vllm.sh"
  echo "   Restarting spark_server.py (vLLM containers are NOT restarted)..."
  ssh $SSH_OPTS "$SPARK_SSH" "$SPARK_STOP_CMD"
  sleep 1
  ssh $SSH_OPTS -f "$SPARK_SSH" "$SPARK_START_CMD"
  echo "   Done."
}

deploy_orangepi() {
  echo ">> Deploying orangepi/voice_server.py → Orange Pi"
  scp $SSH_OPTS "$DIR/orangepi/voice_server.py" "$ORANGEPI_SSH:$ORANGEPI_REMOTE_FILE"
  echo "   Restarting voice_server.py..."
  ssh $SSH_OPTS "$ORANGEPI_SSH" "$ORANGEPI_STOP_CMD"
  sleep 1
  ssh $SSH_OPTS -f "$ORANGEPI_SSH" "$ORANGEPI_START_CMD"
  echo "   Done."
}

case "${1:-all}" in
  jetson)   deploy_jetson ;;
  spark)    deploy_spark ;;
  orangepi) deploy_orangepi ;;
  all)      deploy_jetson; deploy_spark; deploy_orangepi ;;
  *)        echo "Usage: $0 [jetson|spark|orangepi|all]"; exit 1 ;;
esac
