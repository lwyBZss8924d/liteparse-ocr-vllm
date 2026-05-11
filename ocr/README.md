# ocr/

Example OCR server implementations that conform to the LiteParse OCR API specification.

These servers allow you to use alternative OCR engines instead of the built-in Tesseract.js.

## Why Use an External OCR Server?

| Feature | Tesseract.js (built-in) | EasyOCR | PaddleOCR | GLM-OCR SDK Pipeline | Codex OCR |
|---------|-------------------------|---------|-----------|----------------------|-----------|
| Setup | Zero (included) | uv | uv | GLM-OCR SDK + model runtime | Codex CLI auth/config |
| Speed | Moderate | Moderate | Fast (2-3x) | Layout/model dependent | Model/API dependent |
| Accuracy (Latin) | Good | Good | Good | Strong document OCR/VLM | Strong multimodal OCR |
| Accuracy (CJK) | Fair | Good | Excellent | Strong document OCR/VLM | Model dependent |
| Layout bboxes | OCR word/line boxes | OCR boxes | OCR boxes | PP-DocLayout `bbox_2d` | Model-inferred `normalized_1000` |
| Memory | In-process | Separate | Separate | Separate Python/model processes | Separate Codex CLI process |

**Recommendations:**
- **Quick start**: Use built-in Tesseract (no setup)
- **Asian languages**: Use PaddleOCR (best CJK support)
- **General use**: EasyOCR (good balance)
- **Layout/table/formula-heavy local VLM OCR**: Use GLM-OCR SDK Pipeline
- **Agentic multimodal page understanding**: Use Codex OCR for Markdown, metadata, layout, assets, and annotations

## Available Servers

### [easyocr/](./easyocr/)
Flask server wrapping EasyOCR library.
- Port: **8828**
- Good general-purpose OCR
- 80+ languages

### [paddleocr/](./paddleocr/)
Flask server wrapping PaddleOCR library.
- Port: **8829**
- Excellent for Chinese, Japanese, Korean
- 2-3x faster than EasyOCR

### [glmocr/](./glmocr/)
Python service and CLI wrapper backed by the official GLM-OCR SDK self-hosted pipeline.
- Port: **8831**
- Implements `POST /ocr` exactly as required by `OCR_API_SPEC.md`
- Uses PP-DocLayout for real layout `bbox_2d`, then calls LM Studio/vLLM/SGLang/Ollama for crop OCR
- Python dependencies are declared in `ocr/glmocr/pyproject.toml` and managed with `uv run server.py`, matching the EasyOCR and PaddleOCR adapters
- Auto-loads the local LM Studio model with `lms load` when LM Studio is the model runtime
- The SDK/`uv run server.py` path is not GPU-only; the release image target `Dockerfile.glmocr-offline` is an optional vLLM serving package for offline hosts where a GPU is expected for practical model inference

### [lmstudio/](./lmstudio/)
Node server exposed by the LiteParse CLI and backed by LM Studio `glm-ocr`.
- Port: **8830**
- Implements `POST /ocr` exactly as required by `OCR_API_SPEC.md`
- Direct page/crop wrapper for quick OCR and model smoke tests
- Auto-loads the local LM Studio model with `lms load` unless `--no-auto-load` is used
- May use fallback line boxes when the direct model response lacks parseable `bbox_2d`

### Codex OCR CLI/server
Node server exposed by the LiteParse CLI and backed by OpenAI Codex multimodal page understanding.
- Port: **8833**
- Implements `POST /ocr` exactly as required by `OCR_API_SPEC.md`
- Exposes `POST /ocr/analyze` for the full advanced artifact: Markdown, page metadata, layout regions, segmented assets, annotations, conversion results, model metadata, and provenance
- Uses `@openai/codex-sdk` by default and supports an experimental `codex app-server` backend with `--backend app-server`
- Live development/test runs should set `HOME` to a temporary directory containing `$HOME/.codex/auth.json` and omit `--codex-home` so default `$HOME/.codex` behavior is exercised
- Docker defaults to the `codex` OCR profile: mount `LITEPARSE_CODEX_HOME` with `auth.json`/`config.toml`, or provide a Codex `model_provider` config for a local/proxy Responses-compatible endpoint
- Bounding boxes are model-inferred and reported with warnings; use `--strict-bbox` to drop regions without usable boxes

## Quick Start

```bash
# Start EasyOCR server
cd ocr/easyocr
uv run server.py

# OR start PaddleOCR server
cd ocr/paddleocr
uv run server.py

# OR start official GLM-OCR SDK pipeline server using uv-managed Python deps
cd ocr/glmocr
uv run server.py

# OR start the Node-managed GLM-OCR SDK pipeline wrapper from the LiteParse CLI
lit glmocr-ocr-server

# OR start Docker's default Codex OCR server profile
docker run --rm -p 8833:8833 \
  -e LITEPARSE_CODEX_HOME=/codex-home \
  -v "$HOME/.codex:/codex-home" \
  liteparse-glmocr-vllm-offline:1.5.3-custom.0

# OR start the optional offline vLLM GLM-OCR image after docker load on a GPU serving host
docker run --rm --gpus all --ipc=host -p 8831:8831 \
  -e LITEPARSE_OCR_PROFILE=glmocr-vllm \
  liteparse-glmocr-vllm-offline:1.5.3-custom.0

# OR start the LM Studio direct wrapper
lit lmstudio-ocr-server

# OR start the Codex OCR server
lit codex-ocr-server
```

Then use with LiteParse:

```bash
# CLI
lit parse document.pdf --ocr-server-url http://localhost:8828/ocr

# GLM-OCR SDK Pipeline
lit parse document.pdf --ocr-server-url http://127.0.0.1:8831/ocr --format json

# LM Studio direct wrapper
lit parse document.pdf --ocr-server-url http://127.0.0.1:8830/ocr --format json

# Codex OCR
lit parse document.pdf --ocr-server-url http://127.0.0.1:8833/ocr --format json

# Code
const parser = new LiteParse({
  ocrServerUrl: 'http://localhost:8828/ocr',
  ocrLanguage: 'en',
});
```

## API Specification

All servers implement the same API (defined in `OCR_API_SPEC.md`):

**Endpoint:** `POST /ocr`

**Request:**
- Content-Type: `multipart/form-data`
- Fields:
  - `file` - Image file
  - `language` - Language code (e.g., 'en', 'zh', 'ja')

**Response:**
```json
{
  "results": [
    {
      "text": "recognized text",
      "bbox": [x1, y1, x2, y2],
      "confidence": 0.95
    }
  ]
}
```

## Creating a Custom OCR Server

To implement your own OCR server:

1. Create a Flask/FastAPI/Express server
2. Accept `POST /ocr` with multipart form data
3. Return JSON with `results` array containing:
   - `text` - Recognized text string
   - `bbox` - Bounding box as `[x1, y1, x2, y2]`
   - `confidence` - Confidence score (0-1)

4. (Optional) Implement `GET /health` endpoint

See the existing servers as reference implementations.

## Language Codes

Most servers accept ISO 639-1 codes (e.g., 'en', 'zh', 'ja') and map them internally:

| ISO Code | Language | Notes |
|----------|----------|-------|
| en | English | |
| zh | Chinese (Simplified) | |
| zh-tw | Chinese (Traditional) | |
| ja | Japanese | |
| ko | Korean | |
| fr | French | |
| de | German | |
| es | Spanish | |
| ar | Arabic | |
| hi | Hindi | |
