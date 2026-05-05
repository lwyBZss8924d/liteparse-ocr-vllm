# src/engines/ocr/

OCR engines for extracting text from images.

## Files

### interface.ts
**Defines the OcrEngine contract.**

```typescript
interface OcrEngine {
  name: string;
  recognize(image: string | Buffer, options: OcrOptions): Promise<OcrResult[]>;
  recognizeBatch(images: (string | Buffer)[], options: OcrOptions): Promise<OcrResult[][]>;
}

interface OcrOptions {
  language: string | string[];
  correctRotation?: boolean;
}

interface OcrResult {
  text: string;
  bbox: [number, number, number, number];  // [x1, y1, x2, y2]
  confidence: number;  // 0-1 scale
}
```

---

### tesseract.ts
**In-process OCR using Tesseract.js - zero setup required.**

This is the default OCR engine when no `ocrServerUrl` is configured.

**Key Features:**
- Worker-based processing (runs in background thread)
- Accepts file paths or `Buffer` input directly (no temp files needed)
- Language caching (reuses worker for same language)
- Automatic language code normalization (e.g., `en` → `eng`)
- Low-confidence filtering (removes results < 30%)
- Supports offline usage via `TESSDATA_PREFIX` env var or `tessdataPath` config for pre-downloaded `.traineddata` files

**Language Normalization:**
Maps common ISO 639-1 codes to Tesseract's 3-letter codes:
- `en` → `eng`, `fr` → `fra`, `de` → `deu`, `es` → `spa`
- `zh` → `chi_sim`, `zh-tw` → `chi_tra`, `ja` → `jpn`, `ko` → `kor`
- Unknown codes passed through as-is

**Lifecycle:**
- `initialize(language)` - Create/recreate worker for language
- `recognize(image, options)` - OCR single image (accepts file path or Buffer)
- `recognizeBatch(images, options)` - OCR multiple images sequentially
- `terminate()` - Clean up worker (called by LiteParse after parsing)

**Design Decisions:**
- **30% confidence threshold**: Filters noisy OCR results (tesseract.ts:59)
- **Worker caching**: Avoids expensive reinitialization when language unchanged
- **Sequential batch processing**: Tesseract.js workers aren't parallelizable

---

### http-simple.ts
**HTTP client for external OCR servers.**

Used when `ocrServerUrl` is configured. Allows using more powerful OCR backends (EasyOCR, PaddleOCR, etc.) running as separate services.

**API Specification:**
Servers must conform to `OCR_API_SPEC.md`:
- **Endpoint**: POST to configured URL
- **Request**: `multipart/form-data` with `file` (image) and `language` fields
- **Response**: `{ results: [{ text, bbox: [x1,y1,x2,y2], confidence }] }`

**Features:**
- 60-second timeout per request
- Graceful error handling (returns empty array on failure)
- Detailed error logging for debugging

**Design Decision:**
Simple sequential processing rather than batching because:
1. External servers may have their own batching/queuing
2. Keeps the API simple and predictable
3. Allows per-image error handling

**Example Servers:**
See `ocr/easyocr/` and `ocr/paddleocr/` for reference implementations.

---

### glmocr.ts / glmocr-server.ts / glmocr-runtime.ts
**Official GLM-OCR SDK pipeline adapter.**

These modules expose the GLM-OCR SDK self-hosted pipeline through LiteParse's standard `/ocr` contract.

**Key behavior:**
- `glmocr-runtime.ts` starts or connects to `python -m glmocr.server` without mutating GLM-OCR source config files.
- `glmocr-server.ts` accepts multipart `POST /ocr` and converts SDK `json_result` / `layout_details` into LiteParse `OcrResult[]`.
- `glmocr.ts` converts normalized `bbox_2d` values on the `0..1000` GLM-OCR scale into pixel bboxes.
- The default model runtime is LM Studio; the runtime can use LM Studio's OpenAI endpoint or the LiteParse OpenAI adapter for LM Studio native `/api/v1/chat`.

This path should be used when official PP-DocLayout layout boxes are required. It does not synthesize fallback line boxes.

---

### lmstudio.ts / lmstudio-server.ts
**Direct LM Studio GLM-OCR wrapper.**

These modules send a page or crop directly to LM Studio. They are useful for quick OCR/model smoke tests and raw artifacts, but model output without parseable `bbox_2d` may be converted into fallback line boxes unless strict bbox mode is enabled.

---

### codex.ts / codex-server.ts
**OpenAI Codex multimodal OCR wrapper.**

These modules expose Codex page/image understanding through LiteParse's standard `/ocr` contract and a richer `/ocr/analyze` artifact endpoint.

**Key behavior:**
- `codex.ts` uses `@openai/codex-sdk` by default. The SDK wraps the local `codex` CLI and passes images as `local_image` inputs.
- `codex.ts` also supports an experimental `codex app-server` backend for clients that need JSON-RPC app-server integration.
- `codex-server.ts` accepts multipart `POST /ocr` and normalizes Codex layout regions into `OcrResult[]`.
- `POST /ocr/analyze` returns the full Codex artifact: page Markdown, `page_metadata`, `layout_regions`, segmented `assets`, `annotations`, conversion results, model metadata, and provenance.
- Codex bboxes use the `normalized_1000` schema by default and are converted to pixel boxes before `/ocr` responses.

Codex bboxes are model-inferred visual localization evidence, not official layout-detector boxes. Artifacts keep `codex_bboxes_are_model_inferred` warnings, and `--strict-bbox` drops regions that do not include usable boxes.

For live development and tests, use a separate Codex state directory:

```bash
lit codex-ocr page.png --codex-home "$HOME/.codex-test" --model gpt-5.4-mini --json
```

For Docker or headless `codex-ocr-server` runs, `LITEPARSE_CODEX_HOME` must point at a Codex home containing usable auth/config, or a `config.toml` with a custom Codex `model_provider`. Current official Codex config documents custom providers with `wire_api = "responses"`; expose local OpenAI Chat Completions-compatible endpoints through a Responses/Open Responses adapter before selecting them as the Codex provider.
