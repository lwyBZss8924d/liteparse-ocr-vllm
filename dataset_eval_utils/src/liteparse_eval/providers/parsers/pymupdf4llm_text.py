from pathlib import Path

from .base import ParserProvider


class PyMuPDF4LLMTextProvider(ParserProvider):
    """
    Parse provider using PyMuPDF4LLM in plain text mode.

    Install with: pip install pymupdf4llm
    """

    def __init__(self):
        """Initialize the parse provider."""
        pass

    def extract_text(self, file_path: Path) -> str:
        """Extract text from a document using pymupdf4llm (plain text)."""
        import pymupdf4llm

        return pymupdf4llm.to_text(str(file_path), use_ocr=False)
