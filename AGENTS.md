# LiteParse V2 Custom Codex OCR - Agent Documentation

> This file provides comprehensive context for AI coding agents working on this codebase.

## Fork Identity and Branch Discipline

This repository is an independent custom OCR fork of upstream `run-llama/liteparse`.

- Fork remote: `origin = https://github.com/lwyBZss8924d/liteparse-ocr-vllm.git`
- Upstream remote: `upstream = https://github.com/run-llama/liteparse.git`
- Upstream V2 baseline: `crates-v2.0.6` / `upstream/main@314a4df`
- Custom V2 branch: `custom/liteparse-vllm-v2`
- Custom npm package: `@zzwz/liteparse-vllm`
- Current V2 custom version: `2.0.6-custom.0`
- MVP custom scope: Codex SDK OCR server only

Keep the V2 Rust core close to upstream. Do not port the old TypeScript parser/core from `1.5.3-custom.1` into this branch. For this V2 MVP, defer GLM-OCR, LM Studio, vLLM Docker/offline packaging, Python package customization, WASM customization, and the custom native optional package matrix unless explicitly requested.

## Project Overview

**LiteParse V2 Custom Codex OCR** is a custom Node package fork over upstream LiteParse V2. The baseline parser is an open-source PDF parsing library written in **Rust**, focused on fast, lightweight document processing with spatial text extraction. It runs locally by default.

The custom Node package adds `lit codex-ocr` and `lit codex-ocr-server`, backed by `@openai/codex-sdk`. Codex OCR is online/authenticated diagnostics and must be documented as such.

Language bindings are provided for **Node.js/TypeScript** (via napi-rs), **Python** (via PyO3), and **WebAssembly** (via wasm-bindgen).

### Key Capabilities
- **Spatial text extraction** with precise bounding boxes
- **Flexible OCR** (built-in Tesseract or pluggable HTTP servers)
- **Multi-format support** (PDFs, DOCX, XLSX, PPTX, images via conversion)
- **Multi-language bindings**: Rust, Node.js/TypeScript, Python, Browser (WASM)
- **CLI** available from all installation methods (`cargo`, `npm`, `pip`)

## Directory Structure

```
liteparse/
├── crates/
│   ├── liteparse/          # Core Rust library + CLI binary
│   │   └── src/
│   │       ├── main.rs         # CLI entry point (clap)
│   │       ├── lib.rs          # Library root
│   │       ├── parser.rs       # LiteParse orchestrator
│   │       ├── config.rs       # Configuration types and defaults
│   │       ├── types.rs        # Core data types (ParseResult, TextItem, etc.)
│   │       ├── projection.rs   # Spatial grid projection (layout reconstruction)
│   │       ├── extract.rs      # Raw text extraction from PDFium
│   │       ├── render.rs       # Page rendering / screenshots
│   │       ├── conversion.rs   # Non-PDF format conversion (LibreOffice, ImageMagick)
│   │       ├── ocr_merge.rs    # Merging OCR results with native text
│   │       ├── error.rs        # Error types
│   │       ├── ocr/            # OCR engine implementations
│   │       │   ├── mod.rs          # OcrEngine trait
│   │       │   ├── tesseract.rs    # Built-in Tesseract OCR
│   │       │   └── http_simple.rs  # HTTP OCR server client
│   │       └── output/         # Output formatters
│   │           ├── mod.rs
│   │           ├── json.rs
│   │           └── text.rs
│   ├── liteparse-napi/     # Node.js bindings (napi-rs)
│   ├── liteparse-python/   # Python bindings (PyO3 / maturin)
│   ├── liteparse-wasm/     # WASM bindings (wasm-bindgen)
│   ├── pdfium/             # Rust wrapper around PDFium C API
│   └── pdfium-sys/         # PDFium FFI (C → Rust) bindings
├── packages/
│   ├── node/               # npm package: TS wrapper + CLI around native binary
│   │   └── src/
│   │       ├── lib.ts          # Public LiteParse class for Node.js
│   │       ├── cli.ts          # CLI entry point (commander)
│   │       ├── native.ts       # Native binary loader
│   │       └── codex-ocr/      # Custom Codex SDK OCR CLI/server
│   ├── python/             # PyPI package: Python wrapper around native binary
│   │   └── liteparse/
│   │       ├── __init__.py
│   │       ├── parser.py       # Public LiteParse class for Python
│   │       ├── types.py        # Python dataclass types
│   │       └── cli.py          # CLI entry point
│   └── wasm/               # WASM npm package
├── ocr/                    # Example OCR server implementations
│   ├── easyocr/            # EasyOCR wrapper server
│   └── paddleocr/          # PaddleOCR wrapper server
└── Cargo.toml              # Workspace root
```

