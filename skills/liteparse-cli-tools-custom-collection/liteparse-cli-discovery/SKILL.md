---
name: liteparse-cli-discovery
description: Progressive discovery guide for the LiteParse CLI. Use when the user wants to know which LiteParse command to run, how to verify the governed local-source CLI, whether to use `liteparse` or `lit`, or how to choose parse, screenshot, batch-parse, OCR, GLM-OCR SDK pipelines, Codex OCR server/pipeline workflows, JSON, text, page-range, and dependency options for document parsing workflows.
---

# LiteParse CLI Discovery

Use this skill to decide which LiteParse command and output mode matches the task.

## Quick routing

- Parse one document to text: `liteparse parse <file> --no-ocr`
- Parse for automation: `liteparse parse <file> --format json --no-ocr`
- Parse selected pages: `liteparse parse <file> --target-pages "1-3,8" --format json`
- Generate PDF page images: `lit screenshot <file> -o <output-dir> --target-pages "1,3"`
- Parse a directory: `lit batch-parse <input-dir> <output-dir> --recursive`
- Use an external OCR service: `liteparse parse <file> --ocr-server-url http://localhost:8080/ocr`
- Use official-style GLM-OCR SDK Python service: `cd ocr/glmocr && uv run server.py`, then `liteparse parse <file> --ocr-server-url http://127.0.0.1:8831/ocr --format json`
- Use GLM-OCR SDK layout pipeline as a LiteParse OCR server: `lit glmocr-ocr-server`, then `liteparse parse <file> --ocr-server-url http://127.0.0.1:8831/ocr --format json`
- Use LM Studio direct GLM-OCR as a LiteParse OCR server: `lit lmstudio-ocr-server`, then `liteparse parse <file> --ocr-server-url http://127.0.0.1:8830/ocr --format json`
- Run one GLM-OCR image/crop: `lit lmstudio-ocr image.png --mode layout --json`
- Run official GLM-OCR SDK artifacts for a document: `lit glmocr-pipeline -p document.pdf -o ./glmocr-output`
- Run direct LM Studio GLM-OCR artifacts for a document: `lit lmstudio-ocr-pipeline -p document.pdf -o ./glm-ocr-output --mode auto`
- Use Codex OCR as a LiteParse OCR server: `HOME="$ODQA_CODEX_TEST_HOME" lit codex-ocr-server`, then `HOME="$ODQA_CODEX_TEST_HOME" liteparse parse <file> --ocr-server-url http://127.0.0.1:8833/ocr --format json`
- Run one Codex OCR image/crop: `HOME="$ODQA_CODEX_TEST_HOME" lit codex-ocr image.png --json`
- Run Codex OCR page-understanding artifacts for a document: `HOME="$ODQA_CODEX_TEST_HOME" lit codex-ocr-pipeline -p document.pdf -o ./codex-ocr-output --json`
- Use the TypeScript library when the CLI cannot express a fork-only option or in-memory buffer workflow.

`liteparse` and `lit` are aliases for the same CLI on this workstation. Prefer `liteparse` in documentation and `lit` for shorter interactive commands.

## Supported input formats

LiteParse converts non-PDF inputs to PDF before parsing when the required system dependency is available.

| Category | Formats | Dependency |
| --- | --- | --- |
| PDF | `.pdf` | Built in |
| Word | `.doc`, `.docx`, `.docm`, `.odt`, `.rtf` | LibreOffice / `soffice` |
| PowerPoint | `.ppt`, `.pptx`, `.pptm`, `.odp` | LibreOffice / `soffice` |
| Spreadsheets | `.xls`, `.xlsx`, `.xlsm`, `.ods`, `.csv`, `.tsv` | LibreOffice / `soffice` |
| Images | `.jpg`, `.jpeg`, `.png`, `.gif`, `.bmp`, `.tiff`, `.webp`, `.svg` | ImageMagick |

Treat Office formats as degraded on this workstation until `libreoffice` or `soffice` is present. Image conversion is available when `magick` or a valid ImageMagick `convert` resolves on PATH.

## Verification flow

Run these checks before relying on the workstation install:

```bash
type -a liteparse lit
ls -l /opt/homebrew/bin/liteparse /opt/homebrew/bin/lit
liteparse --version
lit --version
liteparse parse --help
lit screenshot --help
lit glmocr-ocr-server --help
lit glmocr-pipeline --help
lit lmstudio-openai-adapter --help
lit lmstudio-ocr-server --help
lit lmstudio-ocr --help
lit lmstudio-ocr-pipeline --help
lit codex-ocr --help
lit codex-ocr-server --help
lit codex-ocr-pipeline --help
```

Expected authority shape:

- Source checkout: `/Users/arthur/dev-space/liteparse`
- Active command path: `/opt/homebrew/bin/liteparse`
- Local-source link target: `/Users/arthur/dev-space/liteparse/dist/src/index.js`
- Build command that updates the global symlink target: `npm run build`
- infra-ops role: `provider_utility`, not a SWE-agent front door

If `--version` differs from `package.json`, rebuild the source checkout:

```bash
cd /Users/arthur/dev-space/liteparse
npm run build
```

## Output-mode rules

