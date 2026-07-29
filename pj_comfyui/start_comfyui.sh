#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${SCRIPT_DIR}/cf_venv"
COMFYUI_DIR="${SCRIPT_DIR}/ComfyUI"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8008}"
PID_FILE="${SCRIPT_DIR}/comfyui.pid"
LOG_FILE="${SCRIPT_DIR}/comfyui.log"
export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-0}"

if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
	echo "Missing Python interpreter in ${VENV_DIR}. Run install_comfyui.sh first." >&2
	exit 1
fi

if [[ ! -f "${COMFYUI_DIR}/main.py" ]]; then
	echo "Missing ComfyUI entry point: ${COMFYUI_DIR}/main.py" >&2
	exit 1
fi

is_running() {
	[[ -f "${PID_FILE}" ]] || return 1
	local pid
	pid="$(<"${PID_FILE}")"
	[[ "${pid}" =~ ^[0-9]+$ ]] && kill -0 "${pid}" 2>/dev/null
}

start_comfyui() {
	if is_running; then
		echo "ComfyUI is already running (PID $(<"${PID_FILE}"))."
		return 0
	fi

	rm -f "${PID_FILE}"
	echo "Starting ComfyUI on ${HOST}:${PORT} ..."
	(
		cd "${COMFYUI_DIR}"
		nohup "${VENV_DIR}/bin/python" main.py \
			--listen "${HOST}" \
			--port "${PORT}" \
			--enable-manager \
			--disable-auto-launch \
			>"${LOG_FILE}" 2>&1 &
		echo $! >"${PID_FILE}"
	)

	local attempt
	for attempt in {1..60}; do
		if ! is_running; then
			echo "ComfyUI exited during startup. Recent log output:" >&2
			tail -n 40 "${LOG_FILE}" >&2 || true
			return 1
		fi
		if (echo >/dev/tcp/127.0.0.1/"${PORT}") >/dev/null 2>&1; then
			echo "ComfyUI is ready (PID $(<"${PID_FILE}")). Logs: ${LOG_FILE}"
			return 0
		fi
		sleep 1
	done

	echo "ComfyUI is still starting (PID $(<"${PID_FILE}")). Check ${LOG_FILE}."
}

stop_comfyui() {
	if ! is_running; then
		rm -f "${PID_FILE}"
		echo "ComfyUI is not running."
		return 0
	fi

	local pid attempt
	pid="$(<"${PID_FILE}")"
	echo "Stopping ComfyUI (PID ${pid}) ..."
	kill "${pid}" 2>/dev/null || true
	for attempt in {1..20}; do
		if ! kill -0 "${pid}" 2>/dev/null; then
			rm -f "${PID_FILE}"
			echo "Stopped."
			return 0
		fi
		sleep 0.5
	done

	kill -KILL "${pid}" 2>/dev/null || true
	rm -f "${PID_FILE}"
	echo "Stopped."
}

status_comfyui() {
	if is_running; then
		echo "ComfyUI is running (PID $(<"${PID_FILE}")) on ${HOST}:${PORT}."
	else
		echo "ComfyUI is not running."
		return 1
	fi
}

case "${1:-start}" in
	start) start_comfyui ;;
	stop) stop_comfyui ;;
	restart)
		stop_comfyui
		start_comfyui
		;;
	status) status_comfyui ;;
	*)
		echo "Usage: $0 {start|stop|restart|status}" >&2
		exit 1
		;;
esac
