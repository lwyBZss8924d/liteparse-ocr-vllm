#!/usr/bin/env python3
"""Validate required frontmatter for repo-maintained skills."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIRED_TOP_LEVEL = ("name", "description", "compatibility", "license", "metadata")
REQUIRED_METADATA = ("author", "version")


def parse_frontmatter(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    match = re.match(r"^---\n(.*?)\n---\n", text, flags=re.DOTALL)
    if not match:
        raise ValueError(f"{path}: missing frontmatter")
    return match.group(1)


def has_top_level(frontmatter: str, key: str) -> bool:
    return re.search(rf"^{re.escape(key)}:", frontmatter, flags=re.MULTILINE) is not None


def has_metadata_key(frontmatter: str, key: str) -> bool:
    return re.search(rf"^  {re.escape(key)}:", frontmatter, flags=re.MULTILINE) is not None


def main() -> None:
    skill_files = sorted(
        path / "SKILL.md"
        for path in ROOT.iterdir()
        if path.is_dir() and (path / "SKILL.md").is_file()
    )
    if not skill_files:
        raise SystemExit("No skill files found")

    errors: list[str] = []
    for skill_file in skill_files:
        try:
            frontmatter = parse_frontmatter(skill_file)
            for key in REQUIRED_TOP_LEVEL:
                if not has_top_level(frontmatter, key):
                    errors.append(f"{skill_file}: missing {key}")
            for key in REQUIRED_METADATA:
                if not has_metadata_key(frontmatter, key):
                    errors.append(f"{skill_file}: missing metadata.{key}")
        except Exception as exc:
            errors.append(str(exc))

    if errors:
        print("\n".join(errors), file=sys.stderr)
        raise SystemExit(1)
    print("All skill files include required frontmatter")


if __name__ == "__main__":
    main()
