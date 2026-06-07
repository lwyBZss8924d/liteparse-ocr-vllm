# LiteParse V2 Custom Node.js

Node.js/TypeScript bindings for the custom LiteParse V2 fork. The package name is `@zzwz/liteparse-vllm`, currently `2.0.6-custom.0`, and the Rust/napi core remains close to upstream LiteParse `crates-v2.0.6`.

## Installation

```bash
npm i @zzwz/liteparse-vllm
```

This also installs the `lit` CLI command (use `npm i -g` for global access).

## Quick Start

```typescript
import { LiteParse } from '@zzwz/liteparse-vllm';

const parser = new LiteParse();
const result = await parser.parse('document.pdf');
console.log(result.text);

// Access structured data
for (const page of result.pages) {
  console.log(`Page ${page.pageNum}: ${page.textItems.length} text items`);
}
```

## Configuration

All options are passed to the constructor:

```typescript
const parser = new LiteParse({
  ocrEnabled: true,              // Enable OCR (default: true)
  ocrLanguage: 'eng',           // Tesseract language code
  ocrServerUrl: undefined,       // HTTP OCR server URL (optional)
  ocrTimeoutMs: 60000,           // HTTP OCR request timeout
  tessdataPath: undefined,       // Path to tessdata directory (optional)
  maxPages: 1000,                // Max pages to parse
  targetPages: '1-5,10',        // Specific pages (optional)
  dpi: 150,                      // Rendering DPI
  preserveVerySmallText: false,  // Keep tiny text
  password: undefined,           // Password for protected documents
  quiet: false,                  // Suppress progress output
  numWorkers: 4,                 // Concurrent OCR workers
});
```

## Parsing from Bytes

Pass a `Buffer` or `Uint8Array` directly — useful for HTTP responses or in-memory data:

```typescript
import { readFile } from 'fs/promises';

const pdfBytes = await readFile('document.pdf');
const result = await parser.parse(pdfBytes);
console.log(result.text);
```

## Screenshots

Generate PNG screenshots of document pages:

```typescript
const screenshots = parser.screenshot('document.pdf', [1, 2, 3]);
for (const s of screenshots) {
  console.log(`Page ${s.pageNum}: ${s.width}x${s.height}`);
  // s.imageBuffer contains PNG bytes
}
```

## Supported Formats

- PDF (`.pdf`)
- Microsoft Office (`.docx`, `.xlsx`, `.pptx`, etc.) — requires LibreOffice
- OpenDocument (`.odt`, `.ods`, `.odp`) — requires LibreOffice
- Images (`.png`, `.jpg`, `.tiff`, etc.) — requires ImageMagick
- And more!

## CLI

The npm package includes the `lit` CLI:

```bash
lit parse document.pdf
lit parse document.pdf --format json -o output.json
lit screenshot document.pdf -o ./screenshots
lit batch-parse ./input ./output
```

## Custom Codex SDK OCR Server

This package adds an optional Codex SDK OCR server while keeping the normal LiteParse HTTP OCR contract. The Codex path is online/authenticated, uses `@openai/codex-sdk`, and is intended for OCR diagnostics or model-backed OCR where the local parser or built-in OCR is not enough.

Live tests in this fork use `~/.codex-test` as the Codex home root:

```bash
node dist/cli.js codex-ocr-server \
  --host 127.0.0.1 \
  --port 8833 \
  --codex-home "$HOME/.codex-test"
```

or:

```bash
LITEPARSE_CODEX_HOME="$HOME/.codex-test" node dist/cli.js codex-ocr-server
```

The server provides:

- `GET /health`
- `POST /ocr`
- `POST /ocr/analyze`

`POST /ocr` stays LiteParse-compatible:

```json
{
  "results": [
    {
      "text": "recognized text",
      "bbox": [0, 0, 100, 20],
      "confidence": 0.95
    }
  ],
  "engine": "codex-ocr",
  "backend": "sdk",
  "model": "gpt-5.5",
  "warnings": ["codex_bboxes_are_model_inferred"]
}
```

Use it through the standard parser option:

```bash
node dist/cli.js parse ../../integration_tests_data/receipt.png \
  --ocr-server-url http://127.0.0.1:8833/ocr \
  --ocr-timeout-ms 300000 \
  --format json
```

`POST /ocr/analyze` returns the full Codex OCR artifact with Markdown, page metadata, layout regions, assets, annotations, conversion metadata, model provenance, and warnings. Codex bounding boxes are model-inferred visual localization evidence, not deterministic layout-detector output.
