from pathlib import Path
import json
import shlex
import subprocess
import time
from typing import Optional

from .base import ParserProvider


class LiteparseProvider(ParserProvider):
    """
    Parser provider using the liteparse Python wrapper.

    This provider uses the liteparse library for PDF text extraction.
    """

    def __init__(
        self,
        ocr_enabled: bool = False,
        ocr_server_url: Optional[str] = None,
        ocr_language: str = "en",
        max_pages: int = 1000,
        dpi: int = 150,
        ocr_timeout_ms: Optional[int] = None,
        preserve_very_small_text: bool = False,
        cli_path: Optional[str] = None,
        extract_retries: int = 0,
        retry_delay_seconds: float = 2.0,
    ):
        """
        Initialize the liteparse provider.

        Args:
            ocr_enabled: Whether to enable OCR for scanned documents
            ocr_server_url: URL of HTTP OCR server (uses Tesseract if not provided)
            ocr_language: Language code for OCR (e.g., "en", "fr", "de")
            max_pages: Maximum number of pages to parse
            dpi: DPI for rendering (affects OCR quality)
            ocr_timeout_ms: HTTP OCR request timeout in milliseconds
            preserve_very_small_text: Whether to preserve very small text
            cli_path: Custom path to liteparse/lit CLI. When provided, this
                provider shells out to the CLI instead of importing the Python
                wrapper, which is useful for evaluating a local Node package build.
            extract_retries: Number of additional retries after a failed CLI
                extraction attempt. Defaults to 0 to preserve upstream behavior.
            retry_delay_seconds: Delay between retry attempts.
        """
        self.ocr_enabled = ocr_enabled
        self.ocr_server_url = ocr_server_url
        self.ocr_language = ocr_language
        self.max_pages = max_pages
        self.dpi = dpi
        self.ocr_timeout_ms = ocr_timeout_ms
        self.preserve_very_small_text = preserve_very_small_text
        self.cli_path = cli_path
        self.extract_retries = extract_retries
        self.retry_delay_seconds = retry_delay_seconds
        self.parser = None

        if cli_path is None:
            from liteparse import LiteParse

            parser_options = {
                "ocr_enabled": ocr_enabled,
                "ocr_server_url": ocr_server_url,
                "ocr_language": ocr_language,
                "max_pages": max_pages,
                "dpi": dpi,
                "preserve_very_small_text": preserve_very_small_text,
                "quiet": True,
            }
            if ocr_timeout_ms is not None:
                parser_options["ocr_timeout_ms"] = ocr_timeout_ms
            self.parser = LiteParse(**parser_options)

    def extract_text(self, file_path: Path) -> str:
        """Extract text from a document using liteparse."""
        if self.cli_path:
            return self._extract_text_with_cli(file_path)

        if self.parser is None:
            raise RuntimeError("LiteParse Python parser was not initialized")

        result = self.parser.parse(file_path)
        return result.text

    def _extract_text_with_cli(self, file_path: Path) -> str:
        command = [
            *shlex.split(self.cli_path),
            "parse",
            str(file_path),
            "--format",
            "json",
            "--quiet",
            "--max-pages",
            str(self.max_pages),
            "--dpi",
            str(self.dpi),
            "--ocr-language",
            self.ocr_language,
        ]

        if not self.ocr_enabled:
            command.append("--no-ocr")
        if self.ocr_server_url:
            command.extend(["--ocr-server-url", self.ocr_server_url])
        if self.ocr_timeout_ms is not None:
            command.extend(["--ocr-timeout-ms", str(self.ocr_timeout_ms)])
        if self.preserve_very_small_text:
            command.append("--preserve-small-text")

        errors: list[BaseException] = []
        max_attempts = self.extract_retries + 1
        for attempt in range(1, max_attempts + 1):
            try:
                completed = subprocess.run(
                    command,
                    check=True,
                    capture_output=True,
                    text=True,
                )
                parsed = json.loads(completed.stdout)
                break
            except (subprocess.CalledProcessError, json.JSONDecodeError) as exc:
                errors.append(exc)
                if attempt >= max_attempts:
                    raise self._format_cli_error(exc, attempt, max_attempts) from exc
                time.sleep(self.retry_delay_seconds)

        pages = parsed.get("pages", [])
        return "\n\n".join(str(page.get("text", "")) for page in pages)

    def _format_cli_error(
        self,
        error: subprocess.CalledProcessError | json.JSONDecodeError,
        attempt: int,
        max_attempts: int,
    ) -> RuntimeError:
        if isinstance(error, subprocess.CalledProcessError):
            stderr_tail = (error.stderr or "").strip()[-2000:]
            stdout_tail = (error.stdout or "").strip()[-2000:]
            details = []
            if stderr_tail:
                details.append(f"stderr tail: {stderr_tail}")
            if stdout_tail:
                details.append(f"stdout tail: {stdout_tail}")
            detail_text = "\n".join(details) if details else "no stdout/stderr captured"
            return RuntimeError(
                "Liteparse CLI failed "
                f"after {attempt}/{max_attempts} attempts with exit code {error.returncode}: "
                f"{detail_text}"
            )

        return RuntimeError(
            "Liteparse CLI returned invalid JSON "
            f"after {attempt}/{max_attempts} attempts: {error}"
        )
