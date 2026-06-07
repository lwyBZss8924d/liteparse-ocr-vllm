#!/usr/bin/env python3
"""Validate the LiteParse OCR-VLLM skill source and harness contract."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SPEC_FILE = REPO_ROOT / "skills/harness/liteparse-ocr-vllm-skills.spec.json"


def read(path: str) -> str:
    return (REPO_ROOT / path).read_text(encoding="utf-8")


def parse_frontmatter(text: str) -> str:
    match = re.match(r"^---\n(.*?)\n---\n", text, flags=re.DOTALL)
    if not match:
        raise ValueError("SKILL.md is missing frontmatter")
    return match.group(1)


def frontmatter_value(frontmatter: str, key: str) -> str | None:
    pattern = re.compile(rf"^{re.escape(key)}:\s+\"?([^\"\n]+)\"?$", re.MULTILINE)
    match = pattern.search(frontmatter)
    return match.group(1) if match else None


def metadata_value(frontmatter: str, key: str) -> str | None:
    pattern = re.compile(rf"^  {re.escape(key)}:\s+\"?([^\"\n]+)\"?$", re.MULTILINE)
    match = pattern.search(frontmatter)
    return match.group(1) if match else None


def main() -> None:
    spec = json.loads(SPEC_FILE.read_text(encoding="utf-8"))
    errors: list[str] = []

    for key in ("expected_files", "expected_tooling_files"):
        for rel_path in spec[key]:
            if not (REPO_ROOT / rel_path).is_file():
                errors.append(f"missing expected file: {rel_path}")

    metadata = json.loads(read(spec["metadata_file"]))
    skill_name = spec["frontmatter"]["name"]
    if skill_name not in metadata:
        errors.append(f"metadata missing skill: {skill_name}")
    else:
        expected_version = spec["frontmatter"]["metadata_version"]
        expected_author = spec["frontmatter"]["metadata_author"]
        if metadata[skill_name].get("version") != expected_version:
            errors.append(f"metadata version mismatch for {skill_name}")
        if metadata[skill_name].get("author") != expected_author:
            errors.append(f"metadata author mismatch for {skill_name}")

    skill_text = read(f"skills/{skill_name}/SKILL.md")
    frontmatter = parse_frontmatter(skill_text)
    if frontmatter_value(frontmatter, "name") != skill_name:
        errors.append("frontmatter name mismatch")
    if metadata_value(frontmatter, "version") != spec["frontmatter"]["metadata_version"]:
        errors.append("frontmatter metadata.version mismatch")
    if metadata_value(frontmatter, "author") != spec["frontmatter"]["metadata_author"]:
        errors.append("frontmatter metadata.author mismatch")

    for term in spec["required_terms"]:
        if term not in skill_text:
            errors.append(f"skill missing required term: {term}")
    for term in spec["forbidden_terms"]:
        if term in skill_text:
            errors.append(f"skill contains forbidden stale term: {term}")

    for term in spec["deferred_terms"]:
        matches = [line for line in skill_text.splitlines() if term in line]
        if matches and not any("Do not claim" in line or "old V1" in line for line in matches):
            errors.append(f"deferred term is not clearly framed as deferred: {term}")

    for rel_path, terms in spec["docs_required_terms"].items():
        text = read(rel_path)
        for term in terms:
            if term not in text:
                errors.append(f"{rel_path} missing required term: {term}")

    if errors:
        print("\n".join(errors), file=sys.stderr)
        raise SystemExit(1)
    print("LiteParse OCR-VLLM skill validation passed")


if __name__ == "__main__":
    main()
