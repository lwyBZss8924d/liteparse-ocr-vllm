# Version Maintenance

This document defines how to maintain the fork as upstream LiteParse releases
new V2 versions.

## Branch Rules

- `main` is reserved as an upstream mirror.
- `custom/liteparse-vllm-v2` carries the custom fork commits.
- Do not publish custom OCR releases from `main`.
- Do not mix old `1.5.3-custom.1` TypeScript parser/core code into the V2 Rust
  branch.

## Version Rules

Use the upstream version plus a custom suffix:

```text
<upstream-version>-custom.<custom-counter>
```

Examples:

```text
2.0.6-custom.0
2.0.6-custom.1
2.0.7-custom.0
```

Rules:

- If only custom code changes and the upstream baseline stays the same, bump the
  custom counter.
- If the upstream baseline changes, update the upstream version segment and reset
  the custom counter to `0`.
- Keep `packages/node/package.json`, `packages/node/package-lock.json`, CLI
  version output, README docs, root `AGENTS.md`, and this directory aligned.

## Upstream Upgrade Workflow

Use a dedicated maintenance branch for each upstream upgrade:

```bash
git fetch upstream --tags --prune
git switch custom/liteparse-vllm-v2
git status --short --branch
git switch -c maintenance/liteparse-vllm-v2-upstream-<version>
```

Confirm the target upstream release:

```bash
git show -s --format='%H %D%n%ci%n%s' refs/tags/crates-v<version>^{commit}
```

Then choose one of these strategies:

1. For a published custom branch, merge the upstream tag so history records the
   baseline update.

   ```bash
   git merge --no-ff refs/tags/crates-v<version>^{commit}
   ```

2. For a clean rebuild branch, create a fresh branch from the upstream tag and
   cherry-pick the custom commits intentionally.

   ```bash
   git switch -c custom/liteparse-vllm-v<version> refs/tags/crates-v<version>^{commit}
   git cherry-pick <custom-commit-range>
   ```

Record which strategy was used in the PR/commit message.

## Diff Audit Workflow

After merging or cherry-picking, classify the diff:

```bash
BASE=refs/tags/crates-v<version>^{commit}
git rev-list --left-right --count "$BASE"...HEAD
git diff --name-status "$BASE"..HEAD
git diff --shortstat "$BASE"..HEAD
```

Confirm parser-core alignment:

```bash
git diff --name-status "$BASE"..HEAD -- \
  crates/liteparse/src/projection.rs \
  crates/liteparse/src/extract.rs \
  crates/liteparse/src/render.rs \
  crates/liteparse/src/conversion.rs \
  crates/liteparse/src/ocr_merge.rs \
  crates/liteparse/src/output \
  crates/liteparse/src/search.rs \
  crates/liteparse/src/lib.rs \
  crates/liteparse/src/types.rs
```

Any diff in those files must be explicitly justified in
`fork-diff-v<version>.md`.

## Required Verification

Run the focused checks for the maintained custom domains:

```bash
cargo check --workspace
cargo test -p liteparse http_simple
cargo test -p liteparse test_default_config
cd packages/node && npm run build && npm run test:codex-ocr
```

Run Python eval utility syntax checks if `dataset_eval_utils/**` changed:

```bash
PYTHONPATH=dataset_eval_utils/src dataset_eval_utils/.venv/bin/python -m py_compile \
  dataset_eval_utils/src/liteparse_eval/evaluation.py \
  dataset_eval_utils/src/liteparse_eval/failed_doc_retry.py \
  dataset_eval_utils/src/liteparse_eval/providers/llm/anthropic.py \
  dataset_eval_utils/src/liteparse_eval/providers/parsers/liteparse.py
```

Run live Codex OCR checks only with the isolated test home:

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
node dist/cli.js parse /path/to/document.pdf \
  --format json \
  --ocr-server-url http://127.0.0.1:8833/ocr \
  --ocr-timeout-ms 300000
```

Do not print or commit `$HOME/.codex-test/auth.json` or
`$HOME/.codex-test/config.toml`.

## Release Notes Template

Use precise wording:

```text
Based on run-llama/liteparse crates-v<version> at <commit>.
Preserves the upstream V2 Rust parsing core.
Adds @zzwz/liteparse-vllm package identity, Codex SDK OCR CLI/server,
configurable HTTP OCR timeout support for slow model-backed OCR, and maintained
eval tooling for Codex OCR evidence runs.
```

List any additional custom domains separately. Do not collapse eval tooling,
native loading policy, and HTTP timeout support into "only Codex OCR Server" if
they are present in the release diff.

## Documentation Update Checklist

When cutting or preparing a custom version:

- [ ] update `docs/fork-maintenance/README.md`
- [ ] add or update `docs/fork-maintenance/fork-diff-v<version>.md`
- [ ] update this file if the maintenance process changes
- [ ] update `docs/fork-maintenance/codex-ocr-agent.md` if the server/agent
      contract changes
- [ ] update root `AGENTS.md`
- [ ] update `skills/liteparse-ocr-vllm/SKILL.md`,
      `skills/metadata.json`, and
      `skills/harness/liteparse-ocr-vllm-skills.spec.json` if the CLI or OCR
      workflow surface changes
- [ ] update root `README.md`, `OCR_API_SPEC.md`, and `packages/node/README.md`
      when user-facing behavior changes