## Data Flow

1. **Input**: File path or raw bytes received (any supported format)
2. **Conversion** (if needed): Non-PDF formats converted to PDF via LibreOffice/ImageMagick
3. **PDF Loading**: PDFium extracts text items, images, metadata
4. **OCR** (if enabled): Pages rendered and OCR'd for text-sparse areas
5. **Grid Projection**: Spatial reconstruction of text layout using anchor system
6. **Post-processing**: Bounding boxes, text cleanup
7. **Output**: Formatted as JSON or plain text

## Key Design Decisions

### 1. Rust Core with Language Bindings
The core parsing logic is written in Rust for performance and safety. Language-specific crates expose the same API surface:
- `liteparse-napi` → Node.js via napi-rs
- `liteparse-python` → Python via PyO3/maturin
- `liteparse-wasm` → Browser via wasm-bindgen

Each binding crate is thin — it wraps the core `liteparse` crate's types and async API.

### 2. OCR Engine Trait
OCR functionality uses a trait-based abstraction (`OcrEngine`). This allows:
- Built-in Tesseract (default, compiled in via `tesseract-rs`)
- HTTP OCR server client for remote engines
- Custom JS-side OCR in the WASM build via a callback interface

### 3. Spatial Grid Projection
The most complex (and important!) part of the codebase (`crates/liteparse/src/projection.rs`). Uses:
- **Anchor-based layout**: Tracks text alignment (left, right, center, floating)
- **Forward anchors**: Carry alignment information between lines
- **Column detection**: Identifies multi-column layouts
- **Rotation handling**: Transforms 90°, 180°, 270° rotated text to correct reading order
- **OCR merging**: Combines native PDF text with OCR results, preserving confidence scores and source flags in output

### 4. Selective OCR
OCR only runs on embedded images where text extraction failed, not the entire document. This balances accuracy with performance.

### 5. Configuration
Uses a default-first approach where users only override what they need. See `crates/liteparse/src/config.rs` for defaults.

### 6. Format Conversion via External Tools
Rather than implementing format parsers, LiteParse converts non-PDF formats using system tools (LibreOffice, ImageMagick) into PDF. This provides broad format support with minimal code.

### 7. Codex OCR Diagnostics Boundary

Codex OCR is implemented under `packages/node/src/codex-ocr/`.

- `codex.ts` owns Codex SDK invocation, prompt/schema handling, raw response preservation, and conversion from advanced artifacts into LiteParse OCR results.
- `server.ts` owns HTTP serving for `GET /health`, multipart `POST /ocr`, and multipart `POST /ocr/analyze`.
- `cli.ts` owns `lit codex-ocr` and `lit codex-ocr-server` registration.
- `POST /ocr` must keep the LiteParse OCR contract: multipart `file`, optional `language`, and JSON `results[].text`, `results[].bbox`, `results[].confidence`.
- `POST /ocr/analyze` may return the richer Codex artifact: Markdown, page metadata, layout regions, assets, annotations, conversion metadata, model provenance, and warnings.
- Codex bounding boxes are model-inferred visual localization evidence, not deterministic layout-detector boxes. Preserve `codex_bboxes_are_model_inferred` warnings and keep `--strict-bbox` behavior available.
- This V2 MVP is SDK-only. Do not reintroduce the old `app-server` backend or `codex-ocr-pipeline` unless explicitly requested after the basic server remains passing.

