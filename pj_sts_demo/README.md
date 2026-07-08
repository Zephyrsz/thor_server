# pj_sts_demo

Local demo project for a browser UI that connects to a remote speech-to-speech realtime service.

## Structure

- `backend/`: remote deployment helpers and realtime backend service scripts.
- `llm_backend/`: llama.cpp model-server startup scripts, presets, and deployment notes.
- `frontend/`: Next.js browser UI, UI service script, UI env, local certs, and UI logs.
- `DESIGN.md`: visual and UX direction.
- `PRODUCT.md`: product scope and user goals.

## Common Commands

Start the local UI:

```bash
cd frontend
./start_ui.sh start
```

Backend deployment helpers live under:

```bash
cd backend
python deploy_pj_sts_demo.py --timeout 3600
```

`backend/start_realtime.sh` is the realtime service script intended for the remote backend host layout.

LLM backend service notes live under:

```bash
cd llm_backend
./start_llama.sh status
```
