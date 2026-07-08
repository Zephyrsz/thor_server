#!/usr/bin/env bash
set -euo pipefail
BACKEND_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$(cd "$BACKEND_DIR/.." && pwd)}"
LOG_DIR="${LOG_DIR:-$BACKEND_DIR/logs}"
LOG_FILE="${LOG_FILE:-$LOG_DIR/service.log}"
PID_FILE="${PID_FILE:-$BACKEND_DIR/service.pid}"
ACTION="${1:-start}"
BACKEND_WS_HOST="${BACKEND_WS_HOST:-127.0.0.1}"
BACKEND_WS_PORT="${BACKEND_WS_PORT:-8766}"
PUBLIC_WSS_PORT="${PUBLIC_WSS_PORT:-8765}"
NGINX_WSS_CONF="${NGINX_WSS_CONF:-/etc/nginx/conf.d/pj_sts_realtime_wss.conf}"
TLS_CERT="${TLS_CERT:-/etc/nginx/ssl/pj_sts_demo/ui.crt}"
TLS_KEY="${TLS_KEY:-/etc/nginx/ssl/pj_sts_demo/ui.key}"

reload_nginx() {
  sudo nginx -t
  sudo systemctl reload nginx 2>/dev/null || sudo nginx -s reload
}

enable_wss_proxy() {
  sudo tee "$NGINX_WSS_CONF" >/dev/null <<EOF
server {
    listen 0.0.0.0:${PUBLIC_WSS_PORT} ssl;
    server_name _;

    ssl_certificate ${TLS_CERT};
    ssl_certificate_key ${TLS_KEY};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    client_max_body_size 20m;

    location /v1/realtime {
        proxy_pass http://${BACKEND_WS_HOST}:${BACKEND_WS_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
}
EOF
  reload_nginx
}

disable_wss_proxy() {
  if [ -f "$NGINX_WSS_CONF" ]; then
    sudo rm -f "$NGINX_WSS_CONF"
    reload_nginx
  fi
}

stop_backend() {
  if [ ! -f "$PID_FILE" ]; then
    echo "Realtime backend is not running: missing $PID_FILE"
    return 0
  fi

  old_pid="$(cat "$PID_FILE")"
  if [ -z "$old_pid" ] || ! kill -0 "$old_pid" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "Realtime backend is not running: removed stale pid file"
    return 0
  fi

  kill "$old_pid"
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if ! kill -0 "$old_pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "Realtime backend stopped"
      return 0
    fi
    sleep 1
  done

  kill -KILL "$old_pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "Realtime backend killed after timeout"
}

start_service() {
  if [ -f "$PID_FILE" ]; then
    old_pid="$(cat "$PID_FILE")"
    if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
      if ps -p "$old_pid" -o args= | grep -q -- "--ws_port $BACKEND_WS_PORT"; then
        enable_wss_proxy
        echo "Realtime WSS service already running with backend pid $old_pid"
        exit 0
      fi
      echo "Stopping backend pid $old_pid to switch WSS proxy to port $PUBLIC_WSS_PORT"
      stop_backend
    else
      rm -f "$PID_FILE"
    fi
  fi

  mkdir -p "$LOG_DIR"
  nohup "$PROJECT_DIR/.venv/bin/speech-to-speech" \
    --mode realtime \
    --ws_host "$BACKEND_WS_HOST" \
    --ws_port "$BACKEND_WS_PORT" \
    --stt parakeet-tdt \
    --llm_backend responses-api \
    --tts qwen3 \
    --qwen3_tts_backend torch \
    --model_name qwen35b \
    --responses_api_base_url http://localhost:8000/v1 \
    --responses_api_api_key not-needed \
    --responses_api_stream \
    > "$LOG_FILE" 2>&1 < /dev/null &

  echo "$!" > "$PID_FILE"
  enable_wss_proxy
  echo "Realtime WSS service started on 0.0.0.0:$PUBLIC_WSS_PORT with backend pid $(cat "$PID_FILE")"
}

stop_service() {
  disable_wss_proxy
  stop_backend
}

case "$ACTION" in
  start)
    start_service
    ;;
  stop)
    stop_service
    ;;
  restart)
    stop_service
    start_service
    ;;
  *)
    echo "Usage: $0 {start|stop|restart}" >&2
    exit 2
    ;;
esac
