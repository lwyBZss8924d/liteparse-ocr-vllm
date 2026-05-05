# LiteParse OCR API Specification

This document defines the standard HTTP API that OCR servers must implement to work with LiteParse.

## Overview

LiteParse expects a simple HTTP endpoint that accepts an image and returns text with bounding boxes. Your OCR server can internally use any OCR engine (EasyOCR, PaddleOCR, Tesseract, Cloud APIs, etc.) as long as it conforms to this API.

## Endpoint

```
POST /ocr
```

Custom servers may expose additional endpoints such as `/health` or `/ocr/analyze`, but LiteParse's built-in HTTP OCR client only relies on `POST /ocr`.

## Request Format

**Content-Type:** `multipart/form-data`

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | binary | Yes | Image file (PNG, JPG, etc.) |
| `language` | string | No | Language code (default: `en`) |

### Language Codes

Use ISO 639-1 two-letter codes:
- `en` - English
- `zh` - Chinese
- `ja` - Japanese
- `ko` - Korean
- `fr` - French
- `de` - German
- `es` - Spanish
- `ar` - Arabic
- etc.

Your server should map these to whatever format your underlying OCR engine expects.

## Response Format

**Content-Type:** `application/json`

**Structure:**

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

Servers may include extra top-level metadata such as `engine`, `model`, `mode`, or `warnings`. They must not replace or remove the `results` array, and every item in `results` must keep the `text`, `bbox`, and `confidence` fields described below.

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `results` | array | Array of text detection results |
| `results[].text` | string | Recognized text content |
| `results[].bbox` | [number, number, number, number] | Bounding box `[x1, y1, x2, y2]` where (x1,y1) is top-left and (x2,y2) is bottom-right |
| `results[].confidence` | number | Confidence score between 0.0 and 1.0 |

## Example

### Request

```bash
curl -X POST http://localhost:8080/ocr \
  -F "file=@document.png" \
  -F "language=en"
```

### Response

```json
{
  "results": [
    {
      "text": "Hello",
      "bbox": [10, 20, 60, 40],
      "confidence": 0.98
    },
    {
      "text": "World",
      "bbox": [70, 20, 130, 40],
      "confidence": 0.97
    }
  ]
}
```

## Error Handling

Return appropriate HTTP status codes:

- `200 OK` - Success
- `400 Bad Request` - Invalid request (missing file, invalid language, etc.)
- `500 Internal Server Error` - OCR processing failed

Error response format:

```json
{
  "error": "Description of the error"
}
```

## Implementation Notes

### Coordinate System

- Origin (0,0) is at the **top-left** of the image
- X increases to the right
- Y increases downward
- All coordinates are in pixels

### Bounding Box Format

Always return axis-aligned bounding boxes as `[x1, y1, x2, y2]`:
- `x1, y1` = top-left corner
- `x2, y2` = bottom-right corner
- `x2 > x1` and `y2 > y1`

If your OCR engine returns rotated boxes or polygon coordinates, convert them to axis-aligned boxes by taking min/max coordinates.

### Confidence Scores

- Normalize to range 0.0 to 1.0
- 1.0 = 100% confident
- 0.0 = 0% confident
- If your OCR engine doesn't provide confidence, use `1.0`

### Text Ordering

Results should be ordered by reading order (top-to-bottom, left-to-right for most languages).

## Example Implementations

See the `/ocr` directory for reference implementations:

- `ocr/easyocr/` - Wrapper for EasyOCR
- `ocr/paddleocr/` - Wrapper for PaddleOCR
- `ocr/glmocr/` - GLM-OCR SDK pipeline adapter with PP-DocLayout layout boxes
- `ocr/lmstudio/` - Documentation for the LM Studio GLM-OCR wrapper server
- `lit codex-ocr-server` - OpenAI Codex multimodal OCR server and advanced artifact endpoint

## Advanced OCR Servers

