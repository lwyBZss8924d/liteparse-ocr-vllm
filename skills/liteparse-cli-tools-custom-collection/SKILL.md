---
name: liteparse-cli-tools-custom-collection
description: Custom collection for LiteParse CLI agent workflows. Use for progressive discovery of LiteParse document parsing, JSON/text extraction, bounding-box output, PDF screenshots, batch parsing, OCR server integration, GLM-OCR SDK advanced OCR pipelines, Codex OCR multimodal server/pipeline workflows, and local-source CLI governance on this workstation.
---

# LiteParse CLI Tools Skills Collection

Custom collection for LiteParse CLI workflows backed by the local source tree at `~/dev-space/liteparse`.

The local fork also exposes GLM-OCR SDK pipeline tooling, LM Studio direct GLM-OCR tooling, and Codex OCR tooling for Custom HTTP OCR server workflows and advanced layout/table/formula/page-understanding artifacts.

This workstation treats the local fork as the governed AI-first CLI source: `/opt/homebrew/bin/liteparse` and `/opt/homebrew/bin/lit` are symlinked to `/Users/arthur/dev-space/liteparse/dist/src/index.js`. Rebuild the source checkout with `npm run build` before relying on newly added commands.

## Source authority and projection

The repo-versioned source for this collection is `/Users/arthur/dev-space/liteparse/skills/liteparse-cli-tools-custom-collection`. Treat `/Users/arthur/.agents/skills/liteparse-cli-tools-custom-collection` as the validated installed runtime projection, not as the edit source.

Do not create repo-local `./.agents/skills` or `./.codex/skills` for this collection; those paths have runtime auto-load semantics in LiteParse development sessions. Use `npm run validate:agent-skills`, `npm run sync:agent-skills:dry-run`, and `npm run sync:agent-skills` from the repo root to validate and publish changes to the installed copy and downstream projections.

## Skills

- `liteparse-cli-discovery` - Choose the right LiteParse command, alias, output mode, and dependency check for an agent task.
- `liteparse-cli-pipelines` - Run reusable parse, screenshot, JSON extraction, and batch parsing shell patterns.
- `liteparse-ocr-server` - Use the LiteParse HTTP OCR server contract with `--ocr-server-url`.
  - GLM-OCR SDK pipeline commands:
    - `cd ocr/glmocr && uv run server.py` starts the official-style uv-managed Python OCR service matching EasyOCR/PaddleOCR adapter conventions.
    - `lit glmocr-ocr-server` starts a LiteParse-compatible `/ocr` server on `127.0.0.1:8831` using official GLM-OCR SDK layout bboxes.
    - `lit glmocr-pipeline -p <path> -o <dir>` renders documents/pages and writes GLM-OCR SDK artifacts plus LiteParse `/ocr` JSON.
    - `lit lmstudio-openai-adapter` exposes LM Studio native `/api/v1/chat` as OpenAI-compatible `/v1/chat/completions` for SDK runtimes.
  - LM Studio direct GLM-OCR commands:
    - `lit lmstudio-ocr-server` starts a LiteParse-compatible `/ocr` server on `127.0.0.1:8830`.
    - `lit lmstudio-ocr <image>` runs one image/crop through LM Studio.
    - `lit lmstudio-ocr-pipeline -p <path> -o <dir>` renders documents/pages and writes GLM-OCR artifacts.
  - Codex OCR commands:
    - `lit codex-ocr-server` starts a LiteParse-compatible `/ocr` server on `127.0.0.1:8833` backed by OpenAI Codex multimodal OCR.
    - `lit codex-ocr <image>` runs one image/crop through Codex and writes a normalized page artifact.
    - `lit codex-ocr-pipeline -p <path> -o <dir>` renders documents/pages and writes page PNGs, Codex artifacts, LiteParse `/ocr` JSON, segmented assets, annotations, and final Markdown/JSON.

## Workflow

Use this collection when the user is working with `liteparse` or `lit`, wants local document parsing for agent workflows, needs PDF screenshots, needs structured parse output with bounding boxes, or wants GLM-OCR or Codex OCR exposed as a LiteParse Custom HTTP OCR server. Prefer `glmocr-ocr-server`/`glmocr-pipeline` when official GLM-OCR SDK layout bboxes are required; use `lmstudio-ocr*` direct commands for lightweight model smoke tests or OCR/text artifacts; use `codex-ocr-server`/`codex-ocr-pipeline` when agentic multimodal page understanding, final Markdown, page metadata, layout regions, segmented assets, annotations, and provenance matter. Prefer these subskills over generic document parsing advice because this workstation uses a governed local-source npm-link install rooted at `~/dev-space/liteparse`.

Readiness stance: `ocr/glmocr` is a formal optional advanced OCR backend, not the default OCR backend. It is API-compatible with `OCR_API_SPEC.md`, follows the same service pattern as `ocr/easyocr` and `ocr/paddleocr`, and is backed by Pumpkin Book LLPAB deterministic-suite evidence. `codex-ocr-server` is also API-compatible with the baseline `/ocr` contract and exposes `POST /ocr/analyze` for richer agent artifacts, but its visual localization boxes are model-inferred evidence and should be reported with the `codex_bboxes_are_model_inferred` warning context. Both advanced paths should still be described as experimental for exact LaTeX normalization and chart/diagram semantics.

Known evidence from the local Pumpkin Book 10-page eval:

- GLM-OCR SDK pipeline produced 91 regions and 89 bbox-backed regions.
- Table recovery improved to OmniDocBench table TEDS `0.9167`.
- Formula CDM improved to `0.3502`.
- Native LiteParse and GLM-OCR SDK pipeline both ran through LLPAB deterministic-suite.
- Direct `lmstudio-ocr` prompt modes are diagnostic only; direct layout/table/diagram modes produced structure warnings and should not be promoted as the official structured pipeline.
- Codex OCR DeepSeek-V4 diagnostic eval improved from 260/290 (`89.66%`) with Markdown-only final artifacts to 281/290 (`96.90%`) after adding the LiteParse structured OCR context section to `final/document.md`. Treat this as local model-generated eval evidence, not human gold.
