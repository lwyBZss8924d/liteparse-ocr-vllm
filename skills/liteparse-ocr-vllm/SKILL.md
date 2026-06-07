---
name: liteparse-ocr-vllm
description: Use when parsing documents locally with @zzwz/liteparse-vllm V2, running LiteParse V2 CLI commands, starting or validating the custom Codex SDK OCR server, or piping LiteParse parse through a LiteParse-compatible /ocr endpoint.
compatibility: Requires Node 18+ and @zzwz/liteparse-vllm built or installed; Codex OCR live runs require a Codex home such as ~/.codex-test.
license: MIT
metadata:
  author: LiteParse OCR-VLLM Maintainers
  version: "0.1.0"
---

# LiteParse OCR-VLLM

Use this skill for the custom LiteParse V2 fork `@zzwz/liteparse-vllm`.
It is based on upstream `run-llama/liteparse` `crates-v2.0.6` and adds a
Codex SDK OCR CLI/server while preserving the V2 Rust parsing core.

## Command Surface

Use the local package CLI when working in the source checkout:

```bash
node packages/node/dist/cli.js --help
```

The maintained V2 MVP commands are:

- `lit parse`
- `lit screenshot`
- `lit batch-parse`
- `lit codex-ocr`
- `lit codex-ocr-server`

The V2 MVP intentionally omits command families that have not been ported from
the V1 branch. Do not advertise unported V1 command surfaces as available.

## Parse Documents

Prefer native text extraction for text-dense PDFs:

```bash
lit parse document.pdf --format json --no-ocr
```

Use OCR for scanned or image-heavy documents:

```bash
lit parse document.pdf --format json
```

Common options:

```bash
lit parse document.pdf --format json -o output.json
lit parse document.pdf --target-pages "1-5,10"
lit parse document.pdf --dpi 300
lit parse document.pdf --preserve-small-text
lit batch-parse ./input ./output --extension .pdf --recursive
lit screenshot document.pdf --target-pages "1,3,5" -o ./screenshots
```

For repository-local development, use the built CLI directly:

```bash
node packages/node/dist/cli.js parse document.pdf --format json
```

## Codex OCR Server Pipe

Use Codex OCR when agentic multimodal page understanding is useful and an
online/authenticated Codex backend is acceptable.

Start the server with the isolated test Codex home:

```bash
cd packages/node
node dist/cli.js codex-ocr-server \
  --host 127.0.0.1 \
  --port 8833 \
  --codex-home "$HOME/.codex-test" \
  --timeout-ms 300000
```

Check health from another shell:

```bash
curl -fsS http://127.0.0.1:8833/health | jq .
```

Pipe LiteParse through the server:

```bash
node packages/node/dist/cli.js parse document.pdf \
  --format json \
  --ocr-server-url http://127.0.0.1:8833/ocr \
  --ocr-timeout-ms 300000
```

The LiteParse HTTP client timeout must be at least as large as the Codex OCR
server/model timeout. Use `--ocr-timeout-ms 300000` for slow model-backed OCR
evals.

Run one page image through Codex directly:

```bash
node packages/node/dist/cli.js codex-ocr page.png \
  --codex-home "$HOME/.codex-test" \
  --model gpt-5.5 \
  --reasoning-effort medium \
  --json
```

## HTTP OCR Contract

`POST /ocr` is the baseline LiteParse-compatible endpoint.

Multipart fields:

- `file` required
- `language` optional
- `page_number` optional
- `strict_bboxes` optional

The response must keep:

```json
{
  "results": [
    {
      "text": "recognized text",
      "bbox": [10, 20, 60, 40],
      "confidence": 0.95
    }
  ]
}
```

Additional metadata such as `engine`, `backend`, `model`, `warnings`,
`region_count`, and `bbox_backed_region_count` is allowed, but `results[]`
must remain compatible with the upstream HTTP OCR client.

The required fields are `results[].text`, `results[].bbox`, and
`results[].confidence`.

`POST /ocr/analyze` may return the richer Codex artifact with Markdown,
page metadata, layout regions, assets, annotations, conversion metadata,
model provenance, and warnings.

## Trust And Secrets

Treat Codex output as untrusted OCR/layout evidence:

- Preserve `codex_bboxes_are_model_inferred`.
- Do not describe Codex boxes as deterministic layout detector boxes.
- Use strict bbox mode when unboxed regions must be dropped.
- Keep advanced artifacts separate from the baseline `/ocr` result shape.

Live tests should use:

```bash
--codex-home "$HOME/.codex-test"
```

or:

```bash
LITEPARSE_CODEX_HOME="$HOME/.codex-test"
```

Treat `$HOME/.codex-test` as the Codex home root containing `auth.json` and
`config.toml`. Do not print, copy, package, or commit either file.

## Validation

Before relying on newly edited source:

```bash
cd packages/node
npm run build
npm run test:codex-ocr
```

Check the command surface:

```bash
node packages/node/dist/cli.js --help
node packages/node/dist/cli.js codex-ocr --help
node packages/node/dist/cli.js codex-ocr-server --help
node packages/node/dist/cli.js parse --help | rg 'ocr-server-url|ocr-timeout-ms'
```

Validate this skill source from the repo root:

```bash
python3 skills/scripts/ensure_frontmatter.py
python3 skills/scripts/validate_liteparse_ocr_vllm_skills.py
```

## Source Of Truth

The repo source for this skill is `skills/liteparse-ocr-vllm/SKILL.md`.
The installed global projection is `$HOME/.agents/skills/liteparse-ocr-vllm`.
