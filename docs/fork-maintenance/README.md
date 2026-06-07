# Fork Maintenance Documentation

This directory is the maintained source of truth for how this fork differs from
upstream `run-llama/liteparse` and how those differences should be carried
forward.

## Current Baseline

| Field | Value |
| --- | --- |
| Upstream repository | `https://github.com/run-llama/liteparse.git` |
| Upstream baseline tag | `crates-v2.0.6` |
| Upstream baseline commit | `314a4df8c1d409fdb4293a12214981d21d706a59` |
| Upstream release page | `https://github.com/run-llama/liteparse/releases/tag/crates-v2.0.6` |
| Custom branch | `custom/liteparse-vllm-v2` |
| Custom npm package | `@zzwz/liteparse-vllm` |
| Current custom version | `2.0.6-custom.0` |
| First V2 package commit | `b4ac15eacea13b870c9d222dde3ef53ceb4def9e` |
| Maintained skill source | `skills/liteparse-ocr-vllm` |
| Current skill version | `0.1.0` |

## Documents

- [Fork diff against V2.0.6](fork-diff-v2.0.6.md) records the intentional
  delta against upstream `crates-v2.0.6`.
- [Version maintenance](version-maintenance.md) defines branch, version, merge,
  release, and rebase rules for future upstream updates.
- [Codex OCR Agent](codex-ocr-agent.md) defines the custom OCR server / agent
  contract and its testing boundary.

## Maintenance Rule

When a change affects any maintained fork delta, update this directory in the
same change. Maintained deltas include:

- custom package identity and release metadata
- Codex SDK OCR CLI/server behavior
- HTTP OCR timeout behavior needed by slow model-backed OCR
- native binary loading / custom package delivery policy
- dataset eval utilities used to validate the custom OCR path
- repo-maintained V2 skill suite under `skills/liteparse-ocr-vllm`
- user-facing docs, root `AGENTS.md`, and fork maintenance docs

Do not describe this branch as "only Codex OCR Server differs from upstream" in
release notes or docs. The more precise statement is:

```text
This fork is based on run-llama/liteparse crates-v2.0.6 and preserves the V2
Rust parsing core. It adds the @zzwz/liteparse-vllm package identity, Codex SDK
OCR CLI/server, configurable HTTP OCR timeout support for slow model-backed OCR,
custom native loading policy for source/package builds, and eval tooling used to
validate the Codex OCR path. The repo-maintained agent skill source is
skills/liteparse-ocr-vllm.
```

## Skill Suite

The V2 source authority for agent skill workflows is:

```text
skills/liteparse-ocr-vllm/SKILL.md
```

The installed global projection is
`$HOME/.agents/skills/liteparse-ocr-vllm`. Validate the repo source with:

```bash
python3 skills/scripts/ensure_frontmatter.py
python3 skills/scripts/validate_liteparse_ocr_vllm_skills.py
```

## Quick Baseline Audit

Run these commands before answering whether the fork is aligned with upstream:

```bash
git fetch upstream --tags --prune
git rev-parse refs/tags/crates-v2.0.6^{commit} HEAD
git rev-list --left-right --count refs/tags/crates-v2.0.6^{commit}...HEAD
git diff --name-status refs/tags/crates-v2.0.6^{commit}..HEAD
git diff --shortstat refs/tags/crates-v2.0.6^{commit}..HEAD
```

Use path-scoped checks to confirm the V2 parser core has not drifted:

```bash
git diff --name-status refs/tags/crates-v2.0.6^{commit}..HEAD -- \
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

Expected result for the first V2 custom package version: no parser-core diff in
those files.
