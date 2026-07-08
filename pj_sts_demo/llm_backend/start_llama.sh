#!/usr/bin/env bash
set -euo pipefail

LLAMA_BIN="${LLAMA_BIN:-$HOME/llama.cpp/build/bin/llama-server}"
PID_FILE="${PID_FILE:-/tmp/llama-server.pid}"
LOG_FILE="${LOG_FILE:-$HOME/data/llama-server.log}"
MODEL_INI="${MODEL_INI:-$HOME/models.ini}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"
DROP_CACHES="${DROP_CACHES:-0}"
ACTION="${1:-status}"

check_dependencies() {
  local missing=0

  if [ ! -x "$LLAMA_BIN" ]; then
    echo "Missing executable llama-server: $LLAMA_BIN" >&2
    missing=1
  fi
  if [ ! -f "$MODEL_INI" ]; then
    echo "Missing model preset file: $MODEL_INI" >&2
    missing=1
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "Missing dependency: curl" >&2
    missing=1
  fi

  return "$missing"
}

start() {
  check_dependencies

  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "llama-server already running with pid $(cat "$PID_FILE")"
    exit 0
  fi

  mkdir -p "$(dirname "$LOG_FILE")"
  echo "Starting llama-server on ${HOST}:${PORT}"

  if [ "$DROP_CACHES" = "1" ] && command -v sudo >/dev/null 2>&1; then
    echo "Dropping OS page cache before start"
    sudo sysctl -w vm.drop_caches=3 >/dev/null 2>&1 || true
  fi

  nohup "$LLAMA_BIN" \
    --models-preset "$MODEL_INI" \
    --host "$HOST" \
    --port "$PORT" \
    >> "$LOG_FILE" 2>&1 &

  echo "$!" > "$PID_FILE"
  echo "Started llama-server with pid $(cat "$PID_FILE")"
  echo "Logs: $LOG_FILE"

  echo -n "Waiting for /health"
  for _ in $(seq 1 60); do
    sleep 3
    if curl -fsS "http://localhost:${PORT}/health" >/dev/null 2>&1; then
      echo
      echo "Ready: http://${HOST}:${PORT}"
      return 0
    fi
    echo -n "."
  done

  echo
  echo "Timed out waiting for readiness. Check: tail -f $LOG_FILE" >&2
  return 1
}

stop() {
  if [ ! -f "$PID_FILE" ]; then
    echo "llama-server is not running: missing $PID_FILE"
    return 0
  fi

  local pid
  pid="$(cat "$PID_FILE")"
  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "llama-server is not running: removed stale pid file"
    return 0
  fi

  echo "Stopping llama-server pid $pid"
  kill "$pid"
  for _ in $(seq 1 15); do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "Stopped"
      return 0
    fi
    sleep 1
  done

  kill -KILL "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "Killed after timeout"
}

status() {
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    local pid
    pid="$(cat "$PID_FILE")"
    echo "Running pid $pid"
    ps -p "$pid" -o pid,rss,vsz,pcpu,pmem,etime,command
    if curl -fsS "http://localhost:${PORT}/health" >/dev/null 2>&1; then
      echo "API OK: http://localhost:${PORT}/health"
    else
      echo "API not ready: http://localhost:${PORT}/health"
    fi
  else
    rm -f "$PID_FILE"
    echo "Not running"
  fi
}

logs() {
  tail -f "$LOG_FILE"
}

case "$ACTION" in
  start)
    start
    ;;
  stop)
    stop
    ;;
  restart)
    stop
    sleep 2
    start
    ;;
  status)
    status
    ;;
  logs)
    logs
    ;;
  check)
    check_dependencies
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs|check}" >&2
    exit 2
    ;;
esac
