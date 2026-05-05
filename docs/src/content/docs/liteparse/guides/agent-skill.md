---
title: Agent Skill
description: Add LiteParse as a skill for coding agents like Claude Code, Cursor, and others.
sidebar:
  order: 6
---

LiteParse OCR vLLM keeps its custom **coding agent skill** source in this repository. This gives your coding agent the ability to process documents, generate screenshots, parse text from files, and use the fork's GLM-OCR/vLLM workflows with package names and commands that match this custom build.

## Installation

Use the repo-versioned source as the authority:

```bash
skills/liteparse-cli-tools-custom-collection/
```

Validate and sync it into the installed runtime projection:

```bash
npm run validate:agent-skills
npm run sync:agent-skills:dry-run
npm run sync:agent-skills
```

The installed projection is `/Users/arthur/.agents/skills/liteparse-cli-tools-custom-collection`. Treat that projection as generated runtime state; do not edit it directly.

Once configured, your agent will be able to call the LiteParse CLI commands directly from its code execution environment. This means you can have your agent parse PDFs, pull out the text, and generate screenshots on the fly as part of its reasoning process.

## Example prompts

Once the skill is installed, you can ask your coding agent things like:

- "Parse this PDF and extract the text as JSON"
- "Extract text from all the DOCX files in the `./contracts` folder"
- "Screenshot pages 1-5 of this PDF at 300 DPI"
- "Parse this scanned document using the PaddleOCR server on localhost:8828"
- "Get the bounding boxes for all text on page 3"


## Configuring Defaults

You might want to configure some defaults so that your agent doesn't have to specify them in every prompt. You can create a `liteparse.config.json` file in the root of your project with settings like:

```json
{
  "ocrLanguage": "en",
  "ocrEnabled": true,
  "maxPages": 1000,
  "dpi": 150,
  "outputFormat": "json",
  "preserveVerySmallText": false
}
```

This is especially useful for custom OCR servers. Just add the `ocrServerUrl` to your config:

```json
{
  "ocrServerUrl": "http://localhost:8828/ocr",
  "ocrLanguage": "en",
  "outputFormat": "json"
}
```
