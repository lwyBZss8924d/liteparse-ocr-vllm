"""Retry LiteParse extraction failures and write per-attempt evidence."""

import argparse
import json
import re
import shlex
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class RetryConfig:
    attempts: int
    cli_path: str
    dpi: int
    language: str
    max_pages: int
    no_ocr: bool
    ocr_server_url: str | None
    ocr_timeout_ms: int | None
    output_dir: Path
    preserve_small_text: bool
    retry_delay_seconds: float


def main() -> None:
    args = parse_args()
    summary_path = Path(args.summary)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    failed_docs = load_failed_docs(summary_path)
    config = RetryConfig(
        attempts=args.attempts,
        cli_path=args.liteparse_cli_path,
        dpi=args.liteparse_dpi,
        language=args.liteparse_ocr_language,
        max_pages=args.liteparse_max_pages,
        no_ocr=args.liteparse_no_ocr,
        ocr_server_url=args.liteparse_ocr_server_url,
        ocr_timeout_ms=args.liteparse_ocr_timeout_ms,
        output_dir=output_dir,
        preserve_small_text=args.liteparse_preserve_small_text,
        retry_delay_seconds=args.retry_delay_seconds,
    )

    results = []
    print(f"Retrying {len(failed_docs)} failed documents...")
    for index, doc_path in enumerate(failed_docs, 1):
        print(f"[{index}/{len(failed_docs)}] {doc_path.name}")
        result = retry_document(doc_path, config)
        attempts = result["attempts"]
        last = attempts[-1] if attempts else {}
        status = "ok" if result["success"] else "failed"
        print(
            f"  {status}: attempts={len(attempts)} "
            f"last_exit={last.get('exit_code')} text_len={last.get('text_len')}"
        )
        results.append(result)

    summary = build_summary(summary_path, results, config)
    summary_file = output_dir / "failed-doc-retry-summary.json"
    summary_file.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Evidence summary saved to: {summary_file}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Retry documents whose LiteParse parse_latency_seconds is null in an eval summary.",
    )
    parser.add_argument("--summary", required=True, help="Path to aggregate eval JSON")
    parser.add_argument("--output-dir", required=True, help="Directory for retry evidence")
    parser.add_argument(
        "--attempts",
        type=int,
        default=2,
        help="Maximum attempts per failed document, including the first try",
    )
    parser.add_argument("--retry-delay-seconds", type=float, default=2.0)
    parser.add_argument("--liteparse-cli-path", required=True)
    parser.add_argument("--liteparse-ocr-server-url")
    parser.add_argument("--liteparse-ocr-language", default="en")
    parser.add_argument("--liteparse-dpi", type=int, default=150)
    parser.add_argument("--liteparse-ocr-timeout-ms", type=int)
    parser.add_argument("--liteparse-max-pages", type=int, default=1000)
    parser.add_argument("--liteparse-preserve-small-text", action="store_true")
    parser.add_argument("--liteparse-no-ocr", action="store_true")
    return parser.parse_args()


def load_failed_docs(summary_path: Path) -> list[Path]:
    data = json.loads(summary_path.read_text(encoding="utf-8"))
    documents = data.get("qa", {}).get("per_document_results", [])
    failed_docs = [
        Path(item["file"])
        for item in documents
        if item.get("parse_latency_seconds") is None and item.get("file")
    ]
    if not failed_docs:
        raise SystemExit(f"No failed parse documents found in {summary_path}")
    missing = [str(path) for path in failed_docs if not path.exists()]
    if missing:
        raise SystemExit("Missing source documents:\n" + "\n".join(missing))
    return failed_docs


def retry_document(doc_path: Path, config: RetryConfig) -> dict[str, Any]:
    attempts = []
    for attempt_number in range(1, config.attempts + 1):
        attempt = run_attempt(doc_path, attempt_number, config)
        attempts.append(attempt)
        if attempt["ok"]:
            break
        if attempt_number < config.attempts:
            time.sleep(config.retry_delay_seconds)

    return {
        "file": str(doc_path),
        "success": any(attempt["ok"] for attempt in attempts),
        "attempts": attempts,
    }


