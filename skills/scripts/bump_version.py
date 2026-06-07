#!/usr/bin/env python3
"""Manage skill versions across metadata.json and SKILL.md frontmatter."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
METADATA_FILE = ROOT / "metadata.json"


def parse_frontmatter(text: str) -> tuple[str, str]:
    match = re.match(r"^---\n(.*?)\n---\n", text, flags=re.DOTALL)
    if not match:
        raise ValueError("SKILL.md is missing YAML frontmatter")
    return match.group(1), text[match.end():]


def get_frontmatter_value(frontmatter: str, key: str) -> str:
    pattern = re.compile(rf"^  {re.escape(key)}:\s+\"?([^\"\n]+)\"?$", re.MULTILINE)
    match = pattern.search(frontmatter)
    if not match:
        raise ValueError(f"frontmatter metadata.{key} is missing")
    return match.group(1)


def parse_semver(version: str) -> tuple[int, int, int]:
    parts = version.split(".")
    if len(parts) != 3 or not all(part.isdigit() for part in parts):
        raise ValueError(f"invalid semver: {version}")
    return int(parts[0]), int(parts[1]), int(parts[2])


def bump_semver(version: str, bump_type: str) -> str:
    major, minor, patch = parse_semver(version)
    if bump_type == "major":
        return f"{major + 1}.0.0"
    if bump_type == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def load_versions(skill: str) -> tuple[str, str, dict, Path, str]:
    metadata = json.loads(METADATA_FILE.read_text(encoding="utf-8"))
    if skill not in metadata:
        raise ValueError(f"{skill} is missing from metadata.json")
    skill_file = ROOT / skill / "SKILL.md"
    text = skill_file.read_text(encoding="utf-8")
    frontmatter, _ = parse_frontmatter(text)
    return metadata[skill]["version"], get_frontmatter_value(frontmatter, "version"), metadata, skill_file, text


def bump_version(skill: str, bump_type: str) -> None:
    json_version, frontmatter_version, metadata, skill_file, text = load_versions(skill)
    if json_version != frontmatter_version:
        raise ValueError(
            f"Version mismatch: metadata.json={json_version}, frontmatter={frontmatter_version}"
        )

    new_version = bump_semver(json_version, bump_type)
    metadata[skill]["version"] = new_version
    METADATA_FILE.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    skill_file.write_text(
        text.replace(f'version: "{frontmatter_version}"', f'version: "{new_version}"', 1),
        encoding="utf-8",
    )
    print(f"Bumped version: {json_version} -> {new_version}")


def get_version(skill: str) -> None:
    json_version, frontmatter_version, *_ = load_versions(skill)
    if json_version != frontmatter_version:
        raise ValueError(
            f"Version mismatch: metadata.json={json_version}, frontmatter={frontmatter_version}"
        )
    print(json_version)


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    bump = subparsers.add_parser("bump")
    bump.add_argument("skill")
    bump.add_argument("bump_type", choices=["patch", "minor", "major"])
    get = subparsers.add_parser("get")
    get.add_argument("skill")
    args = parser.parse_args()

    if args.command == "bump":
        bump_version(args.skill, args.bump_type)
    else:
        get_version(args.skill)


if __name__ == "__main__":
    main()
