#!/usr/bin/env python3
"""Add a skill entry to skills/metadata.json."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
METADATA_FILE = ROOT / "metadata.json"


def add_skill(skill: str, version: str, author: str) -> None:
    data = json.loads(METADATA_FILE.read_text(encoding="utf-8"))
    if skill in data:
        print(f"Skill {skill} already in metadata.json", file=sys.stderr)
        raise SystemExit(1)

    data[skill] = {"version": version, "author": author}
    METADATA_FILE.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("skill")
    parser.add_argument("-a", "--author", default="LiteParse OCR-VLLM Maintainers")
    parser.add_argument("-v", "--version", default="0.1.0")
    args = parser.parse_args()
    add_skill(args.skill, args.version, args.author)


if __name__ == "__main__":
    main()