def run_attempt(doc_path: Path, attempt_number: int, config: RetryConfig) -> dict[str, Any]:
    stem = safe_stem(doc_path)
    stdout_path = config.output_dir / f"{stem}.attempt{attempt_number}.stdout.json"
    stderr_path = config.output_dir / f"{stem}.attempt{attempt_number}.stderr.txt"
    command = build_command(doc_path, config)

    start = time.perf_counter()
    completed = subprocess.run(command, capture_output=True, text=True)
    duration = time.perf_counter() - start

    stdout_path.write_text(completed.stdout, encoding="utf-8")
    stderr_path.write_text(completed.stderr, encoding="utf-8")

    parse_error = None
    text_len = None
    page_count = None
    if completed.returncode == 0:
        try:
            parsed = json.loads(completed.stdout)
            pages = parsed.get("pages", [])
            page_count = len(pages)
            text_len = len("\n\n".join(str(page.get("text", "")) for page in pages))
        except Exception as error:  # noqa: BLE001 - evidence runner should record arbitrary parse errors.
            parse_error = str(error)

    return {
        "attempt": attempt_number,
        "ok": completed.returncode == 0 and parse_error is None,
        "exit_code": completed.returncode,
        "duration_seconds": round(duration, 3),
        "page_count": page_count,
        "text_len": text_len,
        "stdout_path": str(stdout_path),
        "stderr_path": str(stderr_path),
        "stdout_tail": completed.stdout[-2000:],
        "stderr_tail": completed.stderr[-2000:],
        "parse_error": parse_error,
        "command": command,
    }


def build_command(doc_path: Path, config: RetryConfig) -> list[str]:
    command = [
        *shlex.split(config.cli_path),
        "parse",
        str(doc_path),
        "--format",
        "json",
        "--quiet",
        "--max-pages",
        str(config.max_pages),
        "--dpi",
        str(config.dpi),
        "--ocr-language",
        config.language,
    ]
    if config.no_ocr:
        command.append("--no-ocr")
    if config.ocr_server_url:
        command.extend(["--ocr-server-url", config.ocr_server_url])
    if config.ocr_timeout_ms is not None:
        command.extend(["--ocr-timeout-ms", str(config.ocr_timeout_ms)])
    if config.preserve_small_text:
        command.append("--preserve-small-text")
    return command


def build_summary(summary_path: Path, results: list[dict[str, Any]], config: RetryConfig) -> dict[str, Any]:
    successful = [item for item in results if item["success"]]
    failed = [item for item in results if not item["success"]]
    recovered_attempts = [
        next(attempt for attempt in item["attempts"] if attempt["ok"])
        for item in successful
    ]
    return {
        "source_summary": str(summary_path),
        "config": {
            "attempts": config.attempts,
            "cli_path": config.cli_path,
            "dpi": config.dpi,
            "language": config.language,
            "max_pages": config.max_pages,
            "no_ocr": config.no_ocr,
            "ocr_server_url": config.ocr_server_url,
            "ocr_timeout_ms": config.ocr_timeout_ms,
            "preserve_small_text": config.preserve_small_text,
            "retry_delay_seconds": config.retry_delay_seconds,
        },
        "total_failed_docs_from_source": len(results),
        "recovered_docs": len(successful),
        "still_failed_docs": len(failed),
        "recovery_rate": len(successful) / len(results) if results else 0,
        "recovered_duration_seconds": {
            "count": len(recovered_attempts),
            "total": round(sum(attempt["duration_seconds"] for attempt in recovered_attempts), 3),
            "average": round(
                sum(attempt["duration_seconds"] for attempt in recovered_attempts) / len(recovered_attempts),
                3,
            )
            if recovered_attempts
            else 0,
            "max": max((attempt["duration_seconds"] for attempt in recovered_attempts), default=0),
        },
        "results": results,
    }


def safe_stem(path: Path) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", path.stem).strip("_")[:160]


if __name__ == "__main__":
    main()
