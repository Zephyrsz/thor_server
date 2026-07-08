---
name: thor-server
description: Connect to the Thor remote server using the local connect.cfg file and remote.py helper. Use this skill when the user asks to run shell commands, inspect server state, or troubleshoot work on the Thor server.
---

# Thor Server

Use this skill to run commands on the remote server defined in `connect.cfg`.

## Files

- `connect.cfg`: the SSH target or command. Keep this as the single source of truth.
- `remote.py`: a small Python wrapper around the local `ssh` command.

## Connect

From this skill directory:

```bash
python remote.py "hostname && whoami && pwd"
```

`remote.py` reads `connect.cfg`, appends the command, and executes SSH.
Use `--timeout 10` when checking connectivity so SSH cannot hang indefinitely.

## Python Usage

```python
from remote import copy_to_remote, run, run_script

result = run("uname -a", capture=True, timeout=10)
print(result.stdout)

run_script("set -e\ncd /tmp\npwd\n")
copy_to_remote("local.txt", "/tmp/local.txt", timeout=10)
```

Use `check=True` when a failed remote command should raise an exception:

```python
run("ls -la /tmp", check=True)
```

Copy a file from the shell:

```bash
python remote.py --copy local.txt /tmp/local.txt --timeout 10
```

## connect.cfg Format

Use one non-comment line:

```text
ssh user@host
```

This also works:

```text
ssh -i ~/.ssh/id_ed25519 -p 22 user@host
```

Do not hardcode the server address in other scripts. Update `connect.cfg` instead.

## Deploy pj_sts_demo

`req.txt` is implemented by `pj_sts_demo/backend/deploy_pj_sts_demo.py`.
The repository root `deploy_pj_sts_demo.py` remains as a compatibility wrapper.

Run from this skill directory:

```bash
python deploy_pj_sts_demo.py --timeout 3600
```

This deploys `https://github.com/huggingface/speech-to-speech.git` to:

```text
/home/ubuntu/pj_sts_demo
```

It creates the Python environment inside the project:

```text
/home/ubuntu/pj_sts_demo/.venv
```

It also writes:

- `/home/ubuntu/pj_sts_demo/.env.local`
- `/home/ubuntu/pj_sts_demo/run_local_llm.sh`
- `/home/ubuntu/pj_sts_demo/README_DEPLOYMENT.md`

The launcher uses the remote server's local OpenAI-compatible LLM endpoint:

```text
http://localhost:8003/v1
```

If the local LLM serves a known model id, pass it explicitly:

```bash
python deploy_pj_sts_demo.py --model-name "your-model-id" --timeout 3600
```
