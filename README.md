# LiteParse OCR vLLM

[![npm version](https://img.shields.io/npm/v/@arthur/liteparse-vllm.svg)](https://www.npmjs.com/package/@arthur/liteparse-vllm)
|
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
|
[Upstream Docs](https://developers.llamaindex.ai/liteparse/)

This repository is an independent custom OCR fork of upstream [run-llama/liteparse](https://github.com/run-llama/liteparse). The upstream project remains the base LiteParse implementation and source reference; this repo carries local custom work for GLM-OCR, vLLM offline packaging, LM Studio diagnostics, Codex OCR diagnostics, agent skills, and release packaging under a separate package name.

Repository identity:

- Fork repo: `https://github.com/lwyBZss8924d/liteparse-ocr-vllm.git`
- Upstream repo: `https://github.com/run-llama/liteparse.git`
- Custom branch: `custom/vllm-ocr-main`
- Upstream mirror branch: `main`
- npm package: `@arthur/liteparse-vllm`
- Current custom version: `1.5.3-custom.0`, based on upstream `v1.5.3`

Do not publish custom OCR releases from `main`. Keep upstream syncs on `main`, merge them into `custom/vllm-ocr-main`, and publish this fork from the custom branch with custom tags such as `custom-v1.5.3-ocr.0`.

## Overview

LiteParse OCR vLLM keeps LiteParse's local-first parser and standard OCR HTTP contract, then adds custom advanced OCR packaging for local VLM workflows.

- **Fast Text Parsing**: Spatial text parsing using PDF.js
- **Flexible OCR System**:
  - **Built-in**: Tesseract.js for the zero-setup local path
  - **Baseline HTTP Servers**: EasyOCR, PaddleOCR, or any custom `/ocr` service
  - **GLM-OCR SDK Pipeline**: PP-DocLayout-backed layout boxes normalized into LiteParse OCR results
  - **vLLM Offline Image**: GPU Docker image tar target for air-gapped GLM-OCR delivery
  - **LM Studio Direct Diagnostics**: lightweight local model smoke tests with degraded fallback boxes
  - **Codex OCR Diagnostics**: online/authenticated multimodal page-understanding artifacts
  - **Standard API**: unchanged multipart `POST /ocr` contract with `results[].text`, `results[].bbox`, and `results[].confidence`
- **Screenshot Generation**: Generate high-quality page screenshots for LLM agents
- **Multiple Output Formats**: JSON and Text
- **Bounding Boxes**: Precise text positioning information
- **Standalone CLI**: Baseline parsing runs locally; Codex OCR remains online/authenticated only
- **Multi-platform**: Linux, macOS (Intel/ARM), Windows

## Installation

### CLI Tool

#### Option 1: Global Install (Recommended)

Install globally via npm to use the `lit` command anywhere:

```bash
npm i -g @arthur/liteparse-vllm
```

Then use it:

```bash
lit parse document.pdf
lit screenshot document.pdf
```

For macOS and Linux users who want the upstream package instead of this custom OCR fork, `liteparse` can also be installed via `brew`:

```bash
brew tap run-llama/liteparse
brew install llamaindex-liteparse
```

#### Option 2: Install from Source

You can clone the repo and install the CLI globally from source:

```
git clone https://github.com/lwyBZss8924d/liteparse-ocr-vllm.git
cd liteparse-ocr-vllm
git switch custom/vllm-ocr-main
npm run build
npm pack
npm install -g ./arthur-liteparse-vllm-*.tgz
```

For a release-grade offline npm tarball, build on Linux x64 so native runtime dependencies match the target host:

```bash
npm ci --omit=dev
npm run build
npm pack --dry-run --json
npm pack
```

### Agent Skill

This fork keeps its custom agent skill source in the repository so OCR commands, package names, and vLLM/GLM-OCR workflows stay aligned with this custom build:

```bash
skills/liteparse-cli-tools-custom-collection/
```

Use `npm run validate:agent-skills` before publishing changes, then `npm run sync:agent-skills:dry-run` and `npm run sync:agent-skills` to refresh the installed runtime projection under `/Users/arthur/.agents/skills/liteparse-cli-tools-custom-collection`. Do not edit the installed projection directly.

## Usage

### Parse Files

```bash
# Basic parsing
lit parse document.pdf

# Parse with specific format
lit parse document.pdf --format json -o output.md

# Parse specific pages
lit parse document.pdf --target-pages "1-5,10,15-20"

# Parse without OCR
lit parse document.pdf --no-ocr

# Parse a remote PDF
curl -sL https://example.com/report.pdf | lit parse -

# Parse with official GLM-OCR SDK layout pipeline as a LiteParse OCR server
lit glmocr-ocr-server
lit parse document.pdf --ocr-server-url http://127.0.0.1:8831/ocr --format json

# Parse with Codex OCR server for multimodal page understanding
lit codex-ocr-server --codex-home "$HOME/.codex-test"
lit parse document.pdf --ocr-server-url http://127.0.0.1:8833/ocr --format json
```

### Batch Parsing

You can also parse an entire directory of documents:

```bash
lit batch-parse ./input-directory ./output-directory
```

### Generate Screenshots

Screenshots are essential for LLM agents to extract visual information that text alone cannot capture.

```bash
# Screenshot all pages
lit screenshot document.pdf -o ./screenshots

# Screenshot specific pages
lit screenshot document.pdf --target-pages "1,3,5" -o ./screenshots

# Custom DPI
lit screenshot document.pdf --dpi 300 -o ./screenshots

# Screenshot page range
lit screenshot document.pdf --target-pages "1-10" -o ./screenshots
```

### Library Usage

Install as a dependency in your project:

```bash
npm install @arthur/liteparse-vllm
# or
pnpm add @arthur/liteparse-vllm
```

```typescript
import { LiteParse } from '@arthur/liteparse-vllm';

const parser = new LiteParse({ ocrEnabled: true });
const result = await parser.parse('document.pdf');
console.log(result.text);
```

#### Buffer / Uint8Array Input

You can pass raw bytes directly instead of a file path, which is useful for remote files:

```typescript
import { LiteParse } from '@arthur/liteparse-vllm';
import { readFile } from 'fs/promises';

const parser = new LiteParse();

// From a file read
const pdfBytes = await readFile('document.pdf');
const result = await parser.parse(pdfBytes);

// From an HTTP response
const response = await fetch('https://example.com/document.pdf');
const buffer = Buffer.from(await response.arrayBuffer());
const result2 = await parser.parse(buffer);
```

Non-PDF buffers (images, Office documents) are written to a temp directory for format conversion. Screenshots also work with buffer input:

```typescript
const screenshots = await parser.screenshot(pdfBytes, [1, 2, 3]);
```

### Browser Usage

LiteParse's core parsing engine (PDF.js text extraction, grid projection, OCR via Tesseract.js) can run in the browser. Since the library has Node-only dependencies (sharp, fs, child_process), you'll need a bundler like Vite to swap those out with browser stubs.

#### Vite Configuration

The key is a Vite plugin that redirects Node-only source files to browser-safe replacements, plus `resolve.alias` entries that stub out Node built-in modules:

```typescript
// vite.config.ts
import { defineConfig, type Plugin } from "vite";
import { resolve, dirname } from "node:path";

// Node-only files → browser stubs (you write these)
const FILE_REDIRECTS = [
  { match: /\/engines\/pdf\/pdfium-renderer(\.js|\.ts)?$/, target: "stubs/pdfium-renderer.ts" },
  { match: /\/engines\/pdf\/pdfjsImporter(\.js|\.ts)?$/,   target: "stubs/pdfjsImporter.ts" },
  { match: /\/engines\/ocr\/http-simple(\.js|\.ts)?$/,     target: "stubs/http-simple.ts" },
  { match: /\/conversion\/convertToPdf(\.js|\.ts)?$/,      target: "stubs/convertToPdf.ts" },
  { match: /\/processing\/gridDebugLogger(\.js|\.ts)?$/,   target: "stubs/gridDebugLogger.ts" },
  { match: /\/processing\/gridVisualizer(\.js|\.ts)?$/,    target: "stubs/gridVisualizer.ts" },
];

function liteparseNodeRedirects(): Plugin {
  return {
    name: "liteparse-node-redirects",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!importer) return null;
      const abs = source.startsWith(".") ? resolve(dirname(importer), source) : source;
      for (const { match, target } of FILE_REDIRECTS) {
        if (match.test(abs) || match.test(source)) return resolve(target);
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [liteparseNodeRedirects()],
  optimizeDeps: { include: ["tesseract.js"] },
  resolve: {
    alias: [
      { find: "node:fs/promises", replacement: "stubs/empty.ts" },
      { find: "node:fs",          replacement: "stubs/empty.ts" },
      { find: "node:url",         replacement: "stubs/empty.ts" },
      { find: "node:path",        replacement: "stubs/empty.ts" },
      { find: "node:os",          replacement: "stubs/empty.ts" },
      { find: "node:child_process", replacement: "stubs/empty.ts" },
      { find: /^fs$/,             replacement: "stubs/empty.ts" },
      { find: /^path$/,           replacement: "stubs/empty.ts" },
      { find: /^os$/,             replacement: "stubs/empty.ts" },
      { find: /^child_process$/,  replacement: "stubs/empty.ts" },
      { find: "form-data",        replacement: "stubs/empty.ts" },
      { find: "axios",            replacement: "stubs/empty.ts" },
      { find: "file-type",        replacement: "stubs/file-type.ts" },
    ],
  },
});
```

See [`scripts/browser-compat/`](scripts/browser-compat/) for a complete working example with all the stub files.

#### What works in the browser

- PDF parsing from `Uint8Array` input (use `file.arrayBuffer()` to get bytes from a `<input type="file">`)
- OCR via Tesseract.js (runs in Web Workers, fetches language data from CDN on first use)
- Text and JSON output formats

#### What doesn't work

- File path input (pass `Uint8Array` instead)
- DOCX/XLSX/PPTX/image conversion (requires LibreOffice/ImageMagick)
- HTTP OCR server backend
- Screenshots (these use PDFium + sharp, which are native Node addons)

### CLI Options

#### Parse Command

```
$ lit parse --help
Usage: lit parse [options] <file>

Parse a document file (PDF, DOCX, XLSX, PPTX, images, etc.)

Options:
  -o, --output <file>     Output file path
  --format <format>       Output format: json|text (default: "text")
  --ocr-server-url <url>  HTTP OCR server URL (uses Tesseract if not provided)
  --no-ocr                Disable OCR
  --ocr-language <lang>   OCR language(s) (default: "en")
  --num-workers <n>       Number of pages to OCR in parallel (default: CPU cores - 1)
  --max-pages <n>         Max pages to parse (default: "10000")
  --target-pages <pages>  Target pages (e.g., "1-5,10,15-20")
  --dpi <dpi>             DPI for rendering (default: "150")
  --no-precise-bbox       Disable precise bounding boxes
  --preserve-small-text   Preserve very small text
  --password <password>   Password for encrypted/protected documents
  --config <file>         Config file (JSON)
  -q, --quiet             Suppress progress output
  -h, --help              display help for command
```

#### Batch Parse Command

```
$ lit batch-parse --help
Usage: lit batch-parse [options] <input-dir> <output-dir>

Parse multiple documents in batch mode (reuses PDF engine for efficiency)

Options:
  --format <format>       Output format: json|text (default: "text")
  --ocr-server-url <url>  HTTP OCR server URL (uses Tesseract if not provided)
  --no-ocr                Disable OCR
  --ocr-language <lang>   OCR language(s) (default: "en")
  --num-workers <n>       Number of pages to OCR in parallel (default: CPU cores - 1)
  --max-pages <n>         Max pages to parse per file (default: "10000")
  --dpi <dpi>             DPI for rendering (default: "150")
  --no-precise-bbox       Disable precise bounding boxes
  --recursive             Recursively search input directory
  --extension <ext>       Only process files with this extension (e.g., ".pdf")
  --password <password>   Password for encrypted/protected documents (applied to all files)
  --config <file>         Config file (JSON)
  -q, --quiet             Suppress progress output
  -h, --help              display help for command
```

#### Screenshot Command

```
$ lit screenshot --help
Usage: lit screenshot [options] <file>

Generate screenshots of PDF pages

Options:
  -o, --output-dir <dir>  Output directory for screenshots (default: "./screenshots")
  --target-pages <pages>  Page numbers to screenshot (e.g., "1,3,5" or "1-5")
  --dpi <dpi>             DPI for rendering (default: "150")
  --format <format>       Image format: png|jpg (default: "png")
  --password <password>   Password for encrypted/protected documents
  --config <file>         Config file (JSON)
  -q, --quiet             Suppress progress output
  -h, --help              display help for command
```

## OCR Setup

### Default: Tesseract.js

```bash
# Tesseract is enabled by default
lit parse document.pdf

# Specify language
lit parse document.pdf --ocr-language fra

# Disable OCR
lit parse document.pdf --no-ocr
```

By default, Tesseract.js downloads language data from the internet on first use. For offline or air-gapped environments, set the `TESSDATA_PREFIX` environment variable to a directory containing pre-downloaded `.traineddata` files:

```bash
export TESSDATA_PREFIX=/path/to/tessdata
lit parse document.pdf --ocr-language eng
```

You can also pass `tessdataPath` in the library config:

```typescript
const parser = new LiteParse({ tessdataPath: '/path/to/tessdata' });
```

### Optional: HTTP OCR Servers

For higher accuracy or better performance, you can use an HTTP OCR server. We provide ready-to-use example wrappers for popular OCR engines:

- [EasyOCR](ocr/easyocr/README.md)
- [PaddleOCR](ocr/paddleocr/README.md)
- [GLM-OCR SDK Pipeline](ocr/glmocr/README.md)
- [LM Studio GLM-OCR direct wrapper](ocr/lmstudio/README.md)
- Codex OCR CLI/server (`lit codex-ocr-server`)

You can integrate any OCR service by implementing the simple LiteParse OCR API specification (see [`OCR_API_SPEC.md`](OCR_API_SPEC.md)).

The API requires:
- POST `/ocr` endpoint
- Accepts `file` and `language` parameters
- Returns JSON: `{ results: [{ text, bbox: [x1,y1,x2,y2], confidence }] }`

See the example servers in `ocr/easyocr/` and `ocr/paddleocr/` as templates.

For the complete OCR API specification, see [`OCR_API_SPEC.md`](OCR_API_SPEC.md).

### Optional: GLM-OCR SDK Pipeline

For layout/table/formula-heavy documents, LiteParse can expose the official GLM-OCR SDK self-hosted pipeline as a Custom HTTP OCR server. This path uses PP-DocLayout for layout boxes, then calls a model runtime such as LM Studio for crop OCR:

```bash
# Python service path, matching the EasyOCR/PaddleOCR adapter style:
cd ocr/glmocr
uv run server.py

# Or Node-managed wrapper:
# Starts http://127.0.0.1:8831/ocr
# If the model is installed but not loaded, this runs:
# lms load glm-ocr-g32-mixed_4_8-mlx --identifier glm-ocr-g32-mixed_4_8-mlx -y
lit glmocr-ocr-server

lit parse document.pdf \
  --ocr-server-url http://127.0.0.1:8831/ocr \
  --format json
```

Advanced document-pipeline tooling writes page images, raw GLM-OCR SDK artifacts, LiteParse `/ocr` result JSON, and final Markdown/JSON:

```bash
lit glmocr-pipeline \
  --path document.pdf \
  --output ./glmocr-output \
  --target-pages "1-3"
```

Use `--no-auto-load` when you want LiteParse to fail fast instead of calling `lms load`. Use `--model-runtime openai-compatible --ocr-api-url <url>` or `--model-runtime ollama --ocr-api-url <url>` when the GLM-OCR model is hosted outside LM Studio.

### Optional: Offline vLLM GLM-OCR Docker Image

The custom fork includes a vLLM-only GPU image target for air-gapped delivery. The image contains the LiteParse custom CLI, Node runtime dependencies, the pinned GLM-OCR SDK, vLLM runtime, `zai-org/GLM-OCR`, and `PaddlePaddle/PP-DocLayoutV3_safetensors`.

```bash
docker build -f Dockerfile.glmocr-offline \
  -t liteparse-glmocr-vllm-offline:1.5.3-custom.0 \
  --build-arg VLLM_BASE_IMAGE=vllm/vllm-openai@sha256:9eff9734a30b6713a8566217d36f8277630fd2d31cec7f0a0292835901a23aa4 \
  --build-arg GLM_OCR_SDK_REF=cef4d0ea120d1741f5cefe8985eee45f6c8eff1d \
  --build-arg GLM_OCR_MODEL_REVISION=cb34f33832c51008c86436a3b2217bbe4adbe0b8 \
  --build-arg PP_DOCLAYOUT_MODEL_REVISION=3ec586e86ed9245a567bb13395a3db64d5c077cc \
  .

docker save \
  -o liteparse-glmocr-vllm-offline-1.5.3-custom.0.tar \
  liteparse-glmocr-vllm-offline:1.5.3-custom.0
```

On the offline GPU host:

```bash
docker load -i liteparse-glmocr-vllm-offline-1.5.3-custom.0.tar

docker run --rm --gpus all --ipc=host --network=none \
  liteparse-glmocr-vllm-offline:1.5.3-custom.0 smoke

docker run --rm --gpus all --ipc=host -p 8831:8831 \
  liteparse-glmocr-vllm-offline:1.5.3-custom.0
```

The default profile starts `vllm serve /opt/models/glm-ocr` on port `8000`, waits for `/v1/models`, then starts `lit glmocr-ocr-server` on port `8831` with `--layout-model-dir /opt/models/pp-doclayout`. The image sets `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1` at runtime; build the image online once, then distribute the saved tar.

### Optional: LM Studio GLM-OCR Direct Wrapper

The legacy direct wrapper remains available for quick single-image or OCR/text smoke tests:

```bash
lit lmstudio-ocr page.png --mode text --json
lit lmstudio-ocr-server
```

Direct mode sends the page or crop straight to LM Studio and may produce fallback line boxes when the model output has no reliable `bbox_2d`. Use `glmocr-ocr-server` or `glmocr-pipeline` when official GLM-OCR layout bboxes are required.

### Optional: Codex OCR Server and Pipeline

For agentic multimodal OCR, LiteParse can expose OpenAI Codex as a Custom HTTP OCR server while preserving the standard `/ocr` response shape:

```bash
# Uses @openai/codex-sdk by default.
# Live development/test state should use $HOME/.codex-test.
lit codex-ocr-server --codex-home "$HOME/.codex-test"

lit parse document.pdf \
  --ocr-server-url http://127.0.0.1:8833/ocr \
  --format json
```

The Codex server also exposes `POST /ocr/analyze` for a full advanced artifact with page Markdown, page metadata, layout regions, segmented assets, annotations, conversion results, model metadata, and provenance. Use `--backend app-server` to try the experimental `codex app-server` JSON-RPC wrapper instead of the default SDK path.

Advanced document-pipeline tooling renders supported documents and images into page PNGs, runs Codex OCR per page, and writes page artifacts plus final Markdown/JSON:

```bash
lit codex-ocr-pipeline \
  --path document.pdf \
  --output ./codex-ocr-output \
  --target-pages "1-3" \
  --codex-home "$HOME/.codex-test"
```

The artifact tree includes `pages/`, `codex/`, `liteparse/`, `assets/<type>/`, `annotations/`, `final/document.md`, `final/document.json`, and `manifest.json`. Final Markdown includes a LiteParse structured OCR context section that promotes page metadata, selected layout regions, and segmented asset details for downstream QA. Codex bounding boxes are model-inferred visual localization evidence and include `codex_bboxes_are_model_inferred` warnings; use `--strict-bbox` to drop regions without usable boxes.

## Multi-Format Input Support

LiteParse supports **automatic conversion** of various document formats to PDF before parsing. This makes it unique compared to other PDF-only parsing tools!

### Supported Input Formats

#### Office Documents (via LibreOffice)
- **Word**: `.doc`, `.docx`, `.docm`, `.odt`, `.rtf`
- **PowerPoint**: `.ppt`, `.pptx`, `.pptm`, `.odp`
- **Spreadsheets**: `.xls`, `.xlsx`, `.xlsm`, `.ods`, `.csv`, `.tsv`

Just install the dependency and LiteParse will automatically convert these formats to PDF for parsing:

```bash
# macOS
brew install --cask libreoffice

# Ubuntu/Debian
apt-get install libreoffice

# Windows
choco install libreoffice-fresh # might require admin permissions
```

> _For Windows, you might need to add the path to the directory containing LibreOffice CLI executable (generally `C:\Program Files\LibreOffice\program`) to the environment variables and re-start the machine._

#### Images (via ImageMagick)
- **Formats**: `.jpg`, `.jpeg`, `.png`, `.gif`, `.bmp`, `.tiff`, `.webp`, `.svg`

Just install ImageMagick and LiteParse will convert images to PDF for parsing (with OCR):

```bash
# macOS
brew install imagemagick

# Ubuntu/Debian
apt-get install imagemagick

# Windows
choco install imagemagick.app # might require admin permissions
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TESSDATA_PREFIX` | Path to a directory containing Tesseract `.traineddata` files. Used for offline/air-gapped environments where Tesseract.js cannot download language data from the internet. |
| `LITEPARSE_TMPDIR` | Override the temp directory used for format conversion and intermediate files. Defaults to the OS temp directory (`os.tmpdir()`). Useful in containerized or read-only filesystem environments. |
| `LITEPARSE_LMSTUDIO_BASE_URL` | Base URL for LM Studio GLM-OCR tooling. Defaults to `http://localhost:1234`. |
| `LITEPARSE_GLM_OCR_MODEL` | LM Studio model identifier. Defaults to `glm-ocr-g32-mixed_4_8-mlx`. |
| `LITEPARSE_LMSTUDIO_API_KEY` | Optional bearer token for LM Studio-compatible deployments. |
| `LITEPARSE_LMSTUDIO_AUTO_LOAD` | Set to `0` or `false` to disable automatic `lms load` for local LM Studio models. |
| `LITEPARSE_GLMOCR_ROOT` | GLM-OCR SDK root used by `lit glmocr-ocr-server`. Docker defaults to `/opt/glm-ocr-sdk`; local installs may omit it when `glmocr` is importable. |
| `LITEPARSE_GLMOCR_LAYOUT_MODEL_DIR` | PP-DocLayout model directory or Hub identifier. Docker defaults to `/opt/models/pp-doclayout`. |
| `HF_HUB_OFFLINE` / `TRANSFORMERS_OFFLINE` | Set to `1` in the offline Docker image so Hugging Face and Transformers use only bundled model artifacts. |
| `LITEPARSE_CODEX_HOME` | Codex state directory for Codex OCR. Use `$HOME/.codex-test` for live development/testing so OAuth tokens and config remain separate from normal Codex state. |
| `LITEPARSE_CODEX_OCR_MODEL` | Default Codex OCR model. Defaults to `gpt-5.5`; use `gpt-5.4-mini` for cheaper smoke tests. |
| `LITEPARSE_CODEX_OCR_REASONING` | Default Codex OCR reasoning effort. Defaults to `medium`; the pipeline command defaults to `high`. |

## Configuration

You can configure parsing options via CLI flags or a JSON config file. The config file allows you to set sensible defaults and override as needed.

### Config File Example

Create a `liteparse.config.json` file:

```json
{
  "ocrLanguage": "en",
  "ocrEnabled": true,
  "maxPages": 1000,
  "dpi": 150,
  "outputFormat": "json",
  "preciseBoundingBox": true,
  "preserveVerySmallText": false,
  "password": "optional_password"
}
```

For HTTP OCR servers, just add `ocrServerUrl`:

```json
{
  "ocrServerUrl": "http://localhost:8828/ocr",
  "ocrLanguage": "en",
  "outputFormat": "json"
}
```

Use with:

```bash
lit parse document.pdf --config liteparse.config.json
```

## Development

We provide a fairly rich `AGENTS.md`/`CLAUDE.md` that we recommend using to help with development + coding agents.

```bash
# Install dependencies
npm install

# Build TypeScript (Linux/macOs)
npm run build

# Build Typescript (Windows)
npm run build:windows

# Watch mode
npm run dev

# Test parsing
npm test
```

## License

Apache 2.0

## Credits

Built on top of:

- [PDF.js](https://github.com/mozilla/pdf.js) - PDF parsing engine
- [Tesseract.js](https://github.com/naptha/tesseract.js) - In-process OCR engine
- [EasyOCR](https://github.com/JaidedAI/EasyOCR) - HTTP OCR server (optional)
- [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) - HTTP OCR server (optional)
- [Sharp](https://github.com/lovell/sharp) - Image processing