Live development and tests should use the isolated Codex test home:

```bash
LITEPARSE_CODEX_HOME="$HOME/.codex-test"
```

or:

```bash
--codex-home "$HOME/.codex-test"
```

Treat `$HOME/.codex-test` as the Codex home root containing `auth.json` and `config.toml`, not as a parent that contains `.codex/`. Do not print, copy into tracked files, package, or document the contents of those files.

## Common Tasks

### Adding a New Output Format
1. Create new file in `crates/liteparse/src/output/`
2. Add variant to `OutputFormat` enum in `config.rs`
3. Wire it up in `main.rs` and binding crates

### Adding a New OCR Engine
1. Implement `OcrEngine` trait in `crates/liteparse/src/ocr/`
2. Add initialization logic in `parser.rs`
3. Add configuration options in `config.rs`

### Modifying Text Extraction Logic
Key files in `crates/liteparse/src/`:
- `projection.rs` — Layout reconstruction (most complex)
- `extract.rs` — Raw text item extraction from PDFium
- `ocr_merge.rs` — Merging OCR and native text

### Adding CLI Options
1. Add field to `LiteParseConfig` in `config.rs`
2. Add clap arg in `main.rs`
3. Wire through `parser.rs`
4. Expose in binding crates (`liteparse-napi`, `liteparse-python`, `liteparse-wasm`)

### Adding / Modifying Node.js Wrapper
- Edit `packages/node/src/lib.ts` for library API changes
- Edit `packages/node/src/cli.ts` for CLI changes
- The native binary interface is defined in `packages/node/src/native.ts`
- Edit `packages/node/src/codex-ocr/**` for the custom Codex SDK OCR CLI/server. Keep this SDK-only for the V2 MVP.

### Adding / Modifying Python Wrapper
- Edit `packages/python/liteparse/parser.py` for library API changes
- Types are in `packages/python/liteparse/types.py`
- CLI entry point is `packages/python/liteparse/cli.py`

## Key Dependencies

| Dependency | Purpose |
|------------|---------|
| `pdfium` (C library) | PDF text extraction and rendering |
| `tesseract-rs` | Built-in OCR engine (optional, via `tesseract` feature) |
| `clap` | CLI framework |
| `serde` / `serde_json` | Serialization |
| `tokio` | Async runtime |
| `reqwest` | HTTP client (for OCR server) |
| `image` | Image processing (PNG encoding) |
| `napi-rs` | Node.js native bindings |
| `pyo3` / `maturin` | Python native bindings |
| `wasm-bindgen` | WASM bindings |
| `@openai/codex-sdk` | Custom Node Codex OCR diagnostic backend |
| `busboy` | Multipart upload handling for the custom Codex OCR server |
| `sharp` | Image normalization for Codex OCR input |

## Entry Points

- **Rust CLI**: `crates/liteparse/src/main.rs`
- **Rust Library**: `crates/liteparse/src/lib.rs` → `parser.rs` contains `LiteParse` struct
- **Node.js**: `packages/node/src/lib.ts` exports `LiteParse` class
- **Codex OCR CLI/Server**: `packages/node/src/codex-ocr/`
- **Python**: `packages/python/liteparse/parser.py` exports `LiteParse` class
- **WASM**: `crates/liteparse-wasm/` exposes `LiteParse` via wasm-bindgen

## Related Documentation

- [User-facing documentation](README.md)
- [OCR API Specification](OCR_API_SPEC.md)
- [WASM package README](packages/wasm/README.md)
- [Python package README](packages/python/README.md)
- [OCR server examples](ocr/README.md)
