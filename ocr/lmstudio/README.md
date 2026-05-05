# LM Studio GLM-OCR Direct Service

This service is exposed by the LiteParse CLI and wraps an LM Studio-hosted `glm-ocr` model so it conforms to the LiteParse OCR API specification (`../../OCR_API_SPEC.md`).

This direct wrapper is useful for quick model smoke tests, OCR/text extraction, and page/crop artifact generation. It does not run the official GLM-OCR SDK self-hosted layout pipeline. Use [`../glmocr/`](../glmocr/) when you need PP-DocLayout-backed `bbox_2d` layout boxes.

## Build and Run

No separate Python server is required. Build LiteParse, then start the server:

```bash
npm run build

# Starts http://127.0.0.1:8830/ocr
lit lmstudio-ocr-server
```

If LM Studio is running and `glm-ocr-g32-mixed_4_8-mlx` is installed but not loaded, LiteParse automatically runs:

```bash
lms load glm-ocr-g32-mixed_4_8-mlx --identifier glm-ocr-g32-mixed_4_8-mlx -y
```

Use `--no-auto-load` to disable this behavior.

## Usage

The service exposes the standard LiteParse endpoint:

- `POST /ocr` - Perform OCR on an uploaded image and return LiteParse OCR results

It also exposes operational endpoints:

- `GET /health` - Report server, model, and LM Studio status
- `POST /ocr/analyze` - Return the full normalized GLM-OCR artifact

### Parameters

For `POST /ocr`:

- `file` - Image file (multipart/form-data, required)
- `language` - Language code (accepted for LiteParse compatibility)
- `mode` - Optional GLM-OCR mode: `auto`, `text`, `layout`, `table`, `formula`, or `diagram`

### Example

```bash
curl -X POST \
  -F "file=@image.png" \
  -F "language=zh" \
  -F "mode=layout" \
  http://127.0.0.1:8830/ocr
```

### Response Format

```json
{
  "results": [
    {
      "text": "recognized text",
      "bbox": [10, 20, 200, 60],
      "confidence": 1
    }
  ],
  "engine": "lmstudio-glm-ocr",
  "model": "glm-ocr-g32-mixed_4_8-mlx",
  "mode": "layout",
  "warnings": []
}
```

The top-level metadata is optional. The `results` array follows `OCR_API_SPEC.md` and is the only contract LiteParse requires.

## Use with LiteParse

```bash
lit parse document.pdf \
  --ocr-server-url http://127.0.0.1:8830/ocr \
  --format json
```

For advanced artifacts without going through `lit parse`:

```bash
lit lmstudio-ocr page.png --mode table --json

lit lmstudio-ocr-pipeline \
  --path document.pdf \
  --output ./glm-ocr-output \
  --mode auto \
  --target-pages "1-3"
```

## Options

```bash
lit lmstudio-ocr-server \
  --host 127.0.0.1 \
  --port 8830 \
  --base-url http://localhost:1234 \
  --model glm-ocr-g32-mixed_4_8-mlx \
  --mode auto \
  --concurrency 1
```

Important options:

- `--base-url` - LM Studio base URL. Default: `http://localhost:1234`
- `--model` - LM Studio model identifier. Default: `glm-ocr-g32-mixed_4_8-mlx`
- `--api-mode` - `lmstudio-native` or `openai`. Default: `lmstudio-native`
- `--no-auto-load` - Do not run `lms load` automatically
- `--strict-bbox` - Drop OCR output without parseable bounding boxes

## Environment Variables

- `LITEPARSE_LMSTUDIO_BASE_URL`
- `LITEPARSE_GLM_OCR_MODEL`
- `LITEPARSE_LMSTUDIO_API_KEY`
- `LITEPARSE_LMSTUDIO_AUTO_LOAD=0`

## Testing

```bash
curl http://127.0.0.1:8830/health | jq .

curl -X POST http://127.0.0.1:8830/ocr \
  -F "file=@test.png" \
  -F "language=en" \
| jq .
```

Then test through LiteParse:

```bash
lit parse document.pdf --ocr-server-url http://127.0.0.1:8830/ocr --format json -q
```

## Notes

- LM Studio must be installed and the local server must be running.
- The model must be installed locally. LiteParse can auto-load an installed model, but it does not download models.
- GLM-OCR direct responses may return normalized `bbox_2d` coordinates on a `0..1000` scale. The server converts those to pixel boxes before returning `/ocr` results.
- If the direct model response returns text without boxes, LiteParse creates deterministic line-level fallback boxes unless `--strict-bbox` is set.
- Fallback line boxes are degraded OCR evidence, not official GLM-OCR layout output. For official layout bboxes, use `lit glmocr-ocr-server` or `lit glmocr-pipeline`.
