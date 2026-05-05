# cli/

Command-line interface for LiteParse using Commander.js.

## Files

### parse.ts
**CLI entry point with document parsing commands and command registration.**

### lmstudio-ocr.ts
**LM Studio GLM-OCR CLI commands and advanced OCR pipeline tooling.**

### glmocr-ocr.ts
**Official GLM-OCR SDK pipeline server, pipeline artifacts, and LM Studio OpenAI adapter commands.**

### codex-ocr.ts
**OpenAI Codex OCR server and agentic page artifact pipeline commands.**

---

## Commands

### `lit parse <file>`

Parse documents and extract text.

---

### `lit screenshot <file> -o <output_dir>`

Generate page screenshots.

---

### `lit lmstudio-ocr <image>`

Run a single image through LM Studio `glm-ocr` and print or save the normalized artifact.

---

### `lit lmstudio-ocr-server`

Start a LiteParse-compatible Custom HTTP OCR server at `http://127.0.0.1:8830/ocr`.

This server follows `OCR_API_SPEC.md`: multipart `file`, optional `language`, and JSON `{ results: [{ text, bbox, confidence }] }`.

This direct server may use fallback line boxes when LM Studio output does not contain reliable `bbox_2d`. Use `lit glmocr-ocr-server` for official GLM-OCR SDK layout boxes.

---

### `lit lmstudio-ocr-pipeline -p <path> -o <output_dir>`

Render PDFs/documents or collect images, run GLM-OCR per page, and write page artifacts plus final Markdown/JSON outputs.

---

### `lit glmocr-ocr-server`

Start the official GLM-OCR SDK self-hosted layout pipeline as a LiteParse-compatible `/ocr` server at `http://127.0.0.1:8831/ocr`.

This server keeps the same `OCR_API_SPEC.md` contract but gets boxes from PP-DocLayout `bbox_2d` instead of direct model prompt output. LM Studio is the default model runtime and is auto-loaded with `lms load` unless `--no-auto-load` is passed.

Portable and Docker runs should pass `--glmocr-root` only when the SDK is not importable from Python. Use `--layout-model-dir` or `LITEPARSE_GLMOCR_LAYOUT_MODEL_DIR` to point PP-DocLayout at a pinned local model directory such as `/opt/models/pp-doclayout`.

Offline vLLM image entrypoint:

```bash
docker run --rm --gpus all --ipc=host -p 8831:8831 \
  liteparse-glmocr-vllm-offline:1.5.3-custom.0
```

---

### `lit glmocr-pipeline -p <path> -o <output_dir>`

Render PDFs/documents or collect images, run the GLM-OCR SDK pipeline per page, and write official GLM-OCR artifacts plus LiteParse `/ocr` JSON outputs.

---

### `lit lmstudio-openai-adapter`

Expose LM Studio native `/api/v1/chat` as an OpenAI-compatible `/v1/chat/completions` endpoint for GLM-OCR SDK `OCRClient` runtimes.

---

### `lit codex-ocr <image>`

Run a single image through OpenAI Codex multimodal OCR and print Markdown or save the normalized artifact.

---

### `lit codex-ocr-server`

Start a LiteParse-compatible Custom HTTP OCR server at `http://127.0.0.1:8833/ocr`.

This server follows `OCR_API_SPEC.md`: multipart `file`, optional `language`, and JSON `{ results: [{ text, bbox, confidence }] }`. It also exposes `POST /ocr/analyze` for the full Codex artifact with Markdown, page metadata, layout regions, segmented assets, annotations, and provenance.

The default backend is `@openai/codex-sdk`; `--backend app-server` enables the experimental `codex app-server` JSON-RPC wrapper. For live development and tests, pass `--codex-home "$HOME/.codex-test"` or set `LITEPARSE_CODEX_HOME`.

---

### `lit codex-ocr-pipeline -p <path> -o <output_dir>`

Render PDFs/documents or normalize images to page PNGs, run Codex OCR per page, and write page images, Codex artifacts, LiteParse `/ocr` result JSON, asset JSON, annotation JSON, and final Markdown/JSON. The final Markdown includes a LiteParse structured OCR context section that promotes page metadata, selected layout regions, and segmented asset details so downstream QA can use facts that were captured outside the main page Markdown.

---

## Configuration File

Parse and screenshot commands accept `--config <file>` to load settings from JSON:

```json
{
  "ocrEnabled": true,
  "ocrLanguage": "en",
  "ocrServerUrl": "http://localhost:5000/ocr",
  "maxPages": 100,
  "dpi": 200,
  "outputFormat": "json",
  "preciseBoundingBox": true,
  "password": "optional_password"
}
```

CLI options override config file values.

LM Studio commands also accept JSON config files and `--set key=value` overrides:

```json
{
  "baseUrl": "http://localhost:1234",
  "model": "glm-ocr-g32-mixed_4_8-mlx",
  "mode": "auto",
  "apiMode": "lmstudio-native",
  "autoLoadModel": true,
  "maxOutputTokens": 2048,
  "timeoutMs": 120000
}
```

Examples:

```bash
lit codex-ocr page.png --codex-home "$HOME/.codex-test" --model gpt-5.4-mini --json

lit codex-ocr-server --port 8833 --codex-home "$HOME/.codex-test"

lit codex-ocr-pipeline \
  --path document.pdf \
  --output ./codex-ocr-output \
  --target-pages "1-3" \
  --codex-home "$HOME/.codex-test"

lit glmocr-ocr-server --port 8831

lit glmocr-pipeline \
  --path document.pdf \
  --output ./glmocr-output \
  --target-pages "1-3"

lit lmstudio-ocr image.png --mode layout --json

lit lmstudio-ocr-server --port 8830

lit lmstudio-ocr-pipeline \
  --path document.pdf \
  --output ./glm-ocr-output \
  --mode auto \
  --target-pages "1-3"
```

---

## Adding CLI Options

1. Add `.option()` call in the command definition
2. Read option in action handler from `options` object
3. Add to config object that's passed to `LiteParse`
4. If new config field, update `src/core/types.ts` and `src/core/config.ts`
