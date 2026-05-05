"""
Performance benchmarking tool for parser providers.

Measures latency and resource usage across multiple runs for a given document.
"""

import argparse
import gc
import json
import statistics
import time
import tracemalloc
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from liteparse_eval.providers import (
    ParserProvider,
    LiteparseProvider,
    MarkItDownProvider,
    PyMuPDFProvider,
    PyPDFProvider,
)


@dataclass
class BenchmarkMetrics:
    """Performance metrics for a benchmark run."""
    latencies: list[float] = field(default_factory=list)  # seconds
    memory_peaks: list[float] = field(default_factory=list)  # MB

    @property
    def count(self) -> int:
        return len(self.latencies)

    @property
    def latency_avg(self) -> float:
        return statistics.mean(self.latencies) if self.latencies else 0.0

    @property
    def latency_median(self) -> float:
        return statistics.median(self.latencies) if self.latencies else 0.0

    @property
    def latency_stddev(self) -> float:
        return statistics.stdev(self.latencies) if len(self.latencies) >= 2 else 0.0

    @property
    def latency_min(self) -> float:
        return min(self.latencies) if self.latencies else 0.0

    @property
    def latency_max(self) -> float:
        return max(self.latencies) if self.latencies else 0.0

    @property
    def memory_avg(self) -> float:
        return statistics.mean(self.memory_peaks) if self.memory_peaks else 0.0

    @property
    def memory_median(self) -> float:
        return statistics.median(self.memory_peaks) if self.memory_peaks else 0.0

    @property
    def memory_stddev(self) -> float:
        return statistics.stdev(self.memory_peaks) if len(self.memory_peaks) >= 2 else 0.0

    @property
    def memory_min(self) -> float:
        return min(self.memory_peaks) if self.memory_peaks else 0.0

    @property
    def memory_max(self) -> float:
        return max(self.memory_peaks) if self.memory_peaks else 0.0

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "runs": self.count,
            "latency": {
                "avg_seconds": round(self.latency_avg, 4),
                "median_seconds": round(self.latency_median, 4),
                "stddev_seconds": round(self.latency_stddev, 4),
                "min_seconds": round(self.latency_min, 4),
                "max_seconds": round(self.latency_max, 4),
                "all_runs": [round(l, 4) for l in self.latencies],
            },
            "memory": {
                "avg_mb": round(self.memory_avg, 2),
                "median_mb": round(self.memory_median, 2),
                "stddev_mb": round(self.memory_stddev, 2),
                "min_mb": round(self.memory_min, 2),
                "max_mb": round(self.memory_max, 2),
                "all_runs": [round(m, 2) for m in self.memory_peaks],
            },
        }


@dataclass
class ProviderBenchmarkResult:
    """Result for a single provider benchmark."""
    provider_name: str
    metrics: BenchmarkMetrics
    success: bool = True
    error: Optional[str] = None
    extracted_text_length: Optional[int] = None

    def to_dict(self) -> dict:
        result = {
            "provider": self.provider_name,
            "success": self.success,
            "metrics": self.metrics.to_dict() if self.success else None,
        }
        if self.error:
            result["error"] = self.error
        if self.extracted_text_length is not None:
            result["extracted_text_length"] = self.extracted_text_length
        return result


def get_provider_instance(
    provider_name: str,
    *,
    liteparse_options: Optional[dict] = None,
) -> ParserProvider:
    """Create a fresh provider instance by name."""
    providers = {
        "pymupdf": PyMuPDFProvider,
        "pypdf": PyPDFProvider,
        "markitdown": MarkItDownProvider,
        "liteparse": LiteparseProvider,
    }
    if provider_name not in providers:
        raise ValueError(f"Unknown provider: {provider_name}")
    if provider_name == "liteparse":
        return LiteparseProvider(**(liteparse_options or {}))
    return providers[provider_name]()


def benchmark_provider(
    provider: ParserProvider,
    file_path: Path,
    num_runs: int = 10,
    warmup_runs: int = 1,
) -> BenchmarkMetrics:
    """
    Benchmark a parser provider on a document.

    Args:
        provider: The parser provider to benchmark
        file_path: Path to the document to parse
        num_runs: Number of benchmark runs (default: 10)
        warmup_runs: Number of warmup runs before benchmarking (default: 1)

    Returns:
        BenchmarkMetrics with latency and memory measurements
    """
    metrics = BenchmarkMetrics()

    # Warmup runs (not recorded)
    for _ in range(warmup_runs):
        provider.extract_text(file_path)
        gc.collect()

    # Benchmark runs
    for _ in range(num_runs):
        gc.collect()

        # Start memory tracking
        tracemalloc.start()

        # Time the extraction
        start_time = time.perf_counter()
        provider.extract_text(file_path)
        elapsed = time.perf_counter() - start_time

        # Get peak memory
        _, peak_memory = tracemalloc.get_traced_memory()
        tracemalloc.stop()

        metrics.latencies.append(elapsed)
        metrics.memory_peaks.append(peak_memory / (1024 * 1024))  # Convert to MB

        gc.collect()

    return metrics


