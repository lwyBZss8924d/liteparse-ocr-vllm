# LiteParse OCR vLLM - Agent Documentation

> This file provides comprehensive context for AI coding agents working on this codebase. Each subdirectory contains its own README with file-specific documentation.

## Fork Identity and Branch Discipline

This repository is an independent custom OCR fork of upstream `run-llama/liteparse`.

- Fork remote: `origin = https://github.com/lwyBZss8924d/liteparse-ocr-vllm.git`
- Upstream remote: `upstream = https://github.com/run-llama/liteparse.git`
- Custom branch: `custom/vllm-ocr-main`
- Upstream mirror branch: `main`
- Custom npm package: `@zzwz/liteparse-vllm`
- Current custom version pattern: upstream version plus custom suffix, for example `1.5.3-custom.0`

Keep `main` as an upstream mirror. Do not publish custom OCR releases from `main`; merge upstream `main` into `custom/vllm-ocr-main` and publish custom tags such as `custom-v1.5.3-ocr.0` only from the custom branch. When README, packaging, release, or CI identity changes, update this AGENTS.md file in the same change so future agents do not fall back to upstream assumptions.

## Project Overview

**LiteParse OCR vLLM** keeps LiteParse's fast local PDF parsing and spatial text extraction, then layers custom OCR tooling for GLM-OCR SDK pipelines, vLLM offline packaging, LM Studio diagnostics, Codex OCR diagnostics, and repo-versioned agent skills. Baseline parsing and built-in OCR remain local by default; Codex OCR is online/authenticated diagnostics and must be documented as such. Do not describe the GLM-OCR SDK dependency path as GPU-only; GPU applies to the optional vLLM release image/model-serving path, while local SDK development can run without that image.

### Key Capabilities
- **Spatial text extraction** with precise bounding boxes
- **Flexible OCR** (built-in Tesseract.js or pluggable HTTP servers)
- **Advanced OCR tooling** through GLM-OCR SDK, LM Studio, and Codex OCR wrappers
- **Offline delivery path** through `Dockerfile.glmocr-offline` and Linux x64 npm tgz packaging
- **Multi-format support** (PDFs, DOCX, XLSX, PPTX, images via conversion)
- **TypeScript/Node.js** with both library and CLI interfaces

## Directory Structure

```
liteparse/
├── src/
│   ├── core/           # Configuration, types, main orchestrator
│   ├── engines/        # Pluggable PDF and OCR engines
│   │   ├── pdf/        # PDF parsing engines (PDF.js, PDFium)
│   │   └── ocr/        # OCR engines and adapters (Tesseract, HTTP, GLM-OCR, LM Studio, Codex)
│   ├── processing/     # Text extraction and spatial analysis
│   ├── output/         # Output formatters (JSON, text)
│   ├── conversion/     # Multi-format conversion to PDF
│   ├── vendor/         # Bundled dependencies (PDF.js)
│   ├── index.ts        # CLI entry point
│   └── lib.ts          # Library public API
├── cli/                # CLI implementation
├── ocr/                # Example OCR server implementations
│   ├── easyocr/        # EasyOCR wrapper server
│   ├── glmocr/         # GLM-OCR SDK pipeline server docs
│   ├── lmstudio/       # LM Studio GLM-OCR wrapper server docs
│   └── paddleocr/      # PaddleOCR wrapper server
├── skills/             # Repo-versioned agent skills source and harness spec/projection contract
├── docker/             # Offline vLLM GLM-OCR entrypoint and smoke scripts
└── dist/               # Compiled JavaScript output
```

## Data Flow

1. **Input**: File path received (any supported format)
2. **Conversion** (if dependencies installed): Non-PDF formats converted to PDF via LibreOffice/ImageMagick
3. **PDF Loading**: PDF.js extracts text items, images, metadata
4. **OCR** (if enabled): Images rendered and OCR'd for text-sparse areas
5. **Grid Projection**: Spatial reconstruction of text layout using anchor system
6. **Post-processing**: Bounding boxes, text cleanup
7. **Output**: Formatted as JSON or plain text

## Key Design Decisions

### 1. Engine Abstraction Pattern
Both PDF and OCR functionality use interface-based abstraction (`PdfEngine`, `OcrEngine`). This allows:
- Swapping implementations without changing core logic
- Auto-detection: HTTP OCR if URL provided, otherwise Tesseract.js
- Future extensibility for new engines
- Future possibility of custom conversion engines for non-PDF formats

