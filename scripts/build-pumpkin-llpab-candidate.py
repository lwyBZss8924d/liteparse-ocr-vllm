#!/usr/bin/env python3
"""Build an LLPA-style LLPAB candidate bundle for Pumpkin evaluations."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def page_index_from_gold(gold_root: Path) -> list[dict[str, Any]]:
    rows = []
    for line in (gold_root / "gold_bundle" / "pages" / "page-index.jsonl").read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def build_from_liteparse_json(parse_json: Path, page_index: list[dict[str, Any]]) -> tuple[str, dict[str, Any], list[dict[str, Any]], dict[int, str]]:
    data = read_json(parse_json)
    pages = data.get("pages", [])
    document_md_parts: list[str] = []
    blocks: list[dict[str, Any]] = []
    page_markdown: dict[int, str] = {}
    page_dims = {int(row["page"]): row for row in page_index}

    for page in pages:
        page_no = int(page.get("page", page.get("pageNum", 0)))
        text = str(page.get("text") or "")
        page_markdown[page_no] = text
        document_md_parts.append(f"<!-- page:{page_no} -->\n\n{text.strip()}")
        dims = page_dims.get(page_no, {})
        width = float(dims.get("width_pt") or page.get("width") or 1)
        height = float(dims.get("height_pt") or page.get("height") or 1)
        for index, item in enumerate(page.get("textItems", []), start=1):
            raw_x = float(item.get("x") or 0)
            raw_y = float(item.get("y") or 0)
            raw_w = float(item.get("width") or item.get("w") or 0)
            raw_h = float(item.get("height") or item.get("h") or 0)
            if raw_w <= 0 or raw_h <= 0:
                continue
            text_item = str(item.get("text") or item.get("str") or "").strip()
            if not text_item:
                continue
            blocks.append(
                {
                    "element_id": f"liteparse-p{page_no:04d}-text-{index:04d}",
                    "page": page_no,
                    "label": "text",
                    "bbox": [
                        clamp01(raw_x / width),
                        clamp01(raw_y / height),
                        clamp01((raw_x + raw_w) / width),
                        clamp01((raw_y + raw_h) / height),
                    ],
                    "text": text_item,
                    "markdown": text_item,
                    "reading_order": index,
                    "provenance": {
                        "source": "liteparse_parse_json",
                        "parse_json": str(parse_json),
                        "confidence": item.get("confidence"),
                    },
                }
            )

    document_md = "\n\n---\n\n".join(part for part in document_md_parts if part.strip()) + "\n"
    document_json = {"kind": "liteparse-candidate-document/v1", "source": str(parse_json), "pages": pages}
    return document_md, document_json, blocks, page_markdown


def build_from_glmocr_pipeline(pipeline_root: Path) -> tuple[str, dict[str, Any], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], dict[int, str]]:
    final_json = read_json(pipeline_root / "final" / "document.json")
    pages = final_json.get("pages", [])
    document_md_parts: list[str] = []
    page_markdown: dict[int, str] = {}
    blocks: list[dict[str, Any]] = []
    tables: list[dict[str, Any]] = []
    formulas: list[dict[str, Any]] = []
    figures: list[dict[str, Any]] = []
    charts: list[dict[str, Any]] = []

    for page in pages:
        page_no = int(page["page"])
        markdown = str(page.get("markdown") or "")
        page_markdown[page_no] = markdown
        document_md_parts.append(f"<!-- page:{page_no} -->\n\n{markdown.strip()}")
        artifact_path = Path(str(page.get("artifactPath") or ""))
        if not artifact_path.is_absolute():
            artifact_path = pipeline_root / artifact_path
        if not artifact_path.is_file():
            continue
        artifact = read_json(artifact_path)
        image = artifact.get("image") or {}
        width = float(image.get("width") or 1)
        height = float(image.get("height") or 1)
        parsed = artifact.get("parsed") or {}
        regions = collect_regions(parsed.get("json_result") or parsed.get("layout_details") or [])
        for index, region in enumerate(regions, start=1):
            text = str(region.get("content") or region.get("text") or "").strip()
            bbox = region_to_normalized_bbox(region, width, height)
            if not text or not bbox:
                continue
            label = str(region.get("label") or region.get("task_type") or "text").lower()
            element_id = f"glmocr-p{page_no:04d}-{label}-{index:04d}"
            row = {
                "element_id": element_id,
                "page": page_no,
                "label": label,
                "bbox": bbox,
                "text": text,
                "markdown": text,
                "reading_order": index,
                "provenance": {"source": "glmocr_pipeline_artifact", "artifact": str(artifact_path)},
            }
            blocks.append(row)
            if "table" in label:
                tables.append({**row, "html_table": text if "<table" in text.lower() else ""})
            elif "formula" in label:
                formulas.append({**row, "latex": text, "latex_wrapped": f"$$\n{text}\n$$"})
            elif "chart" in label or "diagram" in label:
                charts.append({**row, "caption": text, "description": text})
            elif "image" in label or "figure" in label:
                figures.append({**row, "caption": text, "description": text})

    document_md = "\n\n---\n\n".join(part for part in document_md_parts if part.strip()) + "\n"
    document_json = {"kind": "glmocr-pipeline-candidate-document/v1", **final_json}
    return document_md, document_json, blocks, tables, formulas, figures, charts, page_markdown


def build_from_direct_mode(
    direct_mode_root: Path,
    mode: str,
) -> tuple[str, dict[str, Any], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], dict[int, str]]:
    artifact_paths = sorted(direct_mode_root.glob("page-*.json"))
    document_md_parts: list[str] = []
    page_markdown: dict[int, str] = {}
    blocks: list[dict[str, Any]] = []
    tables: list[dict[str, Any]] = []
    formulas: list[dict[str, Any]] = []
    figures: list[dict[str, Any]] = []
    charts: list[dict[str, Any]] = []
    document_pages: list[dict[str, Any]] = []

    for artifact_path in artifact_paths:
        page_no = int(artifact_path.stem.split("-")[-1])
        artifact = read_json(artifact_path)
        parsed = artifact.get("parsed") or {}
        image = artifact.get("image") or {}
        width = float(image.get("width") or 1)
        height = float(image.get("height") or 1)
        markdown = str(parsed.get("markdown_result") or parsed.get("text") or parsed.get("markdown") or "")
        page_markdown[page_no] = markdown
        document_md_parts.append(f"<!-- page:{page_no} mode:{mode} -->\n\n{markdown.strip()}")
        document_pages.append(
            {
                "page": page_no,
                "artifact": str(artifact_path),
                "mode": mode,
                "ok": artifact.get("ok"),
                "warnings": parsed.get("warnings") or [],
                "markdown_chars": len(markdown),
            }
        )
        regions = collect_regions(parsed.get("layout_details") or parsed.get("json_result") or [])
        for index, region in enumerate(regions, start=1):
            text = str(region.get("content") or region.get("text") or "").strip()
            bbox = region_to_normalized_bbox(region, width, height)
            if not text or not bbox:
                continue
            label = str(region.get("label") or region.get("task_type") or mode or "text").lower()
            element_id = f"direct-{mode}-p{page_no:04d}-{label}-{index:04d}"
            row = {
                "element_id": element_id,
                "page": page_no,
                "label": label,
                "bbox": bbox,
                "text": text,
                "markdown": text,
                "reading_order": index,
                "provenance": {
                    "source": "lmstudio_direct_artifact",
                    "artifact": str(artifact_path),
                    "mode": mode,
                    "warnings": parsed.get("warnings") or [],
                },
            }
            blocks.append(row)
            if "table" in label or mode == "table":
                tables.append({**row, "html_table": text if "<table" in text.lower() else ""})
            elif "formula" in label or mode == "formula":
                formulas.append({**row, "latex": text, "latex_wrapped": f"$$\n{text}\n$$"})
            elif "chart" in label or "diagram" in label or mode == "diagram":
                charts.append({**row, "caption": text, "description": text})
            elif "image" in label or "figure" in label:
                figures.append({**row, "caption": text, "description": text})

    document_md = "\n\n---\n\n".join(part for part in document_md_parts if part.strip()) + "\n"
    document_json = {
        "kind": "glmocr-direct-candidate-document/v1",
        "mode": mode,
        "pages": document_pages,
    }
    return document_md, document_json, blocks, tables, formulas, figures, charts, page_markdown


def collect_regions(value: Any) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []

    def visit(item: Any) -> None:
        if isinstance(item, list):
            for child in item:
                visit(child)
            return
        if not isinstance(item, dict):
            return
        if {"bbox_2d", "box_2d", "bbox", "content", "text"} & set(item):
            output.append(item)
            return
        for key in ("json_result", "layout_details", "blocks", "layout_blocks"):
            visit(item.get(key))

    visit(value)
    return output


def region_to_normalized_bbox(region: dict[str, Any], width: float, height: float) -> list[float] | None:
    value = region.get("bbox_2d") or region.get("box_2d")
    if isinstance(value, list) and len(value) >= 4:
        x1, y1, x2, y2 = [float(item) / 1000 for item in value[:4]]
        if x2 > x1 and y2 > y1:
            return [clamp01(x1), clamp01(y1), clamp01(x2), clamp01(y2)]
    value = region.get("bbox")
    if isinstance(value, list) and len(value) >= 4:
        x1, y1, x2, y2 = [float(item) for item in value[:4]]
        if max(abs(x1), abs(y1), abs(x2), abs(y2)) <= 1:
            return [clamp01(x1), clamp01(y1), clamp01(x2), clamp01(y2)]
        return [clamp01(x1 / width), clamp01(y1 / height), clamp01(x2 / width), clamp01(y2 / height)]
    return None


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def materialize_bundle(
    *,
    output_dir: Path,
    candidate_id: str,
    run_id: str,
    source_pdf: Path,
    source_sha256: str,
    page_index: list[dict[str, Any]],
    document_md: str,
    document_json: dict[str, Any],
    blocks: list[dict[str, Any]],
    tables: list[dict[str, Any]] | None = None,
    formulas: list[dict[str, Any]] | None = None,
    figures: list[dict[str, Any]] | None = None,
    charts: list[dict[str, Any]] | None = None,
    page_markdown: dict[int, str] | None = None,
) -> None:
    tables = tables or []
    formulas = formulas or []
    figures = figures or []
    charts = charts or []
    page_markdown = page_markdown or {}
    for subdir in ("input", "final", "pages", "page_markdown", "normalized", "manual-eval"):
        (output_dir / subdir).mkdir(parents=True, exist_ok=True)
    (output_dir / "input" / "source.sha256").write_text(f"{source_sha256}  {source_pdf.name}\n", encoding="utf-8")
    write_json(
        output_dir / "manifest.json",
        {
            "candidate_id": candidate_id,
            "run_id": run_id,
            "source_path": str(source_pdf),
            "source_sha256": source_sha256,
            "created_at": now_iso(),
        },
    )
    (output_dir / "final" / "document.md").write_text(document_md, encoding="utf-8")
    write_json(output_dir / "final" / "document.json", document_json)
    write_jsonl(output_dir / "pages" / "page-index.jsonl", page_index)
    for row in page_index:
        page = int(row["page"])
        text = page_markdown.get(page, "")
        (output_dir / "page_markdown" / f"page-{page:04d}.md").write_text(text, encoding="utf-8")
    write_jsonl(output_dir / "normalized" / "blocks.jsonl", blocks)
    write_jsonl(output_dir / "normalized" / "tables.jsonl", tables)
    write_jsonl(output_dir / "normalized" / "formulas.jsonl", formulas)
    write_jsonl(output_dir / "normalized" / "figures.jsonl", figures)
    write_jsonl(output_dir / "normalized" / "charts.jsonl", charts)
    provenance = [
        {
            "element_id": row.get("element_id"),
            "page": row.get("page"),
            "source": row.get("provenance", {}),
        }
        for row in [*blocks, *tables, *formulas, *figures, *charts]
    ]
    write_jsonl(output_dir / "normalized" / "provenance.jsonl", provenance)
    write_json(output_dir / "manual-eval" / "judge-summary.json", {"status": "candidate", "created_at": now_iso()})
    write_jsonl(output_dir / "manual-eval" / "structure-audit.jsonl", [])
    exported_files = [
        "manifest.json",
        "input/source.sha256",
        "final/document.md",
        "final/document.json",
        "pages/page-index.jsonl",
        "normalized/blocks.jsonl",
        "normalized/tables.jsonl",
        "normalized/formulas.jsonl",
        "normalized/figures.jsonl",
        "normalized/charts.jsonl",
        *[f"page_markdown/page-{int(row['page']):04d}.md" for row in page_index],
    ]
    write_json(
        output_dir / "llpab-export-manifest.json",
        {
            "kind": "llpa-reference-bundle/v1",
            "format": "llpab",
            "candidate_dir": str(output_dir),
            "output_dir": str(output_dir),
            "source_sha256": source_sha256,
            "exported_files": exported_files,
            "synthesized_files": ["normalized/charts.jsonl"],
            "optional_files": ["manual-eval/judge-summary.json", "manual-eval/structure-audit.jsonl"],
            "referenced_asset_files": [],
        },
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gold-root", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--candidate-id", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--liteparse-json", type=Path)
    parser.add_argument("--glmocr-pipeline-root", type=Path)
    parser.add_argument("--direct-mode-root", type=Path)
    parser.add_argument("--direct-mode", type=str)
    args = parser.parse_args()

    source_count = sum(bool(value) for value in (args.liteparse_json, args.glmocr_pipeline_root, args.direct_mode_root))
    if source_count != 1:
        raise SystemExit("Specify exactly one of --liteparse-json, --glmocr-pipeline-root, or --direct-mode-root")
    if args.direct_mode_root and not args.direct_mode:
        raise SystemExit("--direct-mode is required with --direct-mode-root")

    source_pdf = args.gold_root / "source" / "pumpkin_book_10p.pdf"
    source_sha256 = sha256_file(source_pdf)
    page_index = page_index_from_gold(args.gold_root)

    if args.liteparse_json:
        document_md, document_json, blocks, page_markdown = build_from_liteparse_json(args.liteparse_json, page_index)
        materialize_bundle(
            output_dir=args.output_dir,
            candidate_id=args.candidate_id,
            run_id=args.run_id,
            source_pdf=source_pdf,
            source_sha256=source_sha256,
            page_index=page_index,
            document_md=document_md,
            document_json=document_json,
            blocks=blocks,
            page_markdown=page_markdown,
        )
    elif args.glmocr_pipeline_root:
        document_md, document_json, blocks, tables, formulas, figures, charts, page_markdown = build_from_glmocr_pipeline(args.glmocr_pipeline_root)
        materialize_bundle(
            output_dir=args.output_dir,
            candidate_id=args.candidate_id,
            run_id=args.run_id,
            source_pdf=source_pdf,
            source_sha256=source_sha256,
            page_index=page_index,
            document_md=document_md,
            document_json=document_json,
            blocks=blocks,
            tables=tables,
            formulas=formulas,
            figures=figures,
            charts=charts,
            page_markdown=page_markdown,
        )
    else:
        document_md, document_json, blocks, tables, formulas, figures, charts, page_markdown = build_from_direct_mode(args.direct_mode_root, args.direct_mode)
        materialize_bundle(
            output_dir=args.output_dir,
            candidate_id=args.candidate_id,
            run_id=args.run_id,
            source_pdf=source_pdf,
            source_sha256=source_sha256,
            page_index=page_index,
            document_md=document_md,
            document_json=document_json,
            blocks=blocks,
            tables=tables,
            formulas=formulas,
            figures=figures,
            charts=charts,
            page_markdown=page_markdown,
        )

    print(json.dumps({"ok": True, "bundle": str(args.output_dir), "candidate_id": args.candidate_id}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
