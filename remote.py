"""
Run commands on the remote server described by connect.cfg.

connect.cfg should contain one SSH target or command, for example:

    ssh ubuntu@192.168.3.11
    ssh -i ~/.ssh/id_ed25519 -p 22 ubuntu@192.168.3.11
    ubuntu@192.168.3.11
"""
from __future__ import annotations

import argparse
import shlex
import subprocess
from pathlib import Path


DEFAULT_CONFIG = Path(__file__).with_name("connect.cfg")


def load_ssh_command(path: str | Path = DEFAULT_CONFIG) -> list[str]:
    """Return the base ssh command from connect.cfg."""
    config_path = Path(path).expanduser()
    for line in config_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            parts = shlex.split(line)
            return parts if parts[0] == "ssh" else ["ssh", *parts]
    raise ValueError(f"no ssh target found in {config_path}")


def load_scp_command(path: str | Path = DEFAULT_CONFIG) -> list[str]:
    """Return the base scp command matching connect.cfg."""
    ssh_command = load_ssh_command(path)
    scp_command = ["scp"]
    i = 1
    while i < len(ssh_command):
        part = ssh_command[i]
        if part == "-p":
            if i + 1 >= len(ssh_command):
                raise ValueError("-p in connect.cfg is missing a port")
            scp_command.extend(["-P", ssh_command[i + 1]])
            i += 2
            continue
        if part in {"-i", "-F", "-o"}:
            if i + 1 >= len(ssh_command):
                raise ValueError(f"{part} in connect.cfg is missing a value")
            scp_command.extend([part, ssh_command[i + 1]])
            i += 2
            continue
        if part.startswith("-"):
            scp_command.append(part)
            i += 1
            continue
        break
    return scp_command


def run(
    command: str,
    *,
    config: str | Path = DEFAULT_CONFIG,
    check: bool = False,
    capture: bool = False,
    timeout: int | None = None,
) -> subprocess.CompletedProcess[str]:
    """Run a shell command on the configured remote server."""
    ssh_command = [*load_ssh_command(config), command]
    return subprocess.run(
        ssh_command,
        check=check,
        text=True,
        capture_output=capture,
        timeout=timeout,
    )


def copy_to_remote(
    local_path: str | Path,
    remote_path: str,
    *,
    config: str | Path = DEFAULT_CONFIG,
    check: bool = False,
    capture: bool = False,
    timeout: int | None = None,
) -> subprocess.CompletedProcess[str]:
    """Copy a local file or directory to the configured remote server."""
    ssh_command = load_ssh_command(config)
    remote_target = ssh_command[-1]
    scp_command = [*load_scp_command(config), str(Path(local_path).expanduser()), f"{remote_target}:{remote_path}"]
    return subprocess.run(
        scp_command,
        check=check,
        text=True,
        capture_output=capture,
        timeout=timeout,
    )


def run_script(
    script: str,
    *,
    config: str | Path = DEFAULT_CONFIG,
    check: bool = False,
    capture: bool = False,
    timeout: int | None = None,
) -> subprocess.CompletedProcess[str]:
    """Run a bash script on the configured remote server."""
    ssh_command = [*load_ssh_command(config), "bash -s"]
    return subprocess.run(
        ssh_command,
        input=script,
        check=check,
        text=True,
        capture_output=capture,
        timeout=timeout,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a command on the server in connect.cfg")
    parser.add_argument("command", nargs="?", default="hostname && whoami && pwd")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG), help="Path to connect.cfg")
    parser.add_argument("--copy", metavar=("LOCAL", "REMOTE"), nargs=2, help="Copy LOCAL to REMOTE with scp")
    parser.add_argument("--capture", action="store_true", help="Capture output instead of streaming it")
    parser.add_argument("--timeout", type=int, help="Stop the SSH command after this many seconds")
    args = parser.parse_args()

    try:
        if args.copy:
            result = copy_to_remote(
                args.copy[0],
                args.copy[1],
                config=args.config,
                capture=args.capture,
                timeout=args.timeout,
            )
        else:
            result = run(args.command, config=args.config, capture=args.capture, timeout=args.timeout)
    except subprocess.TimeoutExpired:
        print(f"remote command timed out after {args.timeout}s")
        raise SystemExit(124)
    if args.capture:
        print(result.stdout, end="")
        print(result.stderr, end="")
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
