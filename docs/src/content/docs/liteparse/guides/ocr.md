---
title: OCR Configuration
description: Configure OCR in LiteParse — built-in Tesseract, or bring your own via HTTP servers.
sidebar:
  order: 2
---

LiteParse uses OCR selectively — only on embedded images or pages where native text extraction didn't find text. This keeps parsing fast while still capturing text from scanned pages and embedded images.

## Built-in Tesseract (default)

Tesseract.js is bundled with LiteParse. The only setup is the automatic download of the Tesseract model files on first use. Just run:

```bash
lit parse document.pdf
```

If bundling LiteParse into a docker container or server environment, you might want to pre-download the Tesseract files to avoid network calls at runtime with the above command or similar.

### Language support

Specify the OCR language for better accuracy on non-English documents:

```bash
lit parse document.pdf --ocr-language fra    # French
lit parse document.pdf --ocr-language deu    # German
lit parse document.pdf --ocr-language jpn    # Japanese
```

Tesseract uses [ISO 639-3](https://tesseract-ocr.github.io/tessdoc/Data-Files-in-different-versions.html) language codes (`eng`, `fra`, `deu`, etc.).

### Disabling OCR

If you don't need OCR (pure native-text PDFs, or you don't care about images), disable it for faster parsing:

```bash
lit parse document.pdf --no-ocr
```

## HTTP OCR servers

For higher accuracy or GPU-accelerated OCR, you can point LiteParse at an HTTP OCR server. LiteParse ships with ready-to-use examples for popular OCR engines.

### EasyOCR

```bash
# Start the EasyOCR server (requires Python)
git clone https://github.com/run-llama/liteparse.git
cd liteparse/ocr/easyocr
pip install -r requirements.txt
python server.py

# Parse with EasyOCR in another terminal
lit parse document.pdf --ocr-server-url http://localhost:8828/ocr
```

### PaddleOCR

```bash
# Start the PaddleOCR server (requires Python)
git clone https://github.com/run-llama/liteparse.git
cd liteparse/ocr/paddleocr
pip install -r requirements.txt
python server.py

# Parse with PaddleOCR in another terminal
lit parse document.pdf --ocr-server-url http://localhost:8828/ocr
```

### GLM-OCR SDK Pipeline

Use the official GLM-OCR SDK pipeline when you need layout boxes from PP-DocLayout, plus local GLM-OCR crop recognition through LM Studio or another model runtime.

```bash
# Starts http://127.0.0.1:8831/ocr
# Auto-loads an installed LM Studio glm-ocr model with lms load when needed.
lit glmocr-ocr-server

# Parse through the standard LiteParse HTTP OCR contract
lit parse document.pdf --ocr-server-url http://127.0.0.1:8831/ocr --format json
```

Advanced artifacts can be generated without `lit parse`:

```bash
lit glmocr-pipeline \
  --path document.pdf \
  --output ./glmocr-output \
  --target-pages "1-3" \
  --layout-device cpu
```

The pipeline backend does not synthesize fallback line boxes. If GLM-OCR SDK regions do not include valid boxes, the affected regions are dropped and warnings report the degradation.

For air-gapped GPU delivery, build the vLLM-only image online once and transfer the saved tar:

```bash
docker build -f Dockerfile.glmocr-offline \
  -t liteparse-glmocr-vllm-offline:1.5.3-custom.0 .
docker save -o liteparse-glmocr-vllm-offline-1.5.3-custom.0.tar \
  liteparse-glmocr-vllm-offline:1.5.3-custom.0
```

On the offline host, validate the bundled model artifacts and local loopback path:

```bash
docker load -i liteparse-glmocr-vllm-offline-1.5.3-custom.0.tar
docker run --rm --gpus all --ipc=host --network=none \
  liteparse-glmocr-vllm-offline:1.5.3-custom.0 smoke
```

### LM Studio GLM-OCR Direct Wrapper

LiteParse can also expose a local LM Studio `glm-ocr` model directly as a Custom HTTP OCR server that follows the same `/ocr` contract as EasyOCR and PaddleOCR.

```bash
# Starts http://127.0.0.1:8830/ocr
# Auto-loads an installed glm-ocr model with lms load when needed.
lit lmstudio-ocr-server

# Parse through the standard LiteParse HTTP OCR contract
lit parse document.pdf --ocr-server-url http://127.0.0.1:8830/ocr --format json
```

