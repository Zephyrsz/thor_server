# Hugging Face Tree URL Preprocessing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept raw or wrapped Hugging Face `tree` text-fragment links and normalize them, along with existing `blob` and `resolve` links, to canonical `resolve` download URLs.

**Architecture:** Add a small source-extraction boundary before the existing URL parser. Extend `parse_hf_url()` to turn `tree/{revision}[/{directory}]#:~:text={filename}` into the existing `HfTarget`; keep `resolve_url()`, model placement, authentication, and download backends unchanged.

**Tech Stack:** Python 3 standard library (`re`, `urllib.parse`, `unittest`, `subprocess`), Markdown documentation.

---

## File Structure

- Create `pj_comfyui/tests/test_download_comfyui_model.py`: parser and CLI regression tests.
- Modify `pj_comfyui/download_comfyui_model.py`: wrapper extraction and `tree` parsing.
- Modify `pj_comfyui/download_comfyui_model.md`: supported input forms and examples.
- Modify `.gitignore`: keep the local SSH connection configuration out of Git.
- Untrack `connect.cfg`: preserve the local file while removing it from the index.

### Task 0: Stop Tracking The Local Connection Configuration

**Files:**
- Modify: `.gitignore`
- Untrack: `connect.cfg`

- [x] **Step 1: Ignore and untrack the local configuration**

Add `connect.cfg` under the local runtime section of `.gitignore`, then run:

```bash
git rm --cached connect.cfg
```

- [x] **Step 2: Verify the local file remains and no sensitive contents are staged**

Run:

```bash
test -f connect.cfg
git check-ignore -q connect.cfg
git diff --cached --name-status -- connect.cfg
```

Expected: the local file exists, Git ignores it, and the staged change reports
only `D connect.cfg`. Do not print or stage the working-tree contents.

### Task 1: Parser And CLI Regression Tests

**Files:**
- Create: `pj_comfyui/tests/test_download_comfyui_model.py`
- Test: `pj_comfyui/tests/test_download_comfyui_model.py`

- [x] **Step 1: Write failing parser and CLI tests**

Create the complete test module:

```python
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
```

- [x] **Step 2: Run tests and verify the expected failure**

Run:

```bash
python3 -m unittest discover -s pj_comfyui/tests -v
```

Expected: the `tree`, wrapper, and CLI tests fail because the current parser
only recognizes raw `blob` and `resolve` URLs. Existing compatibility tests
pass.

- [x] **Step 3: Record the RED result and proceed to implementation**

Do not commit at RED. Continue directly to the minimal implementation so the
repository is not left with a knowingly failing commit.

### Task 2: Unified Source Preprocessing

**Files:**
- Modify: `pj_comfyui/download_comfyui_model.py:14-23`
- Modify: `pj_comfyui/download_comfyui_model.py:112-142`
- Test: `pj_comfyui/tests/test_download_comfyui_model.py`

- [x] **Step 1: Add the minimal wrapper extractor**

Add `re` and `parse_qs` imports, then implement:

```python
SOURCE_WRAPPER_CHARS = " \t\r\n`'\"\u2018\u2019\u201c\u201d"
MARKDOWN_LINK_RE = re.compile(r"^\[[^\]]*\]\(\s*<?(.+?)>?\s*\)$")
HF_URL_RE = re.compile(
    r"https?://(?:www\.)?huggingface\.co/[^\s<>\]\)]+",
    re.IGNORECASE,
)


def extract_hf_url(source: str) -> str:
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
```

- [x] **Step 2: Extend `parse_hf_url()` for `tree`**

Call `extract_hf_url()` before `urlparse()`. Extend marker recognition to
`{"blob", "resolve", "tree"}` and preserve the current `blob`/`resolve`
branch. For `tree`, require exactly one non-empty `text` parameter in the
`:~:` fragment, reject path separators and the complete basenames `.` or `..`,
and join the basename to any directory components after the revision. Replace
the parser with:

```python
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

    return HfTarget(repo_id=repo_id, filename=filename, revision=revision)
```

Update parser docstrings and CLI help from “blob or resolve” to “blob, resolve,
or tree text-fragment”.

- [x] **Step 3: Run unit tests and verify GREEN**

Run:

```bash
python3 -m unittest discover -s pj_comfyui/tests -v
```

Expected: every parser test passes with no warnings or errors.

- [x] **Step 4: Commit parser and tests**

```bash
git add pj_comfyui/download_comfyui_model.py pj_comfyui/tests/test_download_comfyui_model.py
git commit -m "feat: normalize Hugging Face tree model links"
```

### Task 3: Documentation And Full Verification

**Files:**
- Modify: `pj_comfyui/download_comfyui_model.md`

- [x] **Step 1: Update the usage document**

Document all three accepted URL shapes, wrapper support, the FLUX conversion,
and the required explicit model type:

```bash
/app/pj_comfyui/download_comfyui_model.py \
  'https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev/tree/main#:~:text=flux1%2Dkontext%2Ddev.safetensors' \
  --model-type diffusion_models \
  --dry-run
```

State that gated repositories still require accepted terms and `HF_TOKEN`.

- [x] **Step 2: Run full verification**

Run:

```bash
python3 -m unittest discover -s pj_comfyui/tests -v
python3 -m py_compile pj_comfyui/download_comfyui_model.py
bash -n pj_comfyui/install_comfyui.sh pj_comfyui/start_comfyui.sh
pj_comfyui/download_comfyui_model.py \
  'https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev/tree/main#:~:text=flux1%2Dkontext%2Ddev.safetensors' \
  --model-type diffusion_models \
  --dry-run
```

Expected: all tests pass; syntax checks exit zero; CLI prints the canonical
`resolve` URL and performs no download.

- [x] **Step 3: Commit documentation and plan**

```bash
git add pj_comfyui/download_comfyui_model.md docs/superpowers/plans/2026-07-29-hugging-face-tree-url.md
git commit -m "docs: explain Hugging Face tree link downloads"
```
