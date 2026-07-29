#!/usr/bin/env python3
"""Download Hugging Face model files into the matching ComfyUI model folder.

Examples:
  ./download_comfyui_model.py \
    https://huggingface.co/Comfy-Org/z_image_turbo/blob/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors

  ./download_comfyui_model.py URL --model-type vae
  ./download_comfyui_model.py --url-file missing-models.txt
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path, PurePosixPath
from typing import NamedTuple
from urllib.parse import parse_qs, quote, unquote, urlparse


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_MODELS_DIR = SCRIPT_DIR / "ComfyUI" / "models"
SOURCE_WRAPPER_CHARS = " \t\r\n`'\"\u2018\u2019\u201c\u201d"
MARKDOWN_LINK_RE = re.compile(r"^\[[^\]]*\]\(\s*<?(.+?)>?\s*\)$")
HF_URL_RE = re.compile(
    r"https?://(?:www\.)?huggingface\.co/[^\s<>\]\)]+",
    re.IGNORECASE,
)

# These are the model folders created by a current ComfyUI checkout.
MODEL_TYPES = (
    "audio_encoders",
    "background_removal",
    "checkpoints",
    "clip",
    "clip_vision",
    "configs",
    "controlnet",
    "detection",
    "diffusers",
    "diffusion_models",
    "embeddings",
    "frame_interpolation",
    "geometry_estimation",
    "gligen",
    "hypernetworks",
    "latent_upscale_models",
    "loras",
    "model_patches",
    "optical_flow",
    "photomaker",
    "style_models",
    "text_encoders",
    "unet",
    "upscale_models",
    "vae",
    "vae_approx",
)

MODEL_TYPE_ALIASES = {
    "audio_encoder": "audio_encoders",
    "background-removal": "background_removal",
    "checkpoint": "checkpoints",
    "checkpoints": "checkpoints",
    "clip-vision": "clip_vision",
    "controlnets": "controlnet",
    "diffusion-models": "diffusion_models",
    "diffusion_model": "diffusion_models",
    "embedding": "embeddings",
    "frame-interpolation": "frame_interpolation",
    "geometry-estimation": "geometry_estimation",
    "hypernetwork": "hypernetworks",
    "latent-upscale-models": "latent_upscale_models",
    "lora": "loras",
    "lycoris": "loras",
    "model-patches": "model_patches",
    "optical-flow": "optical_flow",
    "style-models": "style_models",
    "text-encoders": "text_encoders",
    "text_encoder": "text_encoders",
    "upscale-models": "upscale_models",
    "upscalers": "upscale_models",
    "vae-approx": "vae_approx",
}

# Must be set before importing huggingface_hub.
os.environ.setdefault("HF_XET_HIGH_PERFORMANCE", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")


class HfTarget(NamedTuple):
    repo_id: str
    filename: str
    revision: str


def reexec_in_comfyui_venv() -> None:
    """Use the sibling ComfyUI environment when the script is run directly."""
    venv_python = SCRIPT_DIR / "cf_venv" / "bin" / "python"
    if os.environ.get("COMFYUI_DOWNLOADER_REEXEC") or not venv_python.is_file():
        return
    if Path(sys.executable).resolve() == venv_python.resolve():
        return

    env = os.environ.copy()
    env["COMFYUI_DOWNLOADER_REEXEC"] = "1"
    os.execve(
        str(venv_python),
        [str(venv_python), str(Path(__file__).resolve()), *sys.argv[1:]],
        env,
    )


def extract_hf_url(source: str) -> str:
    """Extract one Hugging Face URL from raw or commonly wrapped input."""
    cleaned = source.strip(SOURCE_WRAPPER_CHARS)
    markdown_match = MARKDOWN_LINK_RE.fullmatch(cleaned)
    if markdown_match:
        candidate = markdown_match.group(1).strip(SOURCE_WRAPPER_CHARS)
        if HF_URL_RE.fullmatch(candidate):
            return candidate

    candidates = [
        candidate.rstrip(SOURCE_WRAPPER_CHARS)
        for candidate in HF_URL_RE.findall(cleaned)
    ]
    if len(candidates) != 1:
        raise ValueError("input must contain exactly one huggingface.co URL")
    return candidates[0]


def parse_hf_url(source: str) -> HfTarget:
    """Parse a wrapped Hugging Face blob, resolve, or tree file URL."""
    url = extract_hf_url(source)
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or parsed.netloc.lower() not in {
        "huggingface.co",
        "www.huggingface.co",
    }:
        raise ValueError(f"not a huggingface.co URL: {url}")

    parts = [unquote(part) for part in parsed.path.strip("/").split("/") if part]
    marker_indexes = [
        index for index, part in enumerate(parts) if part in {"blob", "resolve", "tree"}
    ]
    if not marker_indexes:
        raise ValueError(
            "URL must contain /blob/{revision}/{file}, /resolve/{revision}/{file}, "
            "or /tree/{revision}#:~:text={file}"
        )

    marker_index = marker_indexes[0]
    if marker_index < 1 or marker_index + 1 >= len(parts):
        raise ValueError("URL does not contain a repository and revision")

    marker = parts[marker_index]
    repo_id = "/".join(parts[:marker_index])
    revision = parts[marker_index + 1]
    if marker in {"blob", "resolve"}:
        if marker_index + 2 >= len(parts):
            raise ValueError("URL does not contain a filename")
        filename = "/".join(parts[marker_index + 2 :])
    else:
        fragment = parsed.fragment.removeprefix(":~:")
        text_values = parse_qs(fragment, keep_blank_values=True).get("text", [])
        if len(text_values) != 1 or not text_values[0]:
            raise ValueError(
                "tree URL must contain exactly one non-empty :~:text= filename"
            )
        basename = text_values[0]
        if "/" in basename or "\\" in basename or basename in {".", ".."}:
            raise ValueError("tree URL text fragment must contain a file basename")
        filename = "/".join([*parts[marker_index + 2 :], basename])

    return HfTarget(
        repo_id=repo_id,
        revision=revision,
        filename=filename,
    )


def resolve_url(target: HfTarget) -> str:
    repo = "/".join(quote(part, safe="") for part in target.repo_id.split("/"))
    revision = quote(target.revision, safe="")
    filename = "/".join(quote(part, safe="") for part in target.filename.split("/"))
    return f"https://huggingface.co/{repo}/resolve/{revision}/{filename}"


def normalize_model_type(value: str) -> str:
    normalized = value.strip().lower().replace(" ", "_")
    normalized = MODEL_TYPE_ALIASES.get(normalized, normalized)
    if normalized not in MODEL_TYPES:
        choices = ", ".join(MODEL_TYPES)
        raise ValueError(f"unknown model type {value!r}; choose one of: {choices}")
    return normalized


def infer_model_type(filename: str) -> str:
    """Infer a ComfyUI folder from directory names in the repository path."""
    directory_parts = list(PurePosixPath(filename).parts[:-1])
    for part in reversed(directory_parts):
        try:
            return normalize_model_type(part)
        except ValueError:
            continue
    raise ValueError(
        f"cannot infer a ComfyUI model type from {filename!r}; "
        "pass --model-type explicitly"
    )


def read_sources(args: argparse.Namespace) -> list[str]:
    sources = list(args.urls)
    if args.url_file:
        for raw_line in args.url_file.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if line and not line.startswith("#"):
                sources.append(line)
    if not sources:
        raise ValueError("provide at least one URL or use --url-file")
    return sources


def ensure_huggingface_hub():
    try:
        from huggingface_hub import hf_hub_download  # type: ignore

        return hf_hub_download
    except ImportError as exc:
        raise SystemExit(
            "Missing huggingface_hub. Run this script from the ComfyUI directory "
            "after install_comfyui.sh, or install 'huggingface_hub[hf_xet]'."
        ) from exc


def download_with_hf(
    target: HfTarget,
    output: Path,
    models_dir: Path,
    token: str | None,
    force: bool,
) -> None:
    hf_hub_download = ensure_huggingface_hub()
    staging_dir = models_dir / ".downloads"
    staging_dir.mkdir(parents=True, exist_ok=True)
    downloaded = Path(
        hf_hub_download(
            repo_id=target.repo_id,
            filename=target.filename,
            revision=target.revision,
            token=token,
            local_dir=str(staging_dir),
            force_download=force,
        )
    ).resolve()
    if output.exists():
        output.unlink()
    shutil.move(str(downloaded), str(output))


def download_with_aria2(
    url: str,
    output: Path,
    token: str | None,
    connections: int,
) -> None:
    aria2c = shutil.which("aria2c")
    if not aria2c:
        raise SystemExit("aria2c is not installed; use --backend hf")

    command = [
        aria2c,
        "--continue=true",
        "--allow-overwrite=true",
        "--auto-file-renaming=false",
        "--file-allocation=none",
        "--max-connection-per-server",
        str(connections),
        "--split",
        str(connections),
        "--min-split-size=1M",
        "--max-tries=0",
        "--retry-wait=5",
        "--summary-interval=10",
        "--dir",
        str(output.parent),
        "--out",
        output.name,
    ]
    if token:
        command.extend(["--header", f"Authorization: Bearer {token}"])
    command.append(url)
    subprocess.run(command, check=True)


def download_one(source: str, args: argparse.Namespace) -> Path:
    target = parse_hf_url(source)
    model_type = normalize_model_type(args.model_type) if args.model_type else infer_model_type(target.filename)
    filename = Path(PurePosixPath(target.filename).name).name
    if not filename:
        raise ValueError(f"URL has no downloadable filename: {source}")

    models_dir = args.models_dir.expanduser().resolve()
    output_dir = models_dir / model_type
    output = output_dir / filename
    normalized_url = resolve_url(target)

    print(f"Repo:       {target.repo_id}")
    print(f"Revision:   {target.revision}")
    print(f"Remote file:{' ' if target.filename else ''}{target.filename}")
    print(f"Resolve URL: {normalized_url}")
    print(f"Model type: {model_type}")
    print(f"Output:     {output}")

    if args.dry_run:
        print("Dry run:    no file downloaded")
        return output

    output_dir.mkdir(parents=True, exist_ok=True)
    aria2_control = output.with_name(output.name + ".aria2")
    if output.is_file() and not args.force and not (
        args.backend == "aria2" and aria2_control.exists()
    ):
        print("Status:     already present; skipped")
        return output

    started = time.monotonic()
    if args.backend == "aria2":
        if args.force:
            output.unlink(missing_ok=True)
            aria2_control.unlink(missing_ok=True)
        download_with_aria2(normalized_url, output, args.token, args.connections)
    else:
        download_with_hf(target, output, models_dir, args.token, args.force)

    elapsed = max(time.monotonic() - started, 0.001)
    size_gib = output.stat().st_size / (1024**3)
    print(f"Status:     downloaded ({size_gib:.2f} GiB in {elapsed:.1f}s)")
    return output


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download Hugging Face files into their matching ComfyUI model folders."
    )
    parser.add_argument(
        "urls",
        nargs="*",
        help="Hugging Face blob, resolve, or tree text-fragment URL(s)",
    )
    parser.add_argument("--url-file", type=Path, help="Text file containing one URL per line")
    parser.add_argument(
        "--models-dir",
        type=Path,
        default=DEFAULT_MODELS_DIR,
        help=f"ComfyUI models root (default: {DEFAULT_MODELS_DIR})",
    )
    parser.add_argument(
        "--model-type",
        help="Override automatic folder detection, for example checkpoints, vae, or loras",
    )
    parser.add_argument(
        "--backend",
        choices=("hf", "aria2"),
        default="hf",
        help="Download backend (default: hf with resumable Xet support)",
    )
    parser.add_argument("--connections", type=int, default=16, help="aria2 connection count")
    parser.add_argument(
        "--token",
        default=os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN"),
        help="Hugging Face token; defaults to HF_TOKEN or HUGGING_FACE_HUB_TOKEN",
    )
    parser.add_argument("--force", action="store_true", help="redownload existing files")
    parser.add_argument("--dry-run", action="store_true", help="show mapping without downloading")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    sources = read_sources(args)
    for index, source in enumerate(sources):
        if index:
            print()
        download_one(source, args)
    return 0


if __name__ == "__main__":
    reexec_in_comfyui_venv()
    try:
        raise SystemExit(main())
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(2)
    except KeyboardInterrupt:
        print("\nInterrupted. Rerun the same command to resume.", file=sys.stderr)
        raise SystemExit(130)