Some OCR backends, including GLM-OCR SDK pipeline servers and the Codex OCR server, can return richer document understanding artifacts such as Markdown, page metadata, table HTML, formula LaTeX, layout regions, segmented assets, annotations, and normalized `bbox_2d` or `normalized_1000` coordinates. These advanced artifacts are useful for agent pipelines, but the `/ocr` endpoint must still normalize them into the baseline LiteParse response:

```json
{
  "results": [
    {
      "text": "recognized text",
      "bbox": [10, 20, 200, 60],
      "confidence": 1.0
    }
  ],
  "engine": "glmocr-pipeline",
  "model": "glm-ocr-g32-mixed_4_8-mlx",
  "warnings": []
}
```

When an advanced backend returns normalized `bbox_2d` or `normalized_1000` values in a `0..1000` coordinate space, the server must convert them to image pixel coordinates before returning `results[].bbox`. For official GLM-OCR SDK pipeline integrations, those boxes should come from the SDK layout stage, not from prompt-inferred whole-page model output. Codex OCR boxes are model-inferred visual localization evidence and are reported with warnings such as `codex_bboxes_are_model_inferred`.

If no reliable bounding boxes are available, a direct OCR wrapper may either return deterministic fallback boxes or return an empty `results` array in strict mode. A GLM-OCR SDK pipeline adapter should not silently treat fallback line boxes as official layout output; it should drop unboxed regions and report warnings such as `region_bbox_missing` or `degraded_no_layout_bbox`.

Advanced servers may expose `POST /ocr/analyze` for the full artifact while keeping `POST /ocr` backward-compatible. The Codex OCR server returns a full artifact from `/ocr/analyze` with page Markdown, `page_metadata`, `layout_regions`, `assets`, `annotations`, `conversion.results`, model metadata, and provenance.

## Testing Your Server

Quick test:

```bash
# 1. Start your server
python server.py

# 2. Test with curl
curl -X POST http://localhost:8080/ocr \
  -F "file=@test.png" \
  -F "language=en" \
  | jq .

# 3. Expected output:
# {
#   "results": [
#     {
#       "text": "...",
#       "bbox": [x1, y1, x2, y2],
#       "confidence": 0.xx
#     }
#   ]
# }
```

Use with LiteParse:

```bash
lit parse document.pdf --ocr-server-url http://localhost:8080/ocr
```

## FAQ

### Q: What if my OCR returns rotated bounding boxes?

Convert to axis-aligned boxes:

```python
def polygon_to_bbox(polygon):
    """Convert polygon [[x1,y1], [x2,y2], ...] to [x1, y1, x2, y2]"""
    xs = [point[0] for point in polygon]
    ys = [point[1] for point in polygon]
    return [min(xs), min(ys), max(xs), max(ys)]
```

### Q: What if my OCR doesn't return confidence scores?

Just return `1.0` for all results.

### Q: Can I return empty results?

Yes, return `{"results": []}` if no text is detected.

### Q: Should I filter low-confidence results?

You can, but LiteParse will also handle filtering based on its own thresholds.

### Q: What image formats should I accept?

At minimum: PNG, JPG. Optionally: TIFF, WebP, BMP, GIF.

### Q: Should I handle rotation correction?

Optional. If your OCR engine supports it, you can auto-correct rotation before processing.

### Q: What about multi-page documents?

LiteParse handles page splitting. Your server only needs to process single images.

### Q: Performance considerations?

- Keep server response time under 10 seconds per image
- Support concurrent requests
- Consider GPU acceleration for better performance
- Cache OCR models in memory (don't reload per request)

## Compliance Checklist

- [ ] Accepts `POST /ocr` endpoint
- [ ] Accepts `file` and `language` form fields
- [ ] Returns JSON with `results` array
- [ ] Each result has `text`, `bbox`, and `confidence`
- [ ] Bounding boxes in `[x1, y1, x2, y2]` format
- [ ] Confidence normalized to 0.0-1.0 range
- [ ] Returns 200 status on success
- [ ] Returns appropriate error codes and messages
- [ ] Handles common image formats (PNG, JPG)
- [ ] Processes images in under 10 seconds

## Support

Questions? Open an issue on GitHub or refer to the example implementations in `/ocr`.
