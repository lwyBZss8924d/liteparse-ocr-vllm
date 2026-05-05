# LiteParse Python

Python wrapper for [LiteParse](https://github.com/run-llama/liteparse) - fast, lightweight document parsing with optional OCR.

> **Important:** This package is a Python wrapper around the LiteParse Node.js CLI.
> You must have **Node.js** (>= 18) installed on your system. The CLI will be auto-installed
> via npm on first use if not already present, or you can install it manually beforehand.

## Installation

### Step 1: Install Node.js

LiteParse requires Node.js (>= 18). Install it from [nodejs.org](https://nodejs.org/) or via your package manager.

### Step 2: Install the LiteParse CLI

```bash
npm install -g @zzwz/liteparse-vllm
```

### Step 3: Install the Python package

```bash
pip install liteparse
```

> **Note:** If you skip Step 2, the Python package will attempt to auto-install the CLI
> via `npm install -g @zzwz/liteparse-vllm` on first use (requires npm in your PATH).

## Quick Start

```python
from liteparse import LiteParse

# Create parser
parser = LiteParse()

# Parse a document
result = parser.parse("document.pdf")
print(result.text)

# Access structured data
for page in result.pages:
    print(f"Page {page.pageNum}: {len(page.textItems)} text items")
```

## Configuration

All parsing options are passed per-call to `parse()`:

```python
from liteparse import LiteParse

parser = LiteParse()

result = parser.parse(
    "document.pdf",
    ocr_enabled=False,
    max_pages=10,
    dpi=150,
    preserve_very_small_text=True,
)
print(result.text)
```

## Parsing from bytes

If you already have file contents in memory (e.g. from a web upload), pass them directly:

```python
with open("document.pdf", "rb") as f:
    pdf_bytes = f.read()

result = parser.parse(pdf_bytes)
print(result.text)
```

## Batch Processing

For parsing multiple files, batch mode is significantly faster as it reuses the PDF engine:

```python
from liteparse import LiteParse

parser = LiteParse()

# Parse all documents in a directory
result = parser.batch_parse(
    input_dir="./documents",
    output_dir="./output",
    ocr_enabled=False,
    recursive=True,              # Include subdirectories
    extension_filter=".pdf",     # Only PDF files
)

print(f"Output written to: {result.output_dir}")
```

## Supported Formats

- PDF (`.pdf`)
- Microsoft Office (`.docx`, `.xlsx`, `.pptx`, etc.) - requires LibreOffice
- OpenDocument (`.odt`, `.ods`, `.odp`) - requires LibreOffice
- Images (`.png`, `.jpg`, `.tiff`, etc.) - requires ImageMagick
- And more!

## Performance Tips

1. **Disable OCR** if your documents have selectable text:
   ```python
   result = parser.parse("doc.pdf", ocr_enabled=False)
   ```

2. **Use batch mode** for multiple files to avoid cold-start overhead:
   ```python
   parser.batch_parse("./input", "./output")
   ```

3. **Limit pages** if you only need specific pages:
   ```python
   result = parser.parse("doc.pdf", target_pages="1-5")
   ```