- Prefer plain text output for quick reading or shell pipes.
- Prefer `--format json` when downstream automation needs `pages[].text`, `textItems`, coordinates, confidence, or `boundingBoxes`.
- Use `--no-ocr` for fast native PDF text extraction when scanned content is not required.
- Use OCR for scanned documents or image-heavy PDFs. Without `--ocr-server-url`, LiteParse uses built-in Tesseract.js.
- Use `cd ocr/glmocr && uv run server.py` when matching the official EasyOCR/PaddleOCR adapter style matters.
- Use `lit glmocr-ocr-server` when the user needs LiteParse to manage the GLM-OCR SDK service and LM Studio adapter lifecycle.
- Use `lit glmocr-pipeline` when the user needs official GLM-OCR SDK artifacts and PP-DocLayout bbox fidelity, not just `lit parse` output.
- Use `lit lmstudio-ocr-server` or `lit lmstudio-ocr-pipeline` for direct LM Studio model smoke tests and OCR/text artifacts where fallback line boxes are acceptable.
- Use `lit codex-ocr-server` when the user needs a LiteParse-compatible `/ocr` server backed by Codex multimodal OCR. Keep `POST /ocr` as baseline JSON and use `POST /ocr/analyze` for the full advanced artifact.
- Use `lit codex-ocr-pipeline` when the user needs page PNGs, Codex artifacts, LiteParse `/ocr` JSON, segmented assets, annotations, provenance, and `final/document.md`/`final/document.json` for agent QA.
- Treat Codex OCR bounding boxes as model-inferred visual localization evidence, not official layout-stage ground truth. Preserve `codex_bboxes_are_model_inferred` warning context and use `--strict-bbox` when unboxed regions should be dropped.
- Use `--target-pages` and `--max-pages` to bound cost on large files.

## Dependency checks

LiteParse is local-first, but some formats depend on external tools:

```bash
command -v magick
command -v tesseract
command -v libreoffice || command -v soffice
```

Current workstation expectation:

- ImageMagick is available for image conversion.
- Tesseract is available for OCR support.
- LibreOffice is not guaranteed; treat DOCX/XLSX/PPTX conversion as degraded until `libreoffice` or `soffice` is present.

## Environment variables

- `TESSDATA_PREFIX` points Tesseract.js to a directory containing pre-downloaded `.traineddata` files. Use it for offline OCR or controlled language data.
- `LITEPARSE_TMPDIR` overrides the temp directory used for format conversion and intermediate files. Use it for large documents, containerized runs, read-only filesystems, or when `/tmp` is too small.
- `LITEPARSE_LMSTUDIO_BASE_URL` sets the LM Studio base URL for GLM-OCR tooling. Defaults to `http://localhost:1234`.
- `LITEPARSE_GLM_OCR_MODEL` sets the LM Studio model identifier. Defaults to `glm-ocr-g32-mixed_4_8-mlx`.
- `LITEPARSE_LMSTUDIO_AUTO_LOAD=0` disables automatic `lms load`.
- `LITEPARSE_GLMOCR_OCR_API_URL` sets the model endpoint used by `ocr/glmocr/server.py`, usually LM Studio OpenAI-compatible `/v1/chat/completions` or the LiteParse `lmstudio-openai-adapter`.
- `LITEPARSE_GLMOCR_LAYOUT_DEVICE=cpu` forces PP-DocLayout to run on CPU, useful on Apple Silicon.
- `LITEPARSE_CODEX_HOME` overrides the Codex state directory used by Codex OCR commands. For live development and evals, prefer a temporary `HOME` with default `$HOME/.codex/auth.json` and omit the override unless the override path is what you are testing.
- Docker Codex OCR runs must mount `LITEPARSE_CODEX_HOME` with auth/config, or provide a Codex `model_provider` config. Current official Codex config documents custom providers with `wire_api = "responses"`; wrap Chat Completions-only endpoints with a Responses/Open Responses adapter before selecting them as the Codex provider.
- `LITEPARSE_CODEX_OCR_MODEL` sets the default Codex OCR model. Defaults to `gpt-5.5`; use a smaller model only for cheaper smoke tests.
- `LITEPARSE_CODEX_OCR_REASONING` sets the default Codex OCR reasoning effort. Single-image/server commands default to `medium`; `codex-ocr-pipeline` defaults to `high`.

Example:

```bash
TESSDATA_PREFIX=/opt/tessdata \
LITEPARSE_TMPDIR=/tmp/liteparse-work \
liteparse parse document.pdf --ocr-language eng --format json
```

Do not store document passwords, OCR service secrets, or private temp paths in infra-ops manifests.

## TypeScript library fallback

Prefer the CLI for ordinary parse, screenshot, and batch workflows. Switch to the TypeScript library when:

- the input is already a `Buffer` or `Uint8Array`;
- a fork-only option is not exposed as a CLI flag yet;
- a custom OCR API extension needs typed request/response handling;
- screenshots and parse results need to stay in memory for another Node process.

Minimal pattern:

```typescript
import { LiteParse } from "@zzwz/liteparse-vllm";

const parser = new LiteParse({
  ocrEnabled: true,
  ocrServerUrl: "http://localhost:8080/ocr",
  outputFormat: "json",
});
const result = await parser.parse("document.pdf");
console.log(result.json);
```

When changing the local fork under `/Users/arthur/dev-space/liteparse`, rebuild with `npm run build` before trusting CLI behavior.

## Source docs

Use these local docs for deeper context:

- `/Users/arthur/dev-space/liteparse/README.md`
- `/Users/arthur/dev-space/liteparse/AGENTS.md`
- `/Users/arthur/dev-space/liteparse/docs/src/content/docs/liteparse/index.md`
- `/Users/arthur/dev-space/liteparse/docs/src/content/docs/liteparse/cli-reference.md`
- `/Users/arthur/dev-space/liteparse/OCR_API_SPEC.md`
- `/Users/arthur/dev-space/liteparse/ocr/README.md`
