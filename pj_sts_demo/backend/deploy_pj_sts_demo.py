from __future__ import annotations

import argparse
import shlex
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
from remote import run_script


PROJECT_DIR = "/home/ubuntu/pj_sts_demo"
REPO_URL = "https://github.com/huggingface/speech-to-speech.git"
LLM_BASE_URL = "http://thor:8003/v1"
DEFAULT_CONFIG = REPO_ROOT / "connect.cfg"


def build_deploy_script(model_name: str | None) -> str:
    requested_model = shlex.quote(model_name or "")
    return f"""set -euo pipefail

PROJECT_DIR={shlex.quote(PROJECT_DIR)}
REPO_URL={shlex.quote(REPO_URL)}
LLM_BASE_URL={shlex.quote(LLM_BASE_URL)}
REQUESTED_MODEL={requested_model}

echo "Deploying speech-to-speech into $PROJECT_DIR"

command -v git >/dev/null || {{ echo "git is required on the remote server"; exit 1; }}
command -v python3 >/dev/null || {{ echo "python3 is required on the remote server"; exit 1; }}

VENV_TEST_DIR="$(mktemp -d)"
if ! python3 -m venv "$VENV_TEST_DIR/test-venv" >/dev/null 2>&1; then
  PY_VER="$(python3 - <<'PY'
import sys
print(f"{{sys.version_info.major}}.{{sys.version_info.minor}}")
PY
)"
  if command -v sudo >/dev/null && command -v apt-get >/dev/null; then
    sudo apt-get update
    sudo apt-get install -y "python${{PY_VER}}-venv" python3-venv
  else
    echo "python3 venv support is missing; install python${{PY_VER}}-venv and rerun"
    exit 1
  fi
fi
rm -rf "$VENV_TEST_DIR"

mkdir -p "$(dirname "$PROJECT_DIR")"

if [ -d "$PROJECT_DIR/.git" ]; then
  cd "$PROJECT_DIR"
  git fetch origin
  git pull --ff-only origin main
elif [ -d "$PROJECT_DIR" ] && [ "$(find "$PROJECT_DIR" -mindepth 1 -maxdepth 1 | head -n 1)" ]; then
  echo "$PROJECT_DIR exists and is not empty; refusing to overwrite it"
  exit 2
else
  rm -rf "$PROJECT_DIR"
  git clone "$REPO_URL" "$PROJECT_DIR"
  cd "$PROJECT_DIR"
fi

if [ -z "$REQUESTED_MODEL" ]; then
  DETECTED_MODEL="$(python3 - <<'PY' || true
import json
import urllib.request

try:
    with urllib.request.urlopen("http://localhost:8003/v1/models", timeout=3) as response:
        data = json.load(response)
    models = data.get("data") or []
    print(models[0].get("id", "") if models else "")
except Exception:
    print("")
PY
)"
  MODEL_NAME="${{DETECTED_MODEL:-local-model}}"
else
  MODEL_NAME="$REQUESTED_MODEL"
fi

python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
python -m pip install -e .

cat > .env.local <<EOF
OPENAI_API_KEY=not-needed
RESPONSES_API_BASE_URL=$LLM_BASE_URL
MODEL_NAME=$MODEL_NAME
EOF

cat > run_local_llm.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
. .venv/bin/activate

if [ -f .env.local ]; then
  set -a
  . ./.env.local
  set +a
fi

export OPENAI_API_KEY="${{OPENAI_API_KEY:-not-needed}}"
RESPONSES_API_BASE_URL="${{RESPONSES_API_BASE_URL:-http://localhost:8003/v1}}"
MODEL_NAME="${{MODEL_NAME:-local-model}}"

exec speech-to-speech \\
  --mode realtime \\
  --stt parakeet-tdt \\
  --llm_backend responses-api \\
  --tts qwen3 \\
  --model_name "$MODEL_NAME" \\
  --responses_api_base_url "$RESPONSES_API_BASE_URL" \\
  --responses_api_api_key "$OPENAI_API_KEY" \\
  --responses_api_stream
EOF
chmod +x run_local_llm.sh

cat > README_DEPLOYMENT.md <<EOF
# pj_sts_demo

Source: $REPO_URL

Python environment:

    $PROJECT_DIR/.venv

Local LLM endpoint:

    $LLM_BASE_URL

Detected/configured model:

    $MODEL_NAME

Run:

    cd $PROJECT_DIR
    MODEL_NAME="$MODEL_NAME" ./run_local_llm.sh

If the local LLM exposes a different model id, pass it with MODEL_NAME:

    MODEL_NAME="your-model-id" ./run_local_llm.sh
EOF

echo "Deployment complete"
echo "Project: $PROJECT_DIR"
echo "Venv: $PROJECT_DIR/.venv"
echo "LLM base URL: $LLM_BASE_URL"
echo "Model: $MODEL_NAME"
"""


def main() -> None:
    parser = argparse.ArgumentParser(description="Deploy speech-to-speech to the Thor server")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG), help="Path to connect.cfg")
    parser.add_argument("--model-name", help="Model id served by the local LLM on port 8003")
    parser.add_argument("--timeout", type=int, help="Stop deployment after this many seconds")
    parser.add_argument("--capture", action="store_true", help="Capture output instead of streaming it")
    args = parser.parse_args()

    try:
        result = run_script(
            build_deploy_script(args.model_name),
            config=args.config,
            capture=args.capture,
            timeout=args.timeout,
        )
    except subprocess.TimeoutExpired:
        print(f"deployment timed out after {args.timeout}s")
        raise SystemExit(124)

    if args.capture:
        print(result.stdout, end="")
        print(result.stderr, end="")
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