### 2. Spatial Grid Projection
The most complex (and important!) part of the codebase (`src/processing/gridProjection.ts`, ~1650 lines). Uses:
- **Anchor-based layout**: Tracks text alignment (left, right, center, floating)
- **Forward anchors**: Carry alignment information between lines
- **Column detection**: Identifies multi-column layouts
- **Rotation handling**: Transforms 90°, 180°, 270° rotated text to correct reading order
- **OCR merging**: Combines native PDF text with OCR results, preserving confidence scores and source flags in output

### 3. Selective OCR
OCR only runs on embedded images where text extraction failed, not the entire document. This balances accuracy with performance.

### 4. Configuration Merging
Uses a default-first approach where users only override what they need. Configuration flows: defaults → file config → CLI options.

### 5. Format Conversion via External Tools
Rather than implementing format parsers, LiteParse converts non-PDF formats using system tools (LibreOffice, ImageMagick) into a single format (PDF). This provides broad format support with minimal code.

### 6. Codex OCR Diagnostics Boundary
Codex OCR is implemented in `src/engines/ocr/codex.ts` and `src/engines/ocr/codex-server.ts`, with CLI wiring in `cli/codex-ocr.ts`.

- `codex.ts` owns Codex SDK/app-server invocation, prompt/schema handling, raw response preservation, and conversion from advanced artifacts into OCR results.
- `codex-server.ts` owns HTTP serving for `GET /health`, multipart `POST /ocr`, and multipart `POST /ocr/analyze`.
- `POST /ocr` must keep the LiteParse OCR contract: multipart `file`, optional `language`, and JSON `results[].text`, `results[].bbox`, `results[].confidence`.
- `POST /ocr/analyze` may return the richer Codex artifact: Markdown, page metadata, layout regions, assets, annotations, conversion metadata, model provenance, and warnings.
- Codex bounding boxes are model-inferred visual localization evidence, not official layout-detector boxes. Preserve `codex_bboxes_are_model_inferred` warnings and keep `--strict-bbox` behavior available.
- Live development and tests should prefer a temporary `HOME` that contains
  `$HOME/.codex/auth.json` and optional `$HOME/.codex/config.toml`; omit
  `--codex-home` unless the test is explicitly validating override behavior.

### 7. Custom Packaging and CI
The custom npm package is `@zzwz/liteparse-vllm`, not `@llamaindex/liteparse`. Build with `tsconfig.build.json` so test files are not emitted into `dist`, and prune dev dependencies before producing a release-grade Linux x64 offline tgz. The npm package should include Node CLI/runtime dependencies and OCR adapter source/docs; do not put GLM model weights, Python GPU wheels, `.venv`, local benchmarks, or model caches into npm.

The Docker image uses `codex` as its default OCR profile and exposes `codex-ocr-server` on port `8833`; keep `glmocr-vllm` as an explicit GPU/vLLM profile. Docker docs must state that Codex OCR needs `LITEPARSE_CODEX_HOME` with auth/config, or a mounted Codex `config.toml` with a custom `model_provider`. Current official Codex config documents custom providers with `wire_api = "responses"` only; do not claim direct Chat Completions provider support unless the pinned Codex config schema documents it.

CI must cover the custom branch as well as upstream mirror work. Keep `.github/workflows/ci.yml` aligned with the custom branch, and include source-level skill harness validation in CI. CI should not run `npm run sync:agent-skills`, because that writes user-level projections outside the repository; use source-only validation there.

## Common Tasks

### Adding a New Output Format
1. Create new file in `src/output/` implementing the formatter
2. Add format option to `cli/parse.ts`
3. Update `src/core/parser.ts` to use new formatter

### Adding a New OCR Engine
1. Implement `OcrEngine` interface in `src/engines/ocr/`
2. Add initialization logic in `src/core/parser.ts`
3. Add configuration options in `src/core/types.ts`

### Modifying Text Extraction Logic
The processing pipeline is in `src/processing/`. Key files:
- `gridProjection.ts` - Layout reconstruction (most complex)
- `bbox.ts` - Bounding box calculation
- `cleanText.ts` - Text cleanup

