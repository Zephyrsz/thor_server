# Hugging Face Tree URL Preprocessing Design

## Goal

Extend `pj_comfyui/download_comfyui_model.py` so Hugging Face `tree` page
links with a browser text fragment are accepted alongside existing `blob` and
`resolve` file links. Every accepted input is normalized to a canonical
`resolve` download URL before the existing download flow continues.

## Accepted Inputs

Each command-line input item contains one Hugging Face URL in any of these
wrappers. Existing support for passing multiple input items remains unchanged:

- A raw URL.
- A Markdown link such as `[model](https://huggingface.co/...)`.
- Backticks, ASCII quotes, Chinese curly quotes, or combinations of those
  wrappers around either form.

After wrapper removal, the URL must use `huggingface.co` or
`www.huggingface.co` and match one of these forms:

```text
/{repo_id}/blob/{revision}/{filename}
/{repo_id}/resolve/{revision}/{filename}
/{repo_id}/tree/{revision}[/{directory}]#:~:text={filename}
```

For a `tree` URL, the text fragment supplies the file basename. Any directory
after the revision is prepended to that basename.

## Normalization

All supported forms are parsed into the existing `HfTarget` structure:

```text
HfTarget(repo_id, revision, filename)
```

The existing `resolve_url()` function then produces:

```text
https://huggingface.co/{repo_id}/resolve/{revision}/{filename}
```

For example:

```text
https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev/tree/main#:~:text=flux1%2Dkontext%2Ddev.safetensors
```

becomes:

```text
https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev/resolve/main/flux1-kontext-dev.safetensors
```

The normalized URL is always printed as `Resolve URL`. The URL-based `aria2`
backend consumes it directly; the default `hf` backend consumes the same
parsed `HfTarget`. Authentication, resume behavior, overwrite behavior, and
destination handling remain unchanged.

## ComfyUI Destination

Model type inference remains unchanged. If the resulting filename does not
contain a recognized ComfyUI model directory, the caller must pass an explicit
model type:

```bash
./download_comfyui_model.py \
  'https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev/tree/main#:~:text=flux1%2Dkontext%2Ddev.safetensors' \
  --model-type diffusion_models
```

The script must not guess a destination from repository or model names.

## Validation And Errors

The preprocessor returns a clear `ValueError` when:

- No Hugging Face URL can be extracted.
- The URL uses an unsupported Hugging Face page shape.
- A `tree` URL has no `:~:text=` filename directive.
- A `tree` URL has an empty or invalid filename.
- More than one text-fragment filename candidate is present.

Existing validation for repository, revision, filename, model type, and host
continues to apply. Gated repositories still require a Hugging Face token and
accepted repository terms.

## Tests

Standard-library unit tests will cover:

- Raw `tree` URL normalization.
- Markdown-wrapped and quote-wrapped `tree` URLs.
- Percent-decoded filenames.
- A `tree` URL pointing at a repository subdirectory.
- Existing `blob` and `resolve` behavior.
- Missing, empty, and multiple text-fragment filenames.
- Rejection of non-Hugging Face and unsupported URLs.
- The CLI `--dry-run` output for the FLUX example with an explicit model type.

The existing usage document will be updated with the new accepted forms,
conversion example, and `--model-type` requirement.

## Out Of Scope

- Guessing a filename without a text fragment.
- Searching the Hugging Face API for ambiguous filenames.
- Inferring a ComfyUI model type from repository names.
- Changing download backends or authentication behavior.
- Uploading the local change back to the remote server.
