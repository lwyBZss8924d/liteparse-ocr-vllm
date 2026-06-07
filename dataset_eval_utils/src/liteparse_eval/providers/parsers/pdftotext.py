from pathlib import Path

from .base import ParserProvider


class PdfToTextProvider(ParserProvider):
    """
    Parse provider using pdftotext (poppler-based).

    Install with: pip install pdftotext
    Requires system dependency: libpoppler-cpp-dev (Linux) or poppler (macOS via brew)
    """

    def __init__(self):
        """Initialize the parse provider."""
        pass

    def extract_text(self, file_path: Path) -> str:
        """Extract text from a document using pdftotext."""
        import pdftotext

        with open(file_path, "rb") as f:
            pdf = pdftotext.PDF(f, physical=True)
        return "\n\n".join(pdf)
