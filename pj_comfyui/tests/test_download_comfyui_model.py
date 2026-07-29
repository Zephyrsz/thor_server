from __future__ import annotations

import importlib.util
import subprocess
import sys
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "download_comfyui_model.py"
SPEC = importlib.util.spec_from_file_location("download_comfyui_model", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
downloader = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = downloader
SPEC.loader.exec_module(downloader)

FLUX_TREE_URL = (
    "https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev/"
    "tree/main#:~:text=flux1%2Dkontext%2Ddev.safetensors"
)
EXPECTED_TARGET = downloader.HfTarget(
    "black-forest-labs/FLUX.1-Kontext-dev",
    "flux1-kontext-dev.safetensors",
    "main",
)
EXPECTED_RESOLVE_URL = (
    "https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev/"
    "resolve/main/flux1-kontext-dev.safetensors"
)


class ParseHfUrlTests(unittest.TestCase):
    def test_parses_tree_text_fragment(self):
        target = downloader.parse_hf_url(FLUX_TREE_URL)
        self.assertEqual(target, EXPECTED_TARGET)
        self.assertEqual(downloader.resolve_url(target), EXPECTED_RESOLVE_URL)

    def test_accepts_raw_markdown_and_quote_wrappers(self):
        wrapped_sources = (
            FLUX_TREE_URL,
            f"[model]({FLUX_TREE_URL})",
            f"`{FLUX_TREE_URL}`",
            f"'{FLUX_TREE_URL}'",
            f"\u2018{FLUX_TREE_URL}\u2019",
            f"\u2018[{FLUX_TREE_URL}\u2019\u2018\u2019]"
            f"({FLUX_TREE_URL}\u2019\u2018\u2019)\u2019",
        )
        for source in wrapped_sources:
            with self.subTest(source=source):
                self.assertEqual(downloader.parse_hf_url(source), EXPECTED_TARGET)

    def test_tree_directory_is_preserved(self):
        target = downloader.parse_hf_url(
            "https://huggingface.co/Comfy-Org/example/tree/main/"
            "split_files/diffusion_models#:~:text=model%2Esafetensors"
        )
        self.assertEqual(target.filename, "split_files/diffusion_models/model.safetensors")

    def test_preserves_blob_and_resolve_inputs(self):
        for marker in ("blob", "resolve"):
            with self.subTest(marker=marker):
                target = downloader.parse_hf_url(
                    "https://huggingface.co/owner/repo/"
                    f"{marker}/main/diffusion_models/model.safetensors"
                )
                self.assertEqual(
                    target,
                    downloader.HfTarget(
                        "owner/repo",
                        "diffusion_models/model.safetensors",
                        "main",
                    ),
                )

    def test_rejects_invalid_tree_fragments(self):
        invalid_sources = (
            "https://huggingface.co/owner/repo/tree/main",
            "https://huggingface.co/owner/repo/tree/main#:~:text=",
            "https://huggingface.co/owner/repo/tree/main#:~:text=a&text=b",
            "https://huggingface.co/owner/repo/tree/main#:~:text=..%2Fsecret",
        )
        for source in invalid_sources:
            with self.subTest(source=source):
                with self.assertRaises(ValueError):
                    downloader.parse_hf_url(source)

    def test_rejects_invalid_or_ambiguous_sources(self):
        invalid_sources = (
            "https://example.com/owner/repo/blob/main/model.safetensors",
            f"{FLUX_TREE_URL} {FLUX_TREE_URL}",
        )
        for source in invalid_sources:
            with self.subTest(source=source):
                with self.assertRaises(ValueError):
                    downloader.parse_hf_url(source)


class CliTests(unittest.TestCase):
    def test_dry_run_prints_resolve_url_for_wrapped_tree_link(self):
        wrapped_source = (
            f"\u2018[{FLUX_TREE_URL}\u2019\u2018\u2019]"
            f"({FLUX_TREE_URL}\u2019\u2018\u2019)\u2019"
        )
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT_PATH),
                wrapped_source,
                "--model-type",
                "diffusion_models",
                "--dry-run",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"Resolve URL: {EXPECTED_RESOLVE_URL}", result.stdout)
        self.assertIn("Model type: diffusion_models", result.stdout)
        self.assertIn("Dry run:    no file downloaded", result.stdout)


if __name__ == "__main__":
    unittest.main()
