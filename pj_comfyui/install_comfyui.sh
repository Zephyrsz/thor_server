#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${SCRIPT_DIR}/cf_venv"
COMFYUI_DIR="${SCRIPT_DIR}/ComfyUI"
TOOLS_DIR="${SCRIPT_DIR}/.tools"
UV_BIN="${TOOLS_DIR}/uv"
COMFYUI_REPO="https://github.com/Comfy-Org/ComfyUI.git"
PYTHON_VERSION="${PYTHON_VERSION:-3.13}"
PYTORCH_INDEX_URL="${PYTORCH_INDEX_URL:-https://download.pytorch.org/whl/cu130}"

if ! command -v git >/dev/null 2>&1; then
	echo "Error: git is required but not installed." >&2
	exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
	echo "Error: curl is required but not installed." >&2
	exit 1
fi

mkdir -p "${TOOLS_DIR}"
if [[ ! -x "${UV_BIN}" ]]; then
	echo "Installing uv into ${TOOLS_DIR} ..."
	curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="${TOOLS_DIR}" sh
fi

if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
	echo "Installing Python ${PYTHON_VERSION} and creating ${VENV_DIR} ..."
	"${UV_BIN}" python install "${PYTHON_VERSION}"
	"${UV_BIN}" venv --seed --python "${PYTHON_VERSION}" "${VENV_DIR}"
fi

installed_python="$(${VENV_DIR}/bin/python -c 'import platform; print(platform.python_version())')"
if [[ "${installed_python}" != "${PYTHON_VERSION}."* ]]; then
	echo "Error: ${VENV_DIR} uses Python ${installed_python}; expected ${PYTHON_VERSION}.x." >&2
	echo "Remove cf_venv and rerun this script to recreate it." >&2
	exit 1
fi

if [[ ! -d "${COMFYUI_DIR}/.git" ]]; then
	echo "Cloning ComfyUI into ${COMFYUI_DIR} ..."
	git clone "${COMFYUI_REPO}" "${COMFYUI_DIR}"
else
	echo "ComfyUI already exists. Pulling latest changes ..."
	git -C "${COMFYUI_DIR}" pull --ff-only
fi

"${VENV_DIR}/bin/python" -m pip install --upgrade pip setuptools wheel
"${VENV_DIR}/bin/python" -m pip install \
	--extra-index-url "${PYTORCH_INDEX_URL}" \
	torch torchvision torchaudio
"${VENV_DIR}/bin/python" -m pip install \
	--extra-index-url "${PYTORCH_INDEX_URL}" \
	-r "${COMFYUI_DIR}/requirements.txt"

if [[ -f "${COMFYUI_DIR}/manager_requirements.txt" ]]; then
	"${VENV_DIR}/bin/python" -m pip install -r "${COMFYUI_DIR}/manager_requirements.txt"
fi
"${VENV_DIR}/bin/python" -m pip install --upgrade --pre comfyui-manager

echo
echo "ComfyUI installation complete."
echo "Python: $(${VENV_DIR}/bin/python --version)"
echo "PyTorch: $(${VENV_DIR}/bin/python -c 'import torch; print(torch.__version__)')"
echo "Start it with: ${SCRIPT_DIR}/start_comfyui.sh start"
