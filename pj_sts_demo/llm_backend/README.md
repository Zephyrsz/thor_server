# LLM Backend

This module documents the remote llama.cpp `llama-server` service used by the realtime backend.

The realtime speech backend in `../backend/start_realtime.sh` calls:

```text
http://localhost:8000/v1
```

and uses model id:

```text
qwen35b
```

## Remote Runtime Observed

Remote startup script:

```text
/home/ubuntu/start_llama.sh
```

Remote preset file:

```text
/home/ubuntu/models.ini
```

Current server process shape:

```text
/home/ubuntu/llama.cpp/build/bin/llama-server --models-preset /home/ubuntu/models.ini --host 0.0.0.0 --port 8000
```

`/home/ubuntu/models.ini` defines:

- `qwen35b`: Qwen3.6 35B GGUF, multimodal projector, `ctx-size = 131072`, `n-gpu-layers = 99`, `jinja = on`
- `qwythos9b`: Qwythos 9B GGUF, multimodal projector, `ctx-size = 131072`

## Files

- `start_llama.sh`: local source copy of the remote llama-server service wrapper.
- `models.ini.example`: current remote preset layout captured as a source-controlled example.
- `systemd/llama-server.service.example`: recommended shape for a supervised production service.

## Startup Dependencies

Required on the remote host:

- `/home/ubuntu/llama.cpp/build/bin/llama-server`
- `/home/ubuntu/models.ini`
- GGUF model files referenced by the preset file
- `curl` for readiness checks
- write access to `/home/ubuntu/data/llama-server.log`
- enough CPU RAM and GPU VRAM for the selected model, context, and KV cache
- port `8000` available for the router process

Optional:

- `sudo` permission only when starting with `DROP_CACHES=1`
- `systemd` for supervised startup instead of `nohup`

## Service Wrapper

The local `start_llama.sh` mirrors the remote service shape and supports:

```bash
./start_llama.sh start
./start_llama.sh stop
./start_llama.sh restart
./start_llama.sh status
./start_llama.sh logs
./start_llama.sh check
```

Useful overrides:

```bash
LLAMA_BIN=/home/ubuntu/llama.cpp/build/bin/llama-server \
MODEL_INI=/home/ubuntu/models.ini \
HOST=127.0.0.1 \
PORT=8000 \
LOG_FILE=/home/ubuntu/data/llama-server.log \
PID_FILE=/home/ubuntu/data/llama-server.pid \
./start_llama.sh start
```

Readiness uses:

```text
http://localhost:8000/health
```

Use `DROP_CACHES=1 ./start_llama.sh start` only for controlled troubleshooting.

## Recommended Deployment Improvements

1. Use `systemd` for production.

   The current script uses `nohup` and `/tmp/llama-server.pid`. A systemd unit gives restart policy, structured logs, boot-time startup, resource limits, and less fragile PID management. Use `systemd/llama-server.service.example` as a starting point.

2. Bind llama-server to loopback unless clients need direct access.

   The realtime backend runs on the same host and calls `http://localhost:8000/v1`. If no external clients need direct llama-server access, prefer `HOST=127.0.0.1` and expose only the realtime WSS service. This reduces accidental access to the raw model server.

   If the model server must be reachable outside the host, put it behind a private network, firewall allowlist, or reverse proxy and set an API key. Do not expose the raw port broadly.

3. Keep stable model aliases.

   The backend must pass `qwen35b`, not the GGUF file path. Presets are the right place to map stable aliases to model files.

4. Right-size context.

   `ctx-size = 131072` is very large. It is useful for long documents, but voice turns are usually short and large contexts increase KV-cache memory. Consider testing `32768` or `65536` for lower memory pressure and faster startup unless long-context conversations are required.

5. Tune concurrency deliberately.

   llama.cpp supports multiple users and parallel decoding with `-np` / `--parallel`; its README shows the context budget should scale with concurrent requests. For this app, the realtime server currently uses one pipeline, so one LLM request stream at a time is expected. Increase concurrency only after measuring latency and VRAM.

6. Benchmark before changing batch settings.

   llama-server exposes `--batch-size` and `--ubatch-size`; larger values can improve prompt processing but increase memory pressure. Tune with representative prompts and watch latency, VRAM, and errors.

7. Consider Flash Attention and KV offload explicitly.

   Current llama-server defaults may already choose suitable behavior. For CUDA builds, test `flash-attn = on` or leave `auto`, and keep KV offload enabled if GPU memory allows. Verify with logs and latency rather than assuming one setting is universally best.

8. Add log rotation and health checks.

   The current log file grows under `/home/ubuntu/data/llama-server.log`. Add logrotate or journald retention. Use `/health` as the readiness check and add a simple smoke request against the `qwen35b` alias after deploy.

9. Avoid dropping OS page cache on every start unless proven necessary.

   `vm.drop_caches=3` can make startup behavior more predictable for testing, but it also discards useful cache for the whole machine. The local wrapper keeps it behind `DROP_CACHES=1`.

## References

- llama.cpp server README: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- llama.cpp server development README: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README-dev.md
- llama.cpp README: https://github.com/ggml-org/llama.cpp/blob/master/README.md
- ggml-org model-management article: https://huggingface.co/blog/ggml-org/model-management-in-llamacpp
