from pathlib import Path

from .base import ParserProvider


class PyMuPDF4LLMMarkdownProvider(ParserProvider):
    """
    Parse provider using PyMuPDF4LLM in markdown mode.

    Install with: pip install pymupdf4llm
    """

    def __init__(self):
        """Initialize the parse provider."""
        pass

    def extract_text(self, file_path: Path) -> str:
        """Extract text from a document using pymupdf4llm (markdown)."""
        import pymupdf4llm

        return pymupdf4llm.to_markdown(str(file_path), use_ocr=False)
