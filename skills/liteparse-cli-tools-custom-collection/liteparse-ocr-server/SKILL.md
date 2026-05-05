---
name: liteparse-ocr-server
description: LiteParse OCR server integration guide. Use when the user wants to connect LiteParse to an HTTP OCR server, implement or validate the `/ocr` multipart API, choose `--ocr-server-url`, debug OCR response shape, or use EasyOCR, PaddleOCR, Tesseract, GLM-OCR SDK, Codex OCR, or a custom OCR backend with LiteParse.
---

# LiteParse OCR Server

Use this skill when LiteParse should call an external OCR server instead of only built-in Tesseract.js.

## Backend selection

- Built-in Tesseract.js: default zero-setup path. Use it for simple OCR, offline local runs, and cases where setup cost matters more than peak accuracy.
- EasyOCR HTTP server: use when documents need stronger general OCR quality or language coverage and a Python OCR service is acceptable.
- PaddleOCR HTTP server: use when table-like layouts, CJK text, or higher-performance OCR pipelines matter.
- GLM-OCR SDK pipeline server: use when local VLM-backed OCR, layout, table, formula, or diagram recognition matters and the user needs official PP-DocLayout `bbox_2d` converted into LiteParse `/ocr` boxes.
- LM Studio GLM-OCR direct server: use for quick model smoke tests, OCR/text extraction, or page/crop artifacts where fallback line boxes are acceptable.
- Codex OCR server: use when agentic multimodal page understanding matters and the user needs page Markdown, page metadata, layout regions, segmented assets, annotations, conversion metadata, model provenance, and LiteParse-compatible `/ocr` JSON from the same page image.
- Custom HTTP OCR server: use when the local LiteParse fork adds specialized layout, model, table, region, or confidence behavior that upstream engines do not expose.

Prefer native PDF text extraction with `--no-ocr` when the document already has reliable embedded text. Add OCR only for scanned pages, image-heavy PDFs, screenshots, or quality-sensitive extraction.

## CLI usage

```bash
liteparse parse document.pdf --ocr-server-url http://localhost:8080/ocr --format json
```

GLM-OCR SDK pipeline, official-style Python service:

```bash
cd /Users/arthur/dev-space/liteparse/ocr/glmocr
LITEPARSE_GLMOCR_OCR_API_URL=http://localhost:1234/v1/chat/completions \
LITEPARSE_GLMOCR_MODEL=glm-ocr-g32-mixed_4_8-mlx \
LITEPARSE_GLMOCR_LAYOUT_DEVICE=cpu \
uv run server.py
```

If the LM Studio OpenAI-compatible endpoint is unavailable, use the LiteParse adapter:

```bash
lit lmstudio-openai-adapter --port 8832
cd /Users/arthur/dev-space/liteparse/ocr/glmocr
LITEPARSE_GLMOCR_OCR_API_URL=http://127.0.0.1:8832/v1/chat/completions \
uv run server.py
```

GLM-OCR SDK pipeline, Node-managed wrapper:

```bash
lit glmocr-ocr-server --port 8831
liteparse parse document.pdf --ocr-server-url http://127.0.0.1:8831/ocr --format json
```

The GLM-OCR SDK pipeline uses PP-DocLayout for layout bboxes, then calls a GLM-OCR model runtime. LM Studio is the default model runtime and auto-runs `lms load <model> --identifier <model> -y` for installed local models unless `--no-auto-load` is passed.

Why Python dependencies are still required: LM Studio hosts the GLM-OCR VLM runtime, but official self-hosted layout detection uses PP-DocLayout in Python, which depends on `torch`, `transformers`, and `opencv-python-headless`.

LM Studio direct GLM-OCR:

```bash
lit lmstudio-ocr-server --port 8830
liteparse parse document.pdf --ocr-server-url http://127.0.0.1:8830/ocr --format json
```

The LM Studio direct wrapper auto-runs `lms load <model> --identifier <model> -y` for installed local models unless `--no-auto-load` is passed. Direct mode may use fallback line boxes if model output lacks parseable bboxes; treat that as degraded OCR evidence.

Codex OCR server:

```bash
lit codex-ocr-server \
  --port 8833 \
  --codex-home "$HOME/.codex-test" \
  --model gpt-5.5 \
  --reasoning-effort medium
liteparse parse document.pdf --ocr-server-url http://127.0.0.1:8833/ocr --format json
```

The Codex server follows the same LiteParse `/ocr` contract as the other HTTP OCR servers. It also exposes `POST /ocr/analyze` for the full advanced artifact with page Markdown, `page_metadata`, `layout_regions`, segmented `assets`, `annotations`, conversion results, model metadata, and provenance. The default backend is `@openai/codex-sdk`; `--backend app-server` enables the experimental `codex app-server` JSON-RPC wrapper. Live development and tests should pass `--codex-home "$HOME/.codex-test"` or set `LITEPARSE_CODEX_HOME=$HOME/.codex-test` so OAuth tokens and config stay separate from normal Codex state.

Run one image through Codex without starting the server:

```bash
lit codex-ocr page.png \
  --codex-home "$HOME/.codex-test" \
  --model gpt-5.5 \
  --reasoning-effort medium \
  --json
```

Add `--ocr-language <code>` when the document language is known:

```bash
liteparse parse document.pdf --ocr-server-url http://localhost:8080/ocr --ocr-language zh --format json
```

