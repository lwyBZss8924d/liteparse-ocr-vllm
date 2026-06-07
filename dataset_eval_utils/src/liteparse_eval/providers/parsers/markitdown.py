from pathlib import Path

from .base import ParserProvider


class MarkItDownProvider(ParserProvider):
    """
    Parse provider using MarkItDown.

    Install with: pip install markitdown
    """

    def __init__(self, config: dict | None = None):
        """
        Initialize the parse provider.

        Args:
            config: Configuration dict parameters for MarkItDown
        """
        from markitdown import MarkItDown

        self.config = config or {}
        self.markitdown = MarkItDown(**self.config)

    def extract_text(self, file_path: Path) -> str:
        """Extract text from a document using MarkItDown."""
        result = self.markitdown.convert(str(file_path))
        return result.text_content
