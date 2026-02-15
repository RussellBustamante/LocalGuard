#!/usr/bin/env bash
set -euo pipefail

JETSON_SSH="antwon@192.168.50.4"
SPARK_SSH="asus@192.168.50.2"
ORANGEPI_SSH="ubuntu@192.168.50.3"
SSH_OPTS="-o ConnectTimeout=5 -o StrictHostKeyChecking=no"
DIR="$(cd "$(dirname "$0")" && pwd)"

deploy_jetson() {
  echo ">> Deploying jetson/stream.py → Jetson"
  scp $SSH_OPTS "$DIR/jetson/stream.py" "$JETSON_SSH:~/yolo/stream.py"
  echo "   Restarting stream.py..."
  ssh $SSH_OPTS "$JETSON_SSH" "pkill -f 'python3 stream.py' 2>/dev/null || true"
  sleep 1
  ssh $SSH_OPTS "$JETSON_SSH" "cd ~/yolo && source .venv/bin/activate && nohup python3 stream.py > /tmp/stream.log 2>&1 &"
  echo "   Done."
}

deploy_spark() {
  echo ">> Deploying spark/spark_server.py → Spark"
  scp $SSH_OPTS "$DIR/spark/spark_server.py" "$SPARK_SSH:~/cam-inference/spark_server.py"
  echo "   Restarting spark_server.py..."
  ssh $SSH_OPTS "$SPARK_SSH" "pkill -f 'python3 spark_server.py' 2>/dev/null || true"
  sleep 1
  ssh $SSH_OPTS "$SPARK_SSH" "cd ~/cam-inference && source .venv/bin/activate && nohup python3 spark_server.py > /tmp/spark_server.log 2>&1 &"
  echo "   Done."
}

deploy_orangepi() {
  echo ">> Deploying orangepi/voice_server.py → Orange Pi"
  scp $SSH_OPTS "$DIR/orangepi/voice_server.py" "$ORANGEPI_SSH:~/voice-assistant/voice_server.py"
  echo "   Restarting voice_server.py..."
  ssh $SSH_OPTS "$ORANGEPI_SSH" "pkill -f 'python3 voice_server.py' 2>/dev/null || true"
  sleep 1
  ssh $SSH_OPTS "$ORANGEPI_SSH" "cd ~/voice-assistant && source ~/voice-assistant-venv/bin/activate && nohup python3 voice_server.py > /tmp/voice_server.log 2>&1 &"
  echo "   Done."
}

case "${1:-all}" in
  jetson)   deploy_jetson ;;
  spark)    deploy_spark ;;
  orangepi) deploy_orangepi ;;
  all)      deploy_jetson; deploy_spark; deploy_orangepi ;;
  *)        echo "Usage: $0 [jetson|spark|orangepi|all]"; exit 1 ;;
esac