## Server contract

Upstream LiteParse baseline sends:

- Method: `POST`
- Path: `/ocr`
- Content type: `multipart/form-data`
- Required field: `file`, containing a single page/image file
- Optional field: `language`, using ISO 639-1 style values such as `en`, `zh`, `ja`, `ko`, `fr`, `de`, `es`, or `ar`

The server must return JSON:

```json
{
  "results": [
    {
      "text": "recognized text",
      "bbox": [10, 20, 60, 40],
      "confidence": 0.95
    }
  ]
}
```

Additional top-level fields such as `engine`, `model`, `mode`, or `warnings` are allowed. Do not remove or rename the top-level `results` array or the required `text`, `bbox`, and `confidence` fields.

Contract rules:

- `results` is an array.
- `bbox` is `[x1, y1, x2, y2]` in pixels.
- Origin is the top-left of the image; x increases right and y increases down.
- `confidence` is a number from `0.0` to `1.0`; use `1.0` if the OCR engine does not provide confidence.
- Return `{"results": []}` when no text is detected.
- Advanced servers may expose `GET /health` or `POST /ocr/analyze`, but LiteParse's built-in HTTP OCR client only depends on `POST /ocr`.

## Local fork extension policy

Keep custom OCR API changes backward-compatible with the upstream baseline whenever possible:

- Keep accepting `file` and `language`.
- Keep returning `results[].text`, `results[].bbox`, and `results[].confidence`.
- Add optional fields instead of replacing baseline fields.
- If a breaking response shape is needed, add an explicit version marker or endpoint path before changing LiteParse callers.

Good extension candidates for the local fork:

- `engine` or `model` metadata for the OCR backend used.
- `rotation` or `orientation` for corrected page/image direction.
- `polygon` in addition to axis-aligned `bbox`.
- `line_id`, `block_id`, `table_id`, or region metadata for layout grouping.
- `debug` or `trace_id` fields for reproducible OCR troubleshooting.
- `language_detected` when the server performs language detection.
- `warnings` when an advanced model needed fallback line boxes or dropped regions without boxes.

For `glmocr-pipeline`, do not silently treat fallback line boxes as valid layout output. Official boxes should come from GLM-OCR SDK/PP-DocLayout `bbox_2d`; unboxed regions should be dropped with warnings such as `region_bbox_missing` or `degraded_no_layout_bbox`.

For `codex-ocr-server`, do not present model-inferred visual localization as deterministic layout ground truth. Preserve warning context such as `codex_bboxes_are_model_inferred`, use `--strict-bbox` when unboxed regions must be dropped, and keep the richer `/ocr/analyze` artifact separate from the baseline `/ocr` result shape.

Release/readiness stance:

- `ocr/glmocr` is a formal optional advanced OCR backend.
- It is heavier than Tesseract/EasyOCR/PaddleOCR because it runs PP-DocLayout and a VLM runtime.
- It is suitable for table and formula-heavy local OCR workflows.
- `codex-ocr-server` is a formal optional advanced agentic OCR backend for page-understanding artifacts and LiteParse-compatible `/ocr` JSON.
- It is heavier and slower than local OCR engines because each page/image is a Codex multimodal request.
- It requires working Codex auth/config. Use `$HOME/.codex-test` for live development and evals.
- Chart/diagram structured semantics and exact LaTeX normalization remain experimental.
- Direct `lmstudio-ocr` prompt modes are diagnostics, not the official structured OCR path.

Update `/Users/arthur/dev-space/liteparse/OCR_API_SPEC.md`, the OCR server implementation, and this skill together when the fork API changes.

## Validation commands

Check a running OCR server directly:

```bash
curl -sS -X POST http://localhost:8080/ocr \
  -F "file=@test.png" \
  -F "language=en" \
| jq .
```

Then test through LiteParse:

```bash
liteparse parse document.pdf --ocr-server-url http://localhost:8080/ocr --format json -q
```

Check a running Codex OCR server:

```bash
curl -sS http://127.0.0.1:8833/health | jq .
curl -sS -X POST http://127.0.0.1:8833/ocr \
  -F "file=@page.png" \
  -F "language=en" \
| jq .
curl -sS -X POST http://127.0.0.1:8833/ocr/analyze \
  -F "file=@page.png" \
  -F "language=en" \
| jq '.markdown, .page_metadata, .layout_regions, .assets, .warnings'
```

## Implementation notes

- Convert OCR polygons or rotated boxes to axis-aligned boxes with min/max coordinates before returning them.
- Keep results in reading order where practical.
- Return HTTP `400` for invalid requests and `500` for OCR processing failures.
- Do not store OCR server credentials or URLs in infra-ops manifests; pass runtime URLs through the CLI command or user-owned local config.
- Do not persist Codex OAuth state or API keys in skill YAML, docs manifests, or reusable repo configs; pass `--codex-home` or environment variables at runtime.
- Use a temporary `liteparse.config.json` for repeatable OCR server runs instead of long command lines when testing multiple documents.

## Source docs

Use `/Users/arthur/dev-space/liteparse/OCR_API_SPEC.md` for the complete local API specification and `/Users/arthur/dev-space/liteparse/ocr/`, `/Users/arthur/dev-space/liteparse/src/engines/ocr/README.md`, and `/Users/arthur/dev-space/liteparse/cli/README.md` for reference server and CLI implementation details.
