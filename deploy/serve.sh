#!/usr/bin/env bash
# Serve the built web app and API, restarting automatically if the process exits.
# Usage: HOST=0.0.0.0 PORT=8000 PYTHON=/path/to/python deploy/serve.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"
PYTHON="${PYTHON:-python}"
LOG_DIR="$ROOT/data/logs"
mkdir -p "$LOG_DIR"

if [ ! -f "$ROOT/frontend/dist/index.html" ]; then
  echo "frontend/dist is missing; run 'make build' first" >&2
  exit 1
fi

cd "$ROOT/backend"
while true; do
  echo "[$(date '+%F %T')] starting on $HOST:$PORT" | tee -a "$LOG_DIR/server.log"
  "$PYTHON" -m uvicorn app.main:app --host "$HOST" --port "$PORT" --proxy-headers --timeout-graceful-shutdown 5 \
    >> "$LOG_DIR/server.log" 2>&1
  echo "[$(date '+%F %T')] exited with $?, restarting in 3s" | tee -a "$LOG_DIR/server.log"
  sleep 3
done