### Adding CLI Options
1. Update `cli/parse.ts` with new Commander.js option
2. Add corresponding config field in `src/core/types.ts`
3. Update `src/core/config.ts` with default value
4. Use the option in `src/core/parser.ts`

### Adding Advanced OCR Tooling
GLM-OCR and Codex support are implemented as custom CLI/server tooling, not as replacements for the baseline OCR contract.

1. Keep `POST /ocr` compatible with `OCR_API_SPEC.md`: multipart `file`, optional `language`, and JSON `{ results: [{ text, bbox, confidence }] }`.
2. Use `lit glmocr-ocr-server` or `lit glmocr-pipeline` for official GLM-OCR SDK layout bboxes. These boxes must come from PP-DocLayout/SDK output, not prompt-inferred whole-page LM Studio text.
3. Keep `lit lmstudio-ocr`, `lit lmstudio-ocr-server`, and `lit lmstudio-ocr-pipeline` as direct LM Studio tooling for lightweight OCR/model smoke tests; mark fallback line boxes as degraded.
4. If LM Studio runs locally and the model is installed but not loaded, the tooling may run `lms load <model> --identifier <model> -y`; keep `--no-auto-load` available for fail-fast operation.
5. Keep `lit codex-ocr`, `lit codex-ocr-server`, and `lit codex-ocr-pipeline` as online/authenticated diagnostics. Use a temporary `HOME` with default `$HOME/.codex/auth.json` for live tests and make `/health` report whether auth/config are readable.
6. Treat model output as untrusted OCR evidence. Preserve raw responses and warnings in advanced artifacts instead of changing the LiteParse `/ocr` response shape.

### Updating LiteParse Agent Skills
The repo source authority for the custom `lit` CLI skills is `skills/liteparse-cli-tools-custom-collection`. Do not edit `/Users/arthur/.agents/skills/liteparse-cli-tools-custom-collection` directly except through the sync script; that path is the validated installed runtime projection. Do not add repo-local `./.agents/skills` or `./.codex/skills` for this collection because those paths can auto-load runtime skills during development sessions.

When changing the skills, keep the CLI, docs, and OCR contract synchronized:

1. Edit `skills/liteparse-cli-tools-custom-collection/**`.
2. Update relevant docs such as `OCR_API_SPEC.md`, `README.md`, `cli/README.md`, `ocr/README.md`, or `src/engines/ocr/README.md`.
3. Run `npm run validate:agent-skills`.
4. Run `npm run sync:agent-skills:dry-run`.
5. Run `npm run sync:agent-skills` after the dry-run is clean.

### Updating the Skills Harness and Projections
`skills/harness/liteparse-cli-skills.spec.json` is the maintained contract for the custom skills collection and its projections. When changing CLI commands, OCR docs, AGENTS.md, CI, or skill text, update this spec so `scripts/validate-liteparse-cli-skills.mjs` catches drift.

Use this local sequence for source and projection maintenance:

1. `npm run build`
2. `npm run validate:agent-skills:source`
3. `npm run sync:agent-skills:dry-run`
4. `npm run sync:agent-skills`
5. `npm run validate:agent-skills`

In CI, use source-only validation and avoid projection writes:

```bash
npm run validate:agent-skills:source -- --skip-cli
```

Projection targets are expected to point at the installed runtime projection under `~/.agents/skills/liteparse-cli-tools-custom-collection`; keep `.codex`, `.codex`, `.claude`, Forge, and Gemini projections aligned through `scripts/sync-liteparse-cli-skills.mjs`, not manual edits.

## Knowledge And Skills

### Skills For Real Engineers Codex Plugin

<REAL_ENGINEERS_CODEX_PLUGIN_SKILLS>
- **Collection**: `mattpocock-skills`
- **Plugin source**: `~/dev-space/mattpocock/skills/plugins/mattpocock-skills`
- **Use `mattpocock-skills:setup-matt-pocock-skills`** before repo-local use of issue, PRD, triage, diagnosis, TDD, architecture, or zoom-out workflows when project issue-tracker/domain-doc assumptions are not already configured.

