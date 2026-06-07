# Codex OCR Agent

The Codex OCR Agent is this fork's custom OCR subsystem for LiteParse V2. It is
implemented in the Node package and exposed through CLI commands and a
LiteParse-compatible HTTP OCR server.

## Ownership

Primary files:

- `packages/node/src/codex-ocr/cli.ts`
- `packages/node/src/codex-ocr/codex.ts`
- `packages/node/src/codex-ocr/server.ts`
- `packages/node/src/codex-ocr/types.ts`

Tests:

- `packages/node/test/codex-ocr/codex.test.mjs`
- `packages/node/test/codex-ocr/server.test.mjs`

Docs:

- `OCR_API_SPEC.md`
- `packages/node/README.md`
- `docs/fork-maintenance/fork-diff-v2.0.6.md`
- `skills/liteparse-ocr-vllm/SKILL.md`

## Commands

```bash
lit codex-ocr <image>
lit codex-ocr-server
```

The V2 MVP intentionally does not expose a document pipeline command. Use the
standard LiteParse HTTP OCR path for document parsing:

```bash
lit parse document.pdf \
  --format json \
  --ocr-server-url http://127.0.0.1:8833/ocr \
  --ocr-timeout-ms 300000
```

## HTTP Contract

### `GET /health`

Returns server status and file readability indicators for the configured Codex
home. It must not return the contents of auth or config files.

Expected fields include:

- `status`
- `engine`
- `backend`
- `model`
- `reasoning_effort`
- `codex_home`
- `auth_configured`
- `config_configured`

### `POST /ocr`

LiteParse-compatible OCR endpoint.

Multipart fields:

- `file` required
- `language` optional
- `page_number` optional
- `strict_bboxes` optional

The response must contain `results[]` items with:

- `text`
- `bbox`
- `confidence`

Additional metadata is allowed, but the baseline LiteParse HTTP OCR client must
not need it.

### `POST /ocr/analyze`

Advanced artifact endpoint. It may return:

- Markdown
- page metadata
- layout regions
- assets
- annotations
- conversion metadata
- model provenance
- warnings
- raw response only when explicitly enabled

## Trust Boundary

Treat Codex output as untrusted OCR/layout evidence.

Rules:

- Preserve `codex_bboxes_are_model_inferred`.
- Do not describe Codex boxes as deterministic layout detector boxes.
- Keep `--strict-bbox` behavior available.
- Preserve raw/model warnings in advanced artifacts when enabled.
- Do not change the LiteParse `/ocr` response shape in a way that breaks
  `results[]` consumers.

## Auth And Config

Live tests use the isolated Codex test home:

```bash
--codex-home "$HOME/.codex-test"
```

or:

```bash
LITEPARSE_CODEX_HOME="$HOME/.codex-test"
```

That directory is the Codex home root and should contain:

```text
auth.json
config.toml
```

Do not print, copy, package, or commit either file. Health checks may report
readability booleans only.

## Timeout Coordination

There are two timeout surfaces:

- Codex OCR server/model timeout, for example `codex-ocr-server --timeout-ms`
- LiteParse HTTP OCR client timeout, for example `lit parse --ocr-timeout-ms`

For model-backed OCR, keep the client timeout at least as large as the server
timeout:

```bash
node dist/cli.js codex-ocr-server --timeout-ms 300000
node dist/cli.js parse document.pdf \
  --ocr-server-url http://127.0.0.1:8833/ocr \
  --ocr-timeout-ms 300000
```

The default client timeout remains `60000` ms for upstream-compatible behavior
when the option is not passed.

## Validation

Source-level tests:

```bash
cd packages/node
npm run build
npm run test:codex-ocr
```

Rust timeout support:

```bash
cargo test -p liteparse http_simple
cargo test -p liteparse test_default_config
```

Skill source validation:

```bash
python3 skills/scripts/ensure_frontmatter.py
python3 skills/scripts/validate_liteparse_ocr_vllm_skills.py
```

Live server smoke:

```bash
cd packages/node
node dist/cli.js codex-ocr-server \
  --host 127.0.0.1 \
  --port 8833 \
  --codex-home "$HOME/.codex-test" \
  --timeout-ms 300000
```

In another shell:

```bash
curl -fsS http://127.0.0.1:8833/health | jq .
```

Dataset failed-doc evidence runs should use:

```bash
PYTHONPATH=dataset_eval_utils/src dataset_eval_utils/.venv/bin/python \
  -m liteparse_eval.failed_doc_retry \
  --summary .tmp/dataset-eval/results/<run>.json \
  --output-dir .tmp/dataset-eval/results/<run>-failed-doc-retry \
  --liteparse-cli-path "node /path/to/packages/node/dist/cli.js" \
  --liteparse-ocr-server-url http://127.0.0.1:8833/ocr \
  --liteparse-ocr-timeout-ms 300000 \
  --attempts 2
```

## Iteration Lanes

Keep future work scoped to one lane per change when possible:

- SDK invocation and Codex config behavior
- prompt and output schema
- artifact normalization and conversion to `results[]`
- HTTP server behavior
- CLI UX
- eval tooling
- skill docs and harness
- docs and release notes

When a lane changes, update this document and the fork diff ledger.
