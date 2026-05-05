---
name: liteparse-cli-pipelines
description: Reusable LiteParse CLI shell pipelines for AI-agent document workflows. Use when the user wants parse-to-text, parse-to-json, bounding-box extraction, PDF screenshot generation, batch parsing, page-range parsing, GLM-OCR SDK OCR pipelines, Codex OCR server/pipeline workflows, or local smoke-test patterns without writing an SDK integration.
---

# LiteParse CLI Pipelines

Use this skill when the user needs an end-to-end LiteParse shell workflow rather than help on one flag.

## Standard patterns

### 1. Parse text for quick reading

```bash
liteparse parse document.pdf --no-ocr -q
```

Use this when native PDF text is enough and the output is for a human or a simple downstream text pipe.

### 2. Parse JSON for automation

```bash
liteparse parse document.pdf --no-ocr --format json -q \
| python3 -c 'import json, sys; data=json.load(sys.stdin); print("\n".join(page.get("text", "") for page in data.get("pages", [])))'
```

Use this when an agent needs structured page boundaries before summarizing, chunking, or indexing.

### 3. Extract bounding-box facts

```bash
liteparse parse document.pdf --no-ocr --format json -q \
| python3 -c 'import json, sys
data=json.load(sys.stdin)
for page in data.get("pages", []):
    for box in page.get("boundingBoxes", []):
        print(page.get("page"), box)'
```

Use this when downstream code needs layout coordinates or to validate whether extraction preserved spatial structure.

### 4. Generate screenshots for visual inspection

```bash
lit screenshot document.pdf -o /tmp/liteparse-screens --target-pages "1-3" --dpi 150 -q
find /tmp/liteparse-screens -maxdepth 1 -type f -name '*.png' -print
```

Use screenshots when the agent needs visual evidence beyond extracted text.

### 5. Batch parse a directory

```bash
lit batch-parse ./input-docs ./parsed-docs --recursive --format json -q
```

Use this for local corpora. Keep input and output directories explicit so generated files do not land in repo authority paths by accident.

### 6. Reuse a config file

Use a config file when a document set needs consistent OCR, page, DPI, or output settings.

```bash
cat > /tmp/liteparse.config.json <<'JSON'
{
  "ocrLanguage": "en",
  "ocrEnabled": true,
  "maxPages": 1000,
  "dpi": 150,
  "outputFormat": "json",
  "preciseBoundingBox": true,
  "preserveVerySmallText": false
}
JSON
liteparse parse document.pdf --config /tmp/liteparse.config.json -q
```

For a local HTTP OCR server:

```bash
cat > /tmp/liteparse-ocr.config.json <<'JSON'
{
  "ocrServerUrl": "http://localhost:8080/ocr",
  "ocrLanguage": "en",
  "outputFormat": "json",
  "dpi": 200
}
JSON
liteparse parse document.pdf --config /tmp/liteparse-ocr.config.json -q
```

Keep config files in `/tmp` or a user-requested scratch path unless the user explicitly wants a reusable project artifact. Do not put passwords or secret OCR credentials in these files.

### 7. Parse a remote PDF from stdin

```bash
curl -fsSL "https://example.com/report.pdf" \
| liteparse parse - --format json -q
```

Use this only for trusted URLs. If the output must be retained, send it to a scratch file with `-o`.

### 8. Bound temp and OCR language environment

```bash
mkdir -p /tmp/liteparse-work
TESSDATA_PREFIX=/opt/tessdata \
LITEPARSE_TMPDIR=/tmp/liteparse-work \
liteparse parse document.pdf --ocr-language eng --format json -q
```

Use `LITEPARSE_TMPDIR` for large conversion workloads or constrained filesystems. Use `TESSDATA_PREFIX` when OCR language data must be local and deterministic.

### 9. GLM-OCR SDK Pipeline as LiteParse `/ocr`

Use this when the user wants official GLM-OCR SDK layout bboxes exposed through the normal LiteParse Custom HTTP OCR server contract.

Official-style uv-managed Python service, matching `ocr/easyocr` and `ocr/paddleocr`:

```bash
cd /Users/arthur/dev-space/liteparse/ocr/glmocr
LITEPARSE_GLMOCR_OCR_API_URL=http://localhost:1234/v1/chat/completions \
LITEPARSE_GLMOCR_MODEL=glm-ocr-g32-mixed_4_8-mlx \
LITEPARSE_GLMOCR_LAYOUT_DEVICE=cpu \
uv run server.py
```

If LM Studio's `/v1/chat/completions` is not reliable for the model, start the local adapter first:

```bash
lit lmstudio-openai-adapter --port 8832
cd /Users/arthur/dev-space/liteparse/ocr/glmocr
LITEPARSE_GLMOCR_OCR_API_URL=http://127.0.0.1:8832/v1/chat/completions \
LITEPARSE_GLMOCR_MODEL=glm-ocr-g32-mixed_4_8-mlx \
LITEPARSE_GLMOCR_LAYOUT_DEVICE=cpu \
uv run server.py
```