Engineering:
- `mattpocock-skills:diagnose`
- `mattpocock-skills:grill-with-docs`
- `mattpocock-skills:improve-codebase-architecture`
- `mattpocock-skills:prototype`
- `mattpocock-skills:setup-matt-pocock-skills`
- `mattpocock-skills:tdd`
- `mattpocock-skills:to-issues`
- `mattpocock-skills:to-prd`
- `mattpocock-skills:triage`
- `mattpocock-skills:zoom-out`

Productivity:
- `mattpocock-skills:caveman`
- `mattpocock-skills:grill-me`
- `mattpocock-skills:handoff`
- `mattpocock-skills:write-a-skill`

Misc:
- `mattpocock-skills:git-guardrails-claude-code`
- `mattpocock-skills:migrate-to-shoehorn`
- `mattpocock-skills:scaffold-exercises`
- `mattpocock-skills:setup-pre-commit`
</REAL_ENGINEERS_CODEX_PLUGIN_SKILLS>

## Testing Approach

Use focused automated checks for changed surfaces:

- `npm run build`
- `npm test`
- `npm run lint`
- `npm run format:check`
- `npm run validate:agent-skills:source`
- `npm run sync:agent-skills:dry-run`
- `npm run validate:agent-skills`
- `npm run smoke:offline-npm-tgz`
- `python3 -m py_compile ocr/glmocr/server.py ocr/glmocr/test_server.py`
- `uv run pytest test_server.py` from `ocr/glmocr/`
- `bash -n docker/glmocr-offline/entrypoint.sh docker/glmocr-offline/offline-smoke.sh`
- `docker buildx build --check -f Dockerfile.glmocr-offline .`

For release-grade offline npm tgz validation, build inside Linux x64, prune dev dependencies, pack, then install the tgz in `node:24-trixie-slim --network=none` and run `lit --version`, `liteparse --version`, and a `lit parse <small.pdf> --no-ocr --format json` smoke.

Full vLLM offline image validation requires a Linux x64 NVIDIA GPU host. This does not apply to the local GLM-OCR SDK/uv development path, which can run without the vLLM image. Do not claim the Docker image tar is release-validated from macOS/OrbStack or another non-GPU environment.

## Key Dependencies

| Dependency | Purpose |
|------------|---------|
| `pdfjs-dist` | PDF parsing and text extraction |
| `@hyzyla/pdfium` | High-quality PDF rendering for screenshots |
| `tesseract.js` | In-process OCR (zero setup) |
| `sharp` | Image processing |
| `commander` | CLI framework |
| `zod` | Schema validation |
| `@openai/codex-sdk` | Codex OCR diagnostic backend |

## Entry Points

- **CLI**: `src/index.ts` → `cli/parse.ts`
- **Codex OCR CLI**: `cli/codex-ocr.ts`
- **Library**: `src/lib.ts` exports `LiteParse` class and types
- **Main Class**: `src/core/parser.ts` contains `LiteParse` orchestrator
- **Codex OCR Core**: `src/engines/ocr/codex.ts`
- **Codex OCR Server**: `src/engines/ocr/codex-server.ts`
- **Skills Harness**: `skills/harness/liteparse-cli-skills.spec.json`
- **Skills Validation/Sync**: `scripts/validate-liteparse-cli-skills.mjs`, `scripts/sync-liteparse-cli-skills.mjs`

## Related Documentation

These files are key to understanding the codebase and should be referenced for specific implementation details.

If changes to the codebase are being made, please update the relevant documentation files to reflect those changes and keep them up to date.

- [User-facing documentation](README.md)
- [src/conversion/README.md](src/conversion/README.md) - Format conversion details
- [src/core/README.md](src/core/README.md) - Core architecture and configuration
- [src/engines/README.md](src/engines/README.md) - Engine abstraction and implementations
  - [src/engines/pdf/README.md](src/engines/pdf/README.md) - PDF engines (PDF.js, PDFium)
  - [src/engines/ocr/README.md](src/engines/ocr/README.md) - OCR engines (Tesseract, HTTP)
- [src/output/README.md](src/output/README.md) - Output formatters
- [src/processing/README.md](src/processing/README.md) - Text extraction and spatial processing
- [ocr/README.md](ocr/README.md) - OCR server implementations (EasyOCR, PaddleOCR)
- [cli/README.md](cli/README.md) - CLI usage and options
- [skills/harness/liteparse-cli-skills.spec.json](skills/harness/liteparse-cli-skills.spec.json) - Skills validation and projection contract