def run_benchmark(
    file_path: Path,
    providers: list[str],
    num_runs: int = 10,
    warmup_runs: int = 1,
    output_path: Optional[Path] = None,
    liteparse_options: Optional[dict] = None,
) -> dict:
    """
    Run benchmark across multiple providers.

    Args:
        file_path: Path to the document to benchmark
        providers: List of provider names to benchmark
        num_runs: Number of runs per provider
        warmup_runs: Number of warmup runs per provider
        output_path: Optional path to save JSON results

    Returns:
        Dictionary with benchmark results for all providers
    """
    results: list[ProviderBenchmarkResult] = []

    print(f"Benchmarking: {file_path}")
    print(f"Runs per provider: {num_runs} (+ {warmup_runs} warmup)")
    print("=" * 60)

    for provider_name in providers:
        print(f"\n{provider_name}:")
        print("-" * 40)

        try:
            provider = get_provider_instance(provider_name, liteparse_options=liteparse_options)

            # Get text length from first extraction
            text = provider.extract_text(file_path)
            text_length = len(text)

            metrics = benchmark_provider(
                provider=provider,
                file_path=file_path,
                num_runs=num_runs,
                warmup_runs=warmup_runs,
            )

            result = ProviderBenchmarkResult(
                provider_name=provider_name,
                metrics=metrics,
                extracted_text_length=text_length,
            )

            print(f"  Latency:  avg={metrics.latency_avg:.3f}s  median={metrics.latency_median:.3f}s  stddev={metrics.latency_stddev:.3f}s")
            print(f"  Memory:   avg={metrics.memory_avg:.1f}MB  median={metrics.memory_median:.1f}MB  stddev={metrics.memory_stddev:.1f}MB")
            print(f"  Text length: {text_length:,} chars")

        except Exception as e:
            result = ProviderBenchmarkResult(
                provider_name=provider_name,
                metrics=BenchmarkMetrics(),
                success=False,
                error=str(e),
            )
            print(f"  ERROR: {e}")

        results.append(result)

    # Build output
    output = {
        "file": str(file_path),
        "num_runs": num_runs,
        "warmup_runs": warmup_runs,
        "providers": [r.to_dict() for r in results],
    }

    # Print summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"{'Provider':<15} {'Avg Latency':<12} {'Median':<12} {'Avg Memory':<12}")
    print("-" * 60)
    for r in results:
        if r.success:
            print(f"{r.provider_name:<15} {r.metrics.latency_avg:<12.3f} {r.metrics.latency_median:<12.3f} {r.metrics.memory_avg:<12.1f}")
        else:
            print(f"{r.provider_name:<15} {'FAILED':<12} {'':<12} {'':<12}")

    # Save results
    if output_path:
        with open(output_path, "w") as f:
            json.dump(output, f, indent=2)
        print(f"\nResults saved to: {output_path}")

    return output


def main():
    """CLI entry point for the benchmark tool."""
    parser = argparse.ArgumentParser(
        description="Benchmark parse providers on a document for latency and resource usage"
    )
    parser.add_argument(
        "file",
        type=Path,
        help="Path to the document to benchmark"
    )
    parser.add_argument(
        "--providers",
        type=str,
        nargs="+",
        choices=["pymupdf", "pypdf", "markitdown", "liteparse"],
        default=["pymupdf", "pypdf", "markitdown", "liteparse"],
        help="Parse providers to benchmark (default: all local providers)"
    )
    parser.add_argument(
        "--runs",
        type=int,
        default=10,
        help="Number of benchmark runs per provider (default: 10)"
    )
    parser.add_argument(
        "--warmup",
        type=int,
        default=1,
        help="Number of warmup runs before benchmarking (default: 1)"
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Path to save JSON results"
    )
    parser.add_argument(
        "--liteparse-ocr-server-url",
        type=str,
        default=None,
        help="LiteParse HTTP OCR server URL, e.g. http://127.0.0.1:8831/ocr"
    )
    parser.add_argument(
        "--liteparse-ocr-language",
        type=str,
        default="en",
        help="LiteParse OCR language code (default: en)"
    )
    parser.add_argument(
        "--liteparse-dpi",
        type=int,
        default=150,
        help="LiteParse render/OCR DPI (default: 150)"
    )
    parser.add_argument(
        "--liteparse-max-pages",
        type=int,
        default=1000,
        help="LiteParse maximum pages (default: 1000)"
    )
    parser.add_argument(
        "--liteparse-cli-path",
        type=str,
        default=None,
        help="Path to the liteparse/lit CLI executable"
    )
    parser.add_argument(
        "--liteparse-no-precise-bbox",
        action="store_true",
        default=False,
        help="Disable LiteParse precise bounding boxes"
    )
    parser.add_argument(
        "--liteparse-skip-diagonal-text",
        action="store_true",
        default=False,
        help="Pass the backward-compatible skip diagonal text option"
    )
    parser.add_argument(
        "--liteparse-preserve-small-text",
        action="store_true",
        default=False,
        help="Preserve very small text in LiteParse"
    )
    parser.add_argument(
        "--liteparse-no-ocr",
        dest="liteparse_ocr_enabled",
        action="store_false",
        default=True,
        help="Disable LiteParse OCR"
    )

    args = parser.parse_args()

    if not args.file.exists():
        print(f"Error: File not found: {args.file}")
        return 1

    run_benchmark(
        file_path=args.file,
        providers=args.providers,
        num_runs=args.runs,
        warmup_runs=args.warmup,
        output_path=args.output,
        liteparse_options={
            "ocr_enabled": args.liteparse_ocr_enabled,
            "ocr_server_url": args.liteparse_ocr_server_url,
            "ocr_language": args.liteparse_ocr_language,
            "max_pages": args.liteparse_max_pages,
            "dpi": args.liteparse_dpi,
            "precise_bounding_box": not args.liteparse_no_precise_bbox,
            "skip_diagonal_text": args.liteparse_skip_diagonal_text,
            "preserve_very_small_text": args.liteparse_preserve_small_text,
            "cli_path": args.liteparse_cli_path,
        },
    )

    return 0


if __name__ == "__main__":
    exit(main())