Node-managed wrapper:

```bash
lit glmocr-ocr-server --port 8831 --layout-device cpu
liteparse parse document.pdf \
  --ocr-server-url http://127.0.0.1:8831/ocr \
  --format json \
  --target-pages "1-3" \
  -q
```

The server follows `OCR_API_SPEC.md`: multipart `file`, optional `language`, and JSON `results[]` with `text`, `bbox`, and `confidence`. It uses GLM-OCR SDK/PP-DocLayout `bbox_2d`, then converts boxes to image pixels. With the default LM Studio model runtime, the command automatically runs `lms load glm-ocr-g32-mixed_4_8-mlx --identifier glm-ocr-g32-mixed_4_8-mlx -y` when needed. Add `--no-auto-load` when fail-fast behavior is required.

Use this as the preferred advanced OCR path when table/formula recovery matters. Local LLPAB evidence on a 10-page Pumpkin Book sample showed strong table recovery (`table_TEDS=0.9167`) and improved formula/text scores versus native LiteParse.

### 10. LM Studio direct GLM-OCR as LiteParse `/ocr`

Use this for quick direct model smoke tests or OCR/text extraction when fallback line boxes are acceptable.

```bash
lit lmstudio-ocr-server --port 8830
liteparse parse document.pdf \
  --ocr-server-url http://127.0.0.1:8830/ocr \
  --format json \
  --target-pages "1-3" \
  -q
```

The direct server follows `OCR_API_SPEC.md`: multipart `file`, optional `language`, and JSON `results[]` with `text`, `bbox`, and `confidence`. If LM Studio is running and the model is installed but not loaded, the command automatically runs `lms load glm-ocr-g32-mixed_4_8-mlx --identifier glm-ocr-g32-mixed_4_8-mlx -y`. Add `--no-auto-load` when fail-fast behavior is required.

### 11. Codex OCR as LiteParse `/ocr`

Use this when the user wants Codex multimodal OCR behind the normal LiteParse Custom HTTP OCR server contract.

```bash
lit codex-ocr-server \
  --port 8833 \
  --codex-home "$HOME/.codex-test" \
  --model gpt-5.5 \
  --reasoning-effort medium
liteparse parse document.pdf \
  --ocr-server-url http://127.0.0.1:8833/ocr \
  --format json \
  --target-pages "1-3" \
  -q
```

The server follows `OCR_API_SPEC.md`: multipart `file`, optional `language`, and JSON `results[]` with `text`, `bbox`, and `confidence`. It also exposes `POST /ocr/analyze` for the full Codex artifact:

```bash
curl -sS http://127.0.0.1:8833/health | jq .
curl -sS -X POST http://127.0.0.1:8833/ocr/analyze \
  -F "file=@page.png" \
  -F "language=en" \
| jq '.markdown, .page_metadata, .layout_regions, .assets, .warnings'
```

The default backend is `@openai/codex-sdk`. Use `--backend app-server` only when explicitly testing the experimental `codex app-server` JSON-RPC wrapper. Use `--codex-home "$HOME/.codex-test"` or `LITEPARSE_CODEX_HOME=$HOME/.codex-test` for live development/evals so normal Codex state remains separate.

### 12. Codex OCR single-image and document artifacts

Use a direct image/crop OCR call when you need a Codex page artifact without starting the server:

```bash
lit codex-ocr page.png \
  --codex-home "$HOME/.codex-test" \
  --model gpt-5.5 \
  --reasoning-effort medium \
  --json \
  -o /tmp/page.codex-ocr.json
```

Use the pipeline command for documents, directories, or image sets:

```bash
lit codex-ocr-pipeline \
  --path document.pdf \
  --output /tmp/liteparse-codex-ocr \
  --codex-home "$HOME/.codex-test" \
  --reasoning-effort high \
  --target-pages "1-3" \
  --json
```

Expected artifact layout includes `pages/`, `codex/`, `liteparse/`, `assets/<type>/`, `annotations/`, `final/document.md`, `final/document.json`, and `manifest.json`. The final Markdown includes the `liteparse-codex-ocr-structured-context` section, which promotes page metadata, selected layout regions, segmented asset details, and warnings for downstream QA.

Codex OCR bounding boxes are model-inferred visual localization evidence, not official layout-stage ground truth. Preserve warnings such as `codex_bboxes_are_model_inferred`, and use `--strict-bbox` when the downstream consumer requires every returned OCR region to have a usable box.

### 13. Codex OCR diagnostic eval workflow

Use this pattern when validating whether a Codex OCR pipeline candidate can clear a QA pass-rate gate. Keep generated artifacts under `tmp/` or another requested scratch root.

