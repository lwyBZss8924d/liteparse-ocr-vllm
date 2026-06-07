# Fork Diff Against LiteParse V2.0.6

This document classifies the intentional delta between upstream
`run-llama/liteparse` `crates-v2.0.6` and this fork's first V2 custom package
version `@zzwz/liteparse-vllm@2.0.6-custom.0`.

## Baseline

- Upstream tag: `crates-v2.0.6`
- Upstream commit: `314a4df8c1d409fdb4293a12214981d21d706a59`
- Custom first package commit:
  `b4ac15eacea13b870c9d222dde3ef53ceb4def9e`
- First package commit diff size:
  `38 files changed, 3298 insertions(+), 105 deletions(-)`

Future documentation commits will increase the raw diff count. Use the domain
classification below rather than raw file count alone.

## Domain Classification

| Domain | Files | Intent | Upstream alignment impact |
| --- | --- | --- | --- |
| Custom package identity | `packages/node/package.json`, `packages/node/package-lock.json`, docs | Publish and test as `@zzwz/liteparse-vllm@2.0.6-custom.0` under the fork namespace. | Expected fork delta. |
| Codex OCR CLI/server | `packages/node/src/codex-ocr/**`, `packages/node/test/codex-ocr/**`, `packages/node/src/cli.ts` | Add `lit codex-ocr` and `lit codex-ocr-server` backed by `@openai/codex-sdk`. | Primary custom feature. |
| HTTP OCR timeout | `crates/liteparse/src/config.rs`, `main.rs`, `ocr/http_simple.rs`, `parser.rs`, binding crates, Node wrapper | Make the HTTP OCR request timeout configurable so slow model-backed OCR can complete. Default remains `60000` ms to preserve upstream behavior when unset. | Small core API delta, required for Codex OCR eval. |
| Native loading policy | `packages/node/src/native.ts`, `packages/node/package.json` | Avoid silently loading upstream `@llamaindex/liteparse-*` optional native packages from a custom source/package build. | Package/runtime delta. Native optional package matrix is deferred. |
| Dataset eval tooling | `dataset_eval_utils/**` | Evaluate the local Node package build, use Anthropic-compatible Pipellm gateway config, and retry failed parse documents with evidence. | Evaluation-only delta; not parser runtime. |
| Agent skills | `skills/liteparse-ocr-vllm/**`, `skills/metadata.json`, `skills/scripts/**`, `skills/harness/**` | Maintain a V2-accurate LiteParse OCR-VLLM skill suite for local parse and Codex OCR server pipes. | Agent workflow delta. |
| Docs and local artifact guardrails | `README.md`, `OCR_API_SPEC.md`, `AGENTS.md`, `.gitignore`, `docs/fork-maintenance/**` | Keep fork identity, custom boundary, local test homes, and ignored local artifacts explicit. | Documentation/maintenance delta. |

## Core Areas Intended To Stay Upstream-Aligned

These files and areas should remain as close to upstream V2 as possible unless a
future change explicitly expands the fork scope:

- `crates/liteparse/src/projection.rs`
- `crates/liteparse/src/extract.rs`
- `crates/liteparse/src/render.rs`
- `crates/liteparse/src/conversion.rs`
- `crates/liteparse/src/ocr_merge.rs`
- `crates/liteparse/src/output/**`
- `crates/liteparse/src/search.rs`
- `crates/liteparse/src/lib.rs`
- `crates/liteparse/src/types.rs`

Do not port the old TypeScript parser/core from the `1.5.3-custom.1` branch
into this V2 fork. Keep parser, layout, rendering, and conversion behavior
grounded in the upstream Rust implementation.

## Intentional Custom Additions

### Codex SDK OCR CLI/server

The custom feature lives under `packages/node/src/codex-ocr/`.

Maintained commands:

```bash
lit codex-ocr <image>
lit codex-ocr-server
```

Maintained HTTP routes:

```text
GET  /health
POST /ocr
POST /ocr/analyze
```

`POST /ocr` must stay compatible with LiteParse's HTTP OCR contract:

```json
{
  "results": [
    {
      "text": "recognized text",
      "bbox": [0, 0, 100, 20],
      "confidence": 0.95
    }
  ]
}
```

The server may include additional metadata such as `engine`, `backend`, `model`,
`warnings`, `region_count`, and `bbox_backed_region_count`; baseline consumers
must still be able to read `results[]`.

### Configurable HTTP OCR timeout

Upstream V2 had an effective 60 second timeout for HTTP OCR requests. Codex OCR
server calls can exceed 60 seconds, so this fork adds:

- Rust config: `ocr_timeout_ms`
- Rust CLI: `--ocr-timeout-ms`
- Node config: `ocrTimeoutMs`
- Node CLI: `--ocr-timeout-ms`
- Python/NAPI/WASM bridge support for the same setting

Default remains `60000` ms. Codex evals should pass a larger value, typically:

```bash
--ocr-timeout-ms 300000
```

When a server timeout is also configured, keep the client timeout at least as
large as the server/model request timeout.

### Custom native loading policy

The first V2 custom package is a source/local-native package. It does not ship
the full upstream optional native package matrix. `packages/node/src/native.ts`
therefore loads package-local `.node` files instead of falling back to upstream
`@llamaindex/liteparse-*` optional dependencies.

If a future release adds custom optional native packages, update:

- `packages/node/package.json`
- `packages/node/src/native.ts`
- release docs
- this fork diff document

### Dataset eval utilities

The `dataset_eval_utils` changes are maintained to validate this fork:

- local Node CLI provider via `--liteparse-cli-path`
- `--liteparse-ocr-server-url`
- `--liteparse-ocr-timeout-ms`
- `--liteparse-extract-retries`
- Anthropic-compatible base URL via `--anthropic-base-url`
- `PIPELLM_API_KEY` fallback
- `lp-retry-failed-docs` evidence runner

These changes are not part of LiteParse parsing runtime. Keep them isolated to
`dataset_eval_utils/**`.

### Agent skill suite

The maintained V2 skill source is `skills/liteparse-ocr-vllm/SKILL.md`, with
metadata and validators under `skills/`. It is intentionally a clean V2 skill,
not a direct copy of the old `custom/vllm-ocr-main` collection.

The V2 skill must advertise only current V2 MVP commands:

- `parse`
- `screenshot`
- `batch-parse`
- `codex-ocr`
- `codex-ocr-server`

Do not add unported V1 command surfaces back to the active V2 skill until those
features are reintroduced in the V2 codebase.

## Out Of Scope For `2.0.6-custom.0`

- GLM-OCR SDK server
- LM Studio OCR server
- vLLM Docker/offline packaging
- Codex document pipeline command
- full custom native optional npm package matrix
- Python package publication customization
- WASM package publication customization
- old TypeScript parser/core backport from `1.5.3-custom.1`

## Review Checklist

Use this checklist whenever the fork delta changes:

- [ ] The upstream baseline tag and commit are recorded.
- [ ] `git rev-list --left-right --count <baseline>...HEAD` is understood.
- [ ] Parser-core files listed above have no accidental diff.
- [ ] Any new diff is assigned to a documented domain.
- [ ] Docs, root `AGENTS.md`, and release notes use precise delta wording.
- [ ] `skills/liteparse-ocr-vllm` and its harness remain aligned with the
      actual V2 CLI command surface.
- [ ] Secret-bearing Codex auth/config files are not tracked, printed, or copied.
