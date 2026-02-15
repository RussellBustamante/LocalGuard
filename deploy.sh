#!/usr/bin/env bash
set -euo pipefail

JETSON_SSH="antwon@192.168.50.4"
SPARK_SSH="asus@192.168.50.2"
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

case "${1:-all}" in
  jetson) deploy_jetson ;;
  spark)  deploy_spark ;;
  all)    deploy_jetson; deploy_spark ;;
  *)      echo "Usage: $0 [jetson|spark|all]"; exit 1 ;;
esac
