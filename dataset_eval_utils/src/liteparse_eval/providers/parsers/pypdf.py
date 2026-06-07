from pathlib import Path

from .base import ParserProvider


class PyPDFProvider(ParserProvider):
    """
    Parse provider using PyPDF.

    Install with: pip install pypdf
    """

    def __init__(self, config: dict | None = None):
        """
        Initialize the parse provider.

        Args:
            config: Configuration dict parameters for PyPDF
        """
        self.config = config or {}

    def extract_text(self, file_path: Path) -> str:
        """Extract text from a document using PyPDF."""
        import pypdf

        result = pypdf.PdfReader(str(file_path), **self.config)
        text = "\n\n".join(page.extract_text() for page in result.pages)
        return text