Use `--no-auto-load` if you want the command to fail instead of running `lms load`. Use `--strict-bbox` if model output without bounding boxes should be dropped instead of converted into fallback line boxes.

Advanced GLM-OCR artifacts can be generated without `lit parse`:

```bash
lit lmstudio-ocr page.png --mode layout --json

lit lmstudio-ocr-pipeline \
  --path document.pdf \
  --output ./glm-ocr-output \
  --mode auto
```

Direct mode sends the whole page or crop directly to LM Studio and may use fallback line boxes. Prefer `glmocr-ocr-server` for official GLM-OCR layout bbox fidelity.

### Codex OCR Server and Pipeline

LiteParse can expose OpenAI Codex multimodal page understanding as a Custom HTTP OCR server while keeping the same `/ocr` contract used by EasyOCR, PaddleOCR, GLM-OCR, and LM Studio.

```bash
# Starts http://127.0.0.1:8833/ocr
# Use the separate test Codex state requested for live development.
lit codex-ocr-server

# Parse through the standard LiteParse HTTP OCR contract
lit parse document.pdf --ocr-server-url http://127.0.0.1:8833/ocr --format json
```

`POST /ocr/analyze` returns the full Codex artifact: page Markdown, page metadata, layout regions, segmented assets, annotations, LiteParse conversion results, model metadata, and provenance. The default backend is `@openai/codex-sdk`; `--backend app-server` enables the experimental `codex app-server` JSON-RPC wrapper.

For Docker or headless runs, set `LITEPARSE_CODEX_HOME` to a mounted Codex home with `auth.json`/`config.toml`, or provide a Codex `model_provider` in that `config.toml`. Current official Codex config documents custom providers with `wire_api = "responses"`, so OpenAI Chat Completions-compatible local endpoints should be fronted by a Responses/Open Responses adapter before being selected as the Codex provider.

Advanced Codex artifacts can be generated without `lit parse`:

```bash
lit codex-ocr page.png --model gpt-5.4-mini --json

lit codex-ocr-pipeline \
  --path document.pdf \
  --output ./codex-ocr-output \
  --target-pages "1-3"
```

The pipeline writes `pages/`, `codex/`, `liteparse/`, `assets/<type>/`, `annotations/`, `final/document.md`, `final/document.json`, and `manifest.json`. Codex bounding boxes are model-inferred and include `codex_bboxes_are_model_inferred` warnings; use `--strict-bbox` to drop regions without usable boxes.

### Parallel OCR workers

LiteParse OCRs multiple pages in parallel. By default, it uses one fewer worker than your CPU core count. Override this with:

```bash
lit parse document.pdf --num-workers 8
```

This is useful if you need to slow down OCR requests to an external server or if your OCR engine is GPU-accelerated and can handle more concurrency.

## Custom OCR servers

You can integrate any OCR engine by implementing the LiteParse OCR API. Your server needs a single endpoint:

```
POST /ocr
Content-Type: multipart/form-data
```

**Request fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | binary | Yes | Image file (PNG, JPG, etc.) |
| `language` | string | No | ISO 639-1 language code (default: `en`) |

**Response format:**

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

Each result contains:

| Field | Type | Description |
|-------|------|-------------|
| `text` | string | Recognized text |
| `bbox` | `[x1, y1, x2, y2]` | Bounding box in pixels. Origin is top-left, x goes right, y goes down |
| `confidence` | number | Score from 0.0 to 1.0 |

### Testing your server

```bash
# Quick test with curl
curl -X POST http://localhost:8080/ocr \
  -F "file=@test.png" \
  -F "language=en" | jq .

# Use with LiteParse
lit parse document.pdf --ocr-server-url http://localhost:8080/ocr
```

### Common Gotchas

- Return `{"results": []}` if no text is detected
- Bounding boxes must be axis-aligned (`[x1, y1, x2, y2]` where top-left to bottom-right)
- If your engine returns rotated boxes, convert to axis-aligned by taking min/max coordinates
- If your engine doesn't provide confidence scores, return `1.0`
- Results should be in reading order (top-to-bottom, left-to-right)
- Cache OCR models in memory rather than reloading per request

### A note on OCR approaches

These days, its common to apply the term "OCR" to both traditional approaches and newer LLM-based document understanding models. 

The LiteParse OCR API is designed specifically for approaches that return text with bounding boxes. 

If you are trying to integrate a method that doesn't return bounding boxes, you will have to generate dummy bounding boxes.