```bash
lit codex-ocr-pipeline \
  --path input.pdf \
  --output tmp/codex-ocr-eval/candidate/codex-ocr-pipeline \
  --codex-home "$HOME/.codex-test" \
  --reasoning-effort high \
  --target-pages "1-10" \
  --json
```

Evaluate from both `final/document.md` and `final/document.json`, not Markdown alone. The local DeepSeek-V4 diagnostic run improved from 260/290 QA passes (`89.66%`) to 281/290 (`96.90%`) after the evaluator consumed the structured OCR context embedded in `final/document.md`. Treat that result as local model-generated diagnostic evidence and rerun the current harness before claiming a fresh quality gate.

### 14. GLM-OCR single-image and document artifacts

Use a direct image/crop OCR call when you need the model artifact rather than a LiteParse parse result:

```bash
lit lmstudio-ocr page.png --mode layout --json -o /tmp/page.glm-ocr.json
```

Use the pipeline command for documents or directories:

```bash
lit lmstudio-ocr-pipeline \
  --path document.pdf \
  --output /tmp/liteparse-glm-ocr \
  --mode auto \
  --target-pages "1-3" \
  --json
```

Expected artifact layout includes rendered page images, raw LM Studio responses, normalized GLM-OCR artifacts, LiteParse `/ocr` result JSON, and `final/document.md` plus `final/document.json`.

Use the official SDK pipeline command when layout bbox fidelity matters:

```bash
lit glmocr-pipeline \
  --path document.pdf \
  --output /tmp/liteparse-glmocr-sdk \
  --target-pages "1-3" \
  --layout-device cpu \
  --json
```

### 15. LLPAB-backed GLM-OCR regression workflow

Use this when validating whether the current GLM-OCR SDK pipeline still meets the local advanced OCR quality bar.

```bash
python3 scripts/generate-pumpkin-llpab-gold.py

lit glmocr-pipeline \
  --path test_case_multimodal_document_lossless_parse/pumpkin_book/gold/llpab_manual_pages/source/pumpkin_book_10p.pdf \
  --output test_case_multimodal_document_lossless_parse/pumpkin_book/gold/llpab_manual_pages/runs/candidate-raw/liteparse-glmocr-sdk \
  --glmocr-python /Users/arthur/dev-space/liteparse/ocr/glmocr/.venv/bin/python \
  --glmocr-root /Users/arthur/dev-space/GLM-OCR \
  --model-runtime openai-compatible \
  --ocr-api-url http://127.0.0.1:8832/v1/chat/completions \
  --model glm-ocr-g32-mixed_4_8-mlx \
  --layout-device cpu \
  --target-pages "1-10" \
  --json
```

Then import the generated candidate bundle into LLPAB and run deterministic-suite. Treat LLPAB failures as evaluation/runtime failures and direct-mode warnings as diagnostic evidence, not as official structured pipeline results.

## Smoke-test fixture

Use a temporary PDF when verifying the CLI without relying on user documents:

```bash
tmp_pdf="$(mktemp /tmp/liteparse-smoke.XXXXXX.pdf)"
python3 - "$tmp_pdf" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
objects = [
    b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    b"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
]
stream = b"BT\n/F1 18 Tf\n72 720 Td\n(LiteParse smoke fixture for infra ops agents.) Tj\nET\n"
objects.append(b"5 0 obj\n<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"endstream\nendobj\n")
out = bytearray(b"%PDF-1.4\n")
offsets = [0]
for obj in objects:
    offsets.append(len(out))
    out.extend(obj)
xref_start = len(out)
out.extend(f"xref\n0 {len(objects)+1}\n".encode())
out.extend(b"0000000000 65535 f \n")
for off in offsets[1:]:
    out.extend(f"{off:010d} 00000 n \n".encode())
out.extend(f"trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref_start}\n%%EOF\n".encode())
path.write_bytes(out)
PY
liteparse parse "$tmp_pdf" --no-ocr -q
rm -f "$tmp_pdf"
```

## Guardrails

- Keep generated screenshots, parsed JSON, and debug output under `/tmp` or a user-requested scratch path unless the user asks for repo artifacts.
- Use `--target-pages` for large PDFs before running OCR.
- Use `--no-auto-load` for LM Studio GLM-OCR commands when the agent should not trigger `lms load`.
- Use `--codex-home "$HOME/.codex-test"` for Codex OCR development and evals unless the user explicitly wants the normal Codex state directory.
- Do not treat Codex `/ocr/analyze` as a replacement for the baseline LiteParse `/ocr` response shape; it is the richer agent artifact endpoint.
- Do not pass document passwords through persistent scripts or manifests.
- Treat Office conversion as degraded if `libreoffice` or `soffice` is missing.
- Prefer TypeScript library code only when CLI flags or stdin/file paths cannot express the required fork-specific workflow.
