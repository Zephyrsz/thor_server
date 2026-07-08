#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_FILE="${STATE_FILE:-$ROOT_DIR/ui.env}"
ACTION="${1:-start}"

load_state() {
  if [ -f "$STATE_FILE" ]; then
    # shellcheck disable=SC1090
    source "$STATE_FILE"
  fi
}

load_state

FRONTEND_DIR="${FRONTEND_DIR:-$ROOT_DIR}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8003}"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/logs}"
LOG_FILE="${LOG_FILE:-$LOG_DIR/ui.log}"
PID_FILE="${PID_FILE:-$ROOT_DIR/ui.pid}"
SCREEN_SESSION="${SCREEN_SESSION:-pj_sts_demo_ui}"
REALTIME_WS_URL="${REALTIME_WS_URL:-}"
BACKEND_WS_URL="${BACKEND_WS_URL:-}"
BACKEND_TLS_REJECT_UNAUTHORIZED="${BACKEND_TLS_REJECT_UNAUTHORIZED:-1}"
HTTPS_AUTO_CERTS="${HTTPS_AUTO_CERTS:-1}"
HTTPS_CERT_FILE="${HTTPS_CERT_FILE:-}"
HTTPS_KEY_FILE="${HTTPS_KEY_FILE:-}"

if [ "$HTTPS_AUTO_CERTS" != "0" ] && [ -z "$HTTPS_CERT_FILE" ] && [ -z "$HTTPS_KEY_FILE" ] && [ -f "$ROOT_DIR/certs/thor-ui.crt" ] && [ -f "$ROOT_DIR/certs/thor-ui.key" ]; then
  HTTPS_CERT_FILE="$ROOT_DIR/certs/thor-ui.crt"
  HTTPS_KEY_FILE="$ROOT_DIR/certs/thor-ui.key"
fi

ui_protocol() {
  if [ -n "$HTTPS_CERT_FILE" ] || [ -n "$HTTPS_KEY_FILE" ]; then
    echo "https"
  else
    echo "http"
  fi
}

usage() {
  cat <<EOF
Usage: $(basename "$0") {start|stop|restart|status}

Environment:
  HOST=0.0.0.0
  PORT=8003
  REALTIME_WS_URL=wss://your-server/v1/realtime       # normally loaded from ui.env
  BACKEND_WS_URL=wss://your-server/v1/realtime        # optional server-side proxy target
  BACKEND_TLS_REJECT_UNAUTHORIZED=0                   # allow self-signed backend certs
  HTTPS_AUTO_CERTS=0                                  # keep localhost UI on HTTP
  HTTPS_CERT_FILE=/path/to/fullchain.pem         # optional, enables HTTPS UI
  HTTPS_KEY_FILE=/path/to/privkey.pem            # optional, enables HTTPS UI
  FRONTEND_DIR=$FRONTEND_DIR
  LOG_FILE=$LOG_FILE
  PID_FILE=$PID_FILE
  STATE_FILE=$STATE_FILE
  SCREEN_SESSION=$SCREEN_SESSION
  SKIP_BUILD=1                                  # skip npm run build
EOF
}

write_state() {
  {
    printf "HOST=%q\n" "$HOST"
    printf "PORT=%q\n" "$PORT"
    printf "REALTIME_WS_URL=%q\n" "$REALTIME_WS_URL"
    printf "BACKEND_WS_URL=%q\n" "$BACKEND_WS_URL"
    printf "BACKEND_TLS_REJECT_UNAUTHORIZED=%q\n" "$BACKEND_TLS_REJECT_UNAUTHORIZED"
    printf "HTTPS_AUTO_CERTS=%q\n" "$HTTPS_AUTO_CERTS"
    printf "HTTPS_CERT_FILE=%q\n" "$HTTPS_CERT_FILE"
    printf "HTTPS_KEY_FILE=%q\n" "$HTTPS_KEY_FILE"
    printf "LOG_FILE=%q\n" "$LOG_FILE"
    printf "PID_FILE=%q\n" "$PID_FILE"
    printf "SCREEN_SESSION=%q\n" "$SCREEN_SESSION"
  } > "$STATE_FILE"
}

read_pid() {
  if [ -f "$PID_FILE" ]; then
    tr -d '[:space:]' < "$PID_FILE"
  fi
}

is_running() {
  local pid
  pid="$(read_pid || true)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

screen_pid() {
  if command -v screen >/dev/null 2>&1; then
    screen -ls 2>/dev/null | awk -v session=".$SCREEN_SESSION" '$1 ~ session { split($1, parts, "."); print parts[1]; exit }'
  fi
}

port_listener_pids() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
  fi
}

install_dependencies() {
  cd "$FRONTEND_DIR"
  if [ ! -d node_modules ]; then
    npm ci
  fi
}

build_frontend() {
  cd "$FRONTEND_DIR"
  if [ "${SKIP_BUILD:-0}" = "1" ] && [ -d .next ]; then
    return
  fi
  npm run build
}

