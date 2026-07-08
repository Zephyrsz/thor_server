# Backend

This directory contains server-side deployment and realtime service scripts.

The realtime backend depends on the llama.cpp model server documented in `../llm_backend`.

## Files

- `deploy_pj_sts_demo.py`: deploys the speech-to-speech backend to the Thor server through the repository-level `remote.py` helper.
- `start_realtime.sh`: starts, stops, or restarts the realtime backend and its nginx WSS proxy.
- `logs/`: backend runtime logs.
- `service.pid`: backend runtime pid file.

## Commands

Deploy from the local workstation:

```bash
python deploy_pj_sts_demo.py --timeout 3600
```

Manage realtime service on the backend host:

```bash
./start_realtime.sh start
./start_realtime.sh stop
./start_realtime.sh restart
```
