---
title: CLI Reference
description: Complete reference for all LiteParse CLI commands and options.
sidebar:
  order: 5
---

LiteParse provides the `lit` CLI with document parsing commands and advanced OCR tooling.

## `lit parse`

Parse a single document.

```
lit parse [options] <file>
```

### Arguments

| Argument | Description |
|----------|-------------|
| `file` | Path to the document file, or `-` to read from stdin |

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-o, --output <file>` | Write output to a file instead of stdout | — |
| `--format <format>` | Output format: `json` or `text` | `text` |
| `--ocr-server-url <url>` | HTTP OCR server URL | — (uses Tesseract) |
| `--no-ocr` | Disable OCR entirely | — |
| `--ocr-language <lang>` | OCR language code | `en` |
| `--num-workers <n>` | Pages to OCR in parallel | CPU cores - 1 |
| `--max-pages <n>` | Maximum pages to parse | `10000` |
| `--target-pages <pages>` | Pages to parse (e.g., `"1-5,10"`) | — (all pages) |
| `--dpi <dpi>` | Rendering DPI | `150` |
| `--no-precise-bbox` | **Deprecated:** Disable populating the output boundingBoxes array. Will be removed in v2.0. Text item coordinates (`x`, `y`, `width`, `height`) are always present regardless. | — |
| `--preserve-small-text` | Keep very small text | — |
| `--password <password>` | Password for encrypted/protected documents | — |
| `--config <file>` | JSON config file path | — |
| `-q, --quiet` | Suppress progress output | — |

### Examples

```bash
# Basic text parsing
lit parse report.pdf

# JSON output with bounding boxes
lit parse report.pdf --format json -o report.json

# Parse pages 1-5 only, no OCR
lit parse report.pdf --target-pages "1-5" --no-ocr

# High-DPI rendering with French OCR
lit parse report.pdf --dpi 300 --ocr-language fra

# Use an external OCR server
lit parse report.pdf --ocr-server-url http://localhost:8828/ocr

# Pipe output to another tool
lit parse report.pdf -q | wc -l

# Parse a remote file via stdin
curl -sL https://example.com/report.pdf | lit parse --no-ocr -
```

---

## `lit batch-parse`

Parse multiple documents in a directory.

```
lit batch-parse [options] <input-dir> <output-dir>
```

### Arguments

| Argument | Description |
|----------|-------------|
| `input-dir` | Directory containing documents to parse |
| `output-dir` | Directory for output files |

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--format <format>` | Output format: `json` or `text` | `text` |
| `--ocr-server-url <url>` | HTTP OCR server URL | — (uses Tesseract) |
| `--no-ocr` | Disable OCR entirely | — |
| `--ocr-language <lang>` | OCR language code | `en` |
| `--num-workers <n>` | Pages to OCR in parallel | CPU cores - 1 |
| `--max-pages <n>` | Maximum pages per file | `10000` |
| `--dpi <dpi>` | Rendering DPI | `150` |
| `--no-precise-bbox` | **Deprecated:** Disable populating the output boundingBoxes array. Will be removed in v2.0. Text item coordinates (`x`, `y`, `width`, `height`) are always present regardless. | — |
| `--recursive` | Search subdirectories | — |
| `--extension <ext>` | Only process this extension (e.g., `".pdf"`) | — (all supported) |
| `--password <password>` | Password for encrypted/protected documents (applied to all files) | — |
| `--config <file>` | JSON config file path | — |
| `-q, --quiet` | Suppress progress output | — |

### Examples

```bash
# Parse all supported files in a directory
lit batch-parse ./documents ./output

# Recursively parse only PDFs
lit batch-parse ./documents ./output --recursive --extension ".pdf"

# Batch parse with JSON output and no OCR
lit batch-parse ./documents ./output --format json --no-ocr

# Use a config file for consistent settings
lit batch-parse ./documents ./output --config liteparse.config.json
```

---

## `lit screenshot`

Generate page images from a PDF.

```
lit screenshot [options] <file>
```

### Arguments

| Argument | Description |
|----------|-------------|
| `file` | Path to the PDF file |

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-o, --output-dir <dir>` | Output directory | `./screenshots` |
| `--target-pages <pages>` | Pages to screenshot (e.g., `"1,3,5"` or `"1-5"`) | — (all pages) |
| `--dpi <dpi>` | Rendering DPI | `150` |
| `--format <format>` | Image format: `png` or `jpg` | `png` |
| `--password <password>` | Password for encrypted/protected documents | — |
| `--config <file>` | JSON config file path | — |
| `-q, --quiet` | Suppress progress output | — |

### Examples

```bash
# Screenshot all pages
lit screenshot document.pdf -o ./pages

