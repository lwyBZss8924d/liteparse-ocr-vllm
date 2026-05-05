# GLM-OCR SDK Pipeline Service

This service wraps the official GLM-OCR SDK self-hosted pipeline so it conforms to the LiteParse OCR API specification (`../../OCR_API_SPEC.md`).

Use this backend when you need real layout bounding boxes. The SDK pipeline runs PP-DocLayout first, crops layout regions, then sends each crop to a GLM-OCR model runtime such as LM Studio, vLLM, SGLang, or Ollama.

## Why Python deps are still needed

LM Studio hosts the `glm-ocr` VLM runtime, but the official self-hosted GLM-OCR pipeline has another local stage: PP-DocLayout. That layout detector creates the `bbox_2d` regions before crops are sent to LM Studio. PP-DocLayout is implemented with `torch`, `transformers`, and `opencv-python-headless`, so those packages are required for official layout bboxes even when LM Studio performs the OCR/model inference.

## Build and Run

This directory follows the same dependency pattern as `ocr/easyocr` and `ocr/paddleocr`: run the Python service from this directory and let `uv` resolve the Python dependencies declared in `pyproject.toml`. The GLM-OCR SDK is pinned to `zai-org/GLM-OCR` commit `cef4d0ea120d1741f5cefe8985eee45f6c8eff1d`.

```bash
cd ocr/glmocr

# install and run (in one command)
uv run server.py
```

The service listens on `http://localhost:8831/ocr` by default.

For the default LM Studio runtime, make sure LM Studio server is running and the model is installed/loaded:

```bash
lms load glm-ocr-g32-mixed_4_8-mlx --identifier glm-ocr-g32-mixed_4_8-mlx -y
```

The standalone Python service uses these environment variables:

```bash
LITEPARSE_GLMOCR_OCR_API_URL=http://localhost:1234/v1/chat/completions
LITEPARSE_GLMOCR_OCR_API_MODE=openai
LITEPARSE_GLMOCR_MODEL=glm-ocr-g32-mixed_4_8-mlx
LITEPARSE_GLMOCR_LAYOUT_DEVICE=cpu
LITEPARSE_GLMOCR_LAYOUT_MODEL_DIR=PaddlePaddle/PP-DocLayoutV3_safetensors
LITEPARSE_GLMOCR_LAYOUT_BATCH_SIZE=1
LITEPARSE_GLMOCR_MAX_WORKERS=1
LITEPARSE_GLMOCR_HOST=0.0.0.0
LITEPARSE_GLMOCR_PORT=8831
```

If LM Studio's OpenAI-compatible endpoint is not usable, start the LiteParse adapter in another terminal and point the Python service at it:

```bash
lit lmstudio-openai-adapter --port 8832

cd ocr/glmocr
LITEPARSE_GLMOCR_OCR_API_URL=http://127.0.0.1:8832/v1/chat/completions \
uv run server.py
```

## Runtime Layout

```text
LiteParse /ocr request
  -> uv run ocr/glmocr/server.py
  -> PPDocLayoutDetector creates bbox_2d
  -> OCRClient calls GLM-OCR model runtime
  -> server.py converts bbox_2d to pixel bbox
```

LM Studio is the default model runtime, but it is not the layout detector. The official layout boxes come from GLM-OCR SDK's PP-DocLayout stage.

## Usage

```bash
lit parse document.pdf \
  --ocr-server-url http://127.0.0.1:8831/ocr \
  --format json
```

The server also exposes:

- `GET /health` - Report LiteParse, GLM-OCR SDK, and model runtime status
- `POST /ocr/analyze` - Return the raw GLM-OCR SDK artifact plus converted LiteParse results

## LiteParse CLI wrapper

The LiteParse CLI also exposes a Node-managed wrapper around the same SDK pipeline:

```bash
lit glmocr-ocr-server \
  --model-runtime lmstudio \
  --base-url http://localhost:1234 \
  --lmstudio-api-mode auto
```

The standalone `uv run server.py` path is the same style as the EasyOCR and PaddleOCR adapters. The CLI wrapper is useful when you want LiteParse to manage the GLM-OCR SDK process and LM Studio adapter lifecycle.

For portable CLI runs, omit `--glmocr-root` when `glmocr` is already importable from the selected Python environment. Pass `--glmocr-root` only for a source checkout, or set `LITEPARSE_GLMOCR_ROOT`. Docker uses `/opt/glm-ocr-sdk`.

## Model Runtime Options

Default LM Studio OpenAI-compatible path:

```bash
cd ocr/glmocr
LITEPARSE_GLMOCR_OCR_API_URL=http://localhost:1234/v1/chat/completions \
uv run server.py
```

External OpenAI-compatible runtime:

```bash
cd ocr/glmocr
LITEPARSE_GLMOCR_OCR_API_URL=http://127.0.0.1:8080/v1/chat/completions \
LITEPARSE_GLMOCR_MODEL=glm-ocr \
uv run server.py
```

vLLM offline Docker runtime:

```bash
docker run --rm --gpus all --ipc=host -p 8831:8831 \
  liteparse-glmocr-vllm-offline:1.5.3-custom.0
```

The offline image starts `vllm serve /opt/models/glm-ocr` and points the GLM-OCR SDK at `/opt/models/pp-doclayout` through `LITEPARSE_GLMOCR_LAYOUT_MODEL_DIR`.

Ollama-style runtime:

```bash
cd ocr/glmocr
LITEPARSE_GLMOCR_OCR_API_URL=http://127.0.0.1:11434/api/generate \
LITEPARSE_GLMOCR_OCR_API_MODE=ollama_generate \
LITEPARSE_GLMOCR_MODEL=glm-ocr:latest \
uv run server.py
```

## Advanced Pipeline

```bash
lit glmocr-pipeline \
  --path document.pdf \
  --output ./glmocr-output \
  --target-pages "1-3" \
  --layout-device cpu \
  --json
```

Output includes:

- `pages/page_###.png`
- `glmocr/page_###.glmocr.json`
- `liteparse/page_###.ocr-results.json`
- `final/document.md`
- `final/document.json`
- `manifest.json`

## OCR Response

`POST /ocr` always returns the LiteParse baseline shape:

```json
{
  "results": [
    {
      "text": "recognized text",
      "bbox": [10, 20, 200, 60],
      "confidence": 1
    }
  ],
  "engine": "glmocr-pipeline",
  "model": "glm-ocr",
  "warnings": []
}
```

The `bbox` values are pixel coordinates converted from official GLM-OCR `bbox_2d` values on a `0..1000` scale. This backend does not synthesize fallback line boxes; if layout boxes are missing, results are dropped and warnings describe the degradation.

## Testing

```bash
cd ocr/glmocr
uv run pytest test_server.py

curl http://127.0.0.1:8831/health | jq .

curl -X POST http://127.0.0.1:8831/ocr \
  -F "file=@test.png" \
  -F "language=en" \
| jq .
```

Then test through LiteParse:

```bash
lit parse document.pdf --ocr-server-url http://127.0.0.1:8831/ocr --format json -q
```
