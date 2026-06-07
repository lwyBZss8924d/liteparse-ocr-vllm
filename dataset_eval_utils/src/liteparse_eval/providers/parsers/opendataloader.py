import tempfile
from pathlib import Path

from .base import ParserProvider


class OpenDataLoaderProvider(ParserProvider):
    """
    Parse provider using OpenDataLoader PDF.

    Install with: pip install opendataloader-pdf
    Requires: Java 11+
    """

    def __init__(self):
        """Initialize the parse provider."""
        pass

    def extract_text(self, file_path: Path) -> str:
        """Extract text from a document using OpenDataLoader PDF."""
        import opendataloader_pdf

        with tempfile.TemporaryDirectory() as tmp_dir:
            opendataloader_pdf.convert(
                input_path=[str(file_path)],
                output_dir=tmp_dir,
                format="text",
            )
            # Read the output text file
            output_file = Path(tmp_dir) / f"{file_path.stem}.txt"
            if output_file.exists():
                return output_file.read_text(encoding="utf-8")
            # Fallback: find any .txt file in the output dir
            txt_files = list(Path(tmp_dir).glob("*.txt"))
            if txt_files:
                return txt_files[0].read_text(encoding="utf-8")
            return ""