# First 5 pages at high DPI
lit screenshot document.pdf --pages "1-5" --dpi 300 -o ./pages

# JPG format for smaller files
lit screenshot document.pdf --format jpg -o ./pages

# Specific pages only
lit screenshot document.pdf --pages "1,5,10" -o ./pages
```

---

## Global options

These options are available on all commands:

| Option | Description |
|--------|-------------|
| `-h, --help` | Show help for a command |
| `-V, --version` | Show version number |

---

## `lit lmstudio-ocr`

Run a single image directly through LM Studio `glm-ocr`.

```
lit lmstudio-ocr [options] <image>
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-o, --output <file>` | Write normalized artifact JSON to a file | — |
| `--raw-output <file>` | Write the raw LM Studio response JSON | — |
| `--mode <mode>` | `auto`, `text`, `layout`, `table`, `formula`, or `diagram` | `auto` |
| `--api-mode <mode>` | `lmstudio-native` or `openai` | `lmstudio-native` |
| `--base-url <url>` | LM Studio base URL | `http://localhost:1234` |
| `--model <model>` | LM Studio model identifier | `glm-ocr-g32-mixed_4_8-mlx` |
| `--no-auto-load` | Disable automatic `lms load` | — |
| `--json` | Print normalized artifact JSON | — |
| `--strict-bbox` | Drop OCR regions without boxes | — |

Direct mode is a lightweight OCR/model smoke-test path. It may use fallback line boxes when model output has no reliable `bbox_2d`; use `glmocr-ocr-server` for official GLM-OCR SDK layout boxes.

## `lit codex-ocr`

Run a single image through OpenAI Codex multimodal OCR.

```
lit codex-ocr [options] <image>
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-o, --output <file>` | Write normalized Codex OCR artifact JSON to a file | — |
| `--raw-output <file>` | Write the raw Codex SDK/app-server response JSON | — |
| `--backend <backend>` | `sdk` or `app-server` | `sdk` |
| `--codex-home <dir>` | Codex state directory; live dev tests use `$HOME/.codex-test` | — |
| `--codex-path <path>` | Path to the `codex` CLI binary | — |
| `--model <model>` | Codex model | `gpt-5.5` |
| `--reasoning-effort <effort>` | `minimal`, `low`, `medium`, `high`, or `xhigh` | `medium` |
| `--page-number <n>` | Page number metadata | `1` |
| `--json` | Print normalized artifact JSON | — |
| `--include-raw` | Include raw Codex response in artifact output | — |
| `--strict-bbox` | Drop OCR regions without boxes | — |

Use `--model gpt-5.4-mini` for cheaper smoke tests and `--model gpt-5.5` for higher-quality document understanding.

## `lit codex-ocr-server`

Start a LiteParse-compatible HTTP OCR server backed by OpenAI Codex.

```
lit codex-ocr-server [options]
```

The server listens on `http://127.0.0.1:8833/ocr` by default and implements the same multipart `/ocr` contract as other LiteParse OCR servers. `POST /ocr/analyze` returns the full advanced artifact with page Markdown, page metadata, layout regions, segmented assets, annotations, conversion results, model metadata, and provenance.

Important options:

| Option | Description | Default |
|--------|-------------|---------|
| `--host <host>` | Server host | `127.0.0.1` |
| `--port <port>` | Server port | `8833` |
| `--backend <backend>` | `sdk` or `app-server` | `sdk` |
| `--codex-home <dir>` | Codex state directory | — |
| `--model <model>` | Codex model | `gpt-5.5` |
| `--reasoning-effort <effort>` | Codex model reasoning effort | `medium` |
| `--concurrency <n>` | Maximum concurrent OCR requests | `1` |
| `--strict-bbox` | Drop OCR regions without boxes | — |

## `lit codex-ocr-pipeline`

Render documents or collect images, run Codex OCR per page, and write agent-friendly artifacts.

```
lit codex-ocr-pipeline -p <path> -o <output-dir> [options]
```

Examples:

```bash
lit codex-ocr-pipeline \
  --path document.pdf \
  --output ./codex-ocr-output \
  --target-pages "1-3" \
  --codex-home "$HOME/.codex-test" \
  --json
```

Output includes page PNGs, Codex artifacts, LiteParse `/ocr` result JSON, segmented asset JSON, annotation JSON, and final Markdown/JSON. The final Markdown includes a LiteParse structured OCR context section that promotes page metadata, selected layout regions, and segmented asset details so downstream QA can use facts that were captured outside the main page Markdown.

## `lit glmocr-ocr-server`

Start a LiteParse-compatible HTTP OCR server backed by the official GLM-OCR SDK self-hosted pipeline.

```
lit glmocr-ocr-server [options]
```

The server listens on `http://127.0.0.1:8831/ocr` by default and implements the same multipart `/ocr` contract as other LiteParse OCR servers. Layout boxes come from GLM-OCR SDK PP-DocLayout `bbox_2d` and are converted to pixel bboxes.

Important options:

| Option | Description | Default |
|--------|-------------|---------|
| `--port <port>` | LiteParse OCR server port | `8831` |
| `--glmocr-root <path>` | Optional GLM-OCR source checkout root. If omitted, LiteParse uses an importable `glmocr`, `LITEPARSE_GLMOCR_ROOT`, or `/opt/glm-ocr-sdk`. | — |
| `--model-runtime <runtime>` | `lmstudio`, `openai-compatible`, `ollama`, or `external` | `lmstudio` |
| `--base-url <url>` | LM Studio base URL | `http://localhost:1234` |
| `--model <model>` | GLM-OCR model identifier | `glm-ocr-g32-mixed_4_8-mlx` |
| `--lmstudio-api-mode <mode>` | `auto`, `openai`, or `native-adapter` | `auto` |
| `--ocr-api-url <url>` | External model runtime URL | — |
| `--layout-device <device>` | `cpu`, `cuda`, or `cuda:N` | `cpu` |
| `--layout-model-dir <path>` | PP-DocLayout model directory or Hub identifier. Docker uses `/opt/models/pp-doclayout`. | `PaddlePaddle/PP-DocLayoutV3_safetensors` |
| `--no-auto-load` | Disable automatic `lms load` | — |

## `lit glmocr-pipeline`

Render documents or collect images, run the GLM-OCR SDK layout pipeline per page, and write agent-friendly artifacts.

```
lit glmocr-pipeline -p <path> -o <output-dir> [options]
```

Examples:

```bash
lit glmocr-pipeline \
  --path document.pdf \
  --output ./glmocr-output \
  --target-pages "1-3" \
  --layout-device cpu \
  --json
```

Output includes page images, raw GLM-OCR SDK artifacts, LiteParse `/ocr` result JSON, and final Markdown/JSON.

## `lit lmstudio-ocr-server`

Start a LiteParse-compatible HTTP OCR server backed by LM Studio GLM-OCR.

```
lit lmstudio-ocr-server [options]
```

The server implements the standard LiteParse OCR API:

```bash
curl -X POST http://127.0.0.1:8830/ocr \
  -F "file=@page.png" \
  -F "language=en"
```

It returns:

```json
{
  "results": [
    { "text": "recognized text", "bbox": [0, 0, 100, 20], "confidence": 1 }
  ]
}
```

Important options:

| Option | Description | Default |
|--------|-------------|---------|
| `--host <host>` | Server host | `127.0.0.1` |
| `--port <port>` | Server port | `8830` |
| `--base-url <url>` | LM Studio base URL | `http://localhost:1234` |
| `--model <model>` | LM Studio model identifier | `glm-ocr-g32-mixed_4_8-mlx` |
| `--no-auto-load` | Disable automatic `lms load` | — |
| `--concurrency <n>` | Maximum concurrent OCR requests | `1` |
| `--strict-bbox` | Drop OCR regions without boxes | — |

## `lit lmstudio-ocr-pipeline`

Render documents or collect images, run GLM-OCR per page, and write agent-friendly artifacts.

```
lit lmstudio-ocr-pipeline -p <path> -o <output-dir> [options]
```

Examples:

```bash
lit lmstudio-ocr-pipeline \
  --path document.pdf \
  --output ./glm-ocr-output \
  --mode auto \
  --target-pages "1-3"
```

Output includes page images, raw LM Studio responses, normalized OCR artifacts, LiteParse `/ocr` result JSON, and final Markdown/JSON.
