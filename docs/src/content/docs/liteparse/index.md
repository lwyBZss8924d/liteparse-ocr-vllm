---
title: What is LiteParse?
description: Fast, local PDF parsing with spatial text parsing, OCR, and bounding boxes.
sidebar:
  order: 0
---

LiteParse is an open-source document parsing library that parses text with spatial layout information and bounding boxes. It runs entirely on your machine, with no cloud dependencies, no LLMs, no API keys.

LiteParse is designed specifically for use cases that require fast, accurate text parsing: real-time applications, coding agents, and local workflows. It provides a simple CLI and library API for parsing PDFs, Office documents, and images, with built-in OCR support.

## What can LiteParse do?

- **Parse PDFs** with precise spatial layout. Text comes back positioned where it appears on the page
- **Extract bounding boxes** for every text line, ready for downstream processing or visualization
- **OCR scanned documents** using built-in Tesseract.js or plug in your own OCR server
- **Run local GLM-OCR** through the official SDK layout pipeline or a direct LM Studio wrapper as a LiteParse-compatible Custom HTTP OCR server
- **Parse Office files and images** with support for DOCX, XLSX, PPTX, PNG, JPG, and more via automatic conversion
- **Screenshot PDF pages** as high-quality images for LLM-based workflows
- **Use from TypeScript, Python, or the CLI** — whatever fits your stack

## Get started

- [Getting started](/liteparse/getting_started/): Install LiteParse and parse your first document.
- [Library usage](/liteparse/guides/library-usage/): Use LiteParse from TypeScript or Python code.
- [CLI reference](/liteparse/cli-reference/): Complete command and option reference.
- [API reference](/liteparse/api/): TypeScript library types and methods.