start_ui() {
  if [ ! -d "$FRONTEND_DIR" ]; then
    echo "Frontend module not found: $FRONTEND_DIR" >&2
    exit 1
  fi
  if [ -z "$REALTIME_WS_URL" ]; then
    echo "REALTIME_WS_URL is not configured. Set it in $STATE_FILE." >&2
    exit 1
  fi

  if [ -n "$HTTPS_CERT_FILE" ] || [ -n "$HTTPS_KEY_FILE" ]; then
    if [ -z "$HTTPS_CERT_FILE" ] || [ -z "$HTTPS_KEY_FILE" ]; then
      echo "Set both HTTPS_CERT_FILE and HTTPS_KEY_FILE to serve the UI over HTTPS" >&2
      exit 1
    fi
    if [ ! -f "$HTTPS_CERT_FILE" ]; then
      echo "HTTPS certificate file not found: $HTTPS_CERT_FILE" >&2
      exit 1
    fi
    if [ ! -f "$HTTPS_KEY_FILE" ]; then
      echo "HTTPS key file not found: $HTTPS_KEY_FILE" >&2
      exit 1
    fi
  fi

  mkdir -p "$LOG_DIR"

  if is_running; then
    echo "UI already running on $(ui_protocol)://${HOST}:${PORT} with pid $(read_pid)"
    echo "Realtime websocket: $REALTIME_WS_URL"
    exit 0
  fi

  install_dependencies
  build_frontend

  cd "$FRONTEND_DIR"
  if [ ! -x "$FRONTEND_DIR/node_modules/.bin/next" ]; then
    echo "Next.js binary not found after dependency installation" >&2
    exit 1
  fi

  if command -v screen >/dev/null 2>&1; then
    screen -S "$SCREEN_SESSION" -X quit >/dev/null 2>&1 || true
    export FRONTEND_DIR HOST PORT REALTIME_WS_URL BACKEND_WS_URL BACKEND_TLS_REJECT_UNAUTHORIZED HTTPS_CERT_FILE HTTPS_KEY_FILE LOG_FILE
    screen -dmS "$SCREEN_SESSION" bash -lc 'cd "$FRONTEND_DIR" && exec env NODE_ENV=production HOST="$HOST" PORT="$PORT" REALTIME_WS_URL="$REALTIME_WS_URL" BACKEND_WS_URL="$BACKEND_WS_URL" BACKEND_TLS_REJECT_UNAUTHORIZED="$BACKEND_TLS_REJECT_UNAUTHORIZED" HTTPS_CERT_FILE="$HTTPS_CERT_FILE" HTTPS_KEY_FILE="$HTTPS_KEY_FILE" node "$FRONTEND_DIR/server.mjs" > "$LOG_FILE" 2>&1 < /dev/null'
    sleep 1
    screen_session_pid="$(screen_pid || true)"
    if [ -n "$screen_session_pid" ]; then
      echo "$screen_session_pid" > "$PID_FILE"
    fi
  else
    nohup env NODE_ENV=production HOST="$HOST" PORT="$PORT" \
      REALTIME_WS_URL="$REALTIME_WS_URL" \
      BACKEND_WS_URL="$BACKEND_WS_URL" \
      BACKEND_TLS_REJECT_UNAUTHORIZED="$BACKEND_TLS_REJECT_UNAUTHORIZED" \
      HTTPS_CERT_FILE="$HTTPS_CERT_FILE" HTTPS_KEY_FILE="$HTTPS_KEY_FILE" \
      node "$FRONTEND_DIR/server.mjs" > "$LOG_FILE" 2>&1 < /dev/null &
    echo "$!" > "$PID_FILE"
    sleep 1
  fi

  if is_running; then
    echo "UI started on $(ui_protocol)://${HOST}:${PORT} with pid $(read_pid)"
    echo "Realtime websocket: $REALTIME_WS_URL"
    echo "Logs: $LOG_FILE"
    write_state
    if [ "$(ui_protocol)" = "http" ] && [ "$HOST" != "localhost" ] && [ "$HOST" != "127.0.0.1" ]; then
      echo "Microphone access requires opening the UI via HTTPS or localhost."
    fi
  else
    echo "UI failed to start. Check $LOG_FILE" >&2
    rm -f "$PID_FILE"
    exit 1
  fi
}

stop_ui() {
  if command -v screen >/dev/null 2>&1; then
    screen -S "$SCREEN_SESSION" -X quit >/dev/null 2>&1 || true
  fi

  listener_pids="$(port_listener_pids)"

  if ! is_running && [ -z "$listener_pids" ]; then
    rm -f "$PID_FILE"
    echo "UI is not running"
    return
  fi

  local pid
  pid="$(read_pid)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
  fi
  if [ -n "$listener_pids" ]; then
    kill $listener_pids 2>/dev/null || true
  fi

  for _ in {1..30}; do
    listener_pids="$(port_listener_pids)"
    if { [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; } && [ -z "$listener_pids" ]; then
      rm -f "$PID_FILE"
      echo "UI stopped"
      return
    fi
    sleep 1
  done

  if [ -n "$pid" ]; then
    kill -9 "$pid" 2>/dev/null || true
  fi
  listener_pids="$(port_listener_pids)"
  if [ -n "$listener_pids" ]; then
    kill -9 $listener_pids 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  echo "UI stopped with SIGKILL after timeout"
}

status_ui() {
  if is_running; then
    echo "UI running on $(ui_protocol)://${HOST}:${PORT} with pid $(read_pid)"
    echo "Realtime websocket: $REALTIME_WS_URL"
    echo "Logs: $LOG_FILE"
    if [ "$(ui_protocol)" = "http" ] && [ "$HOST" != "localhost" ] && [ "$HOST" != "127.0.0.1" ]; then
      echo "Microphone access requires opening the UI via HTTPS or localhost."
    fi
  else
    echo "UI is not running"
  fi
}

case "$ACTION" in
  start)
    start_ui
    ;;
  stop)
    stop_ui
    ;;
  restart)
    stop_ui
    start_ui
    ;;
  status)
    status_ui
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
