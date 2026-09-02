"""
Build the awkward-input fixtures the app has to survive.

    python scripts/fixtures.py <source.pdf> <outDir>

Produces a password-protected PDF, an already-small text-only PDF, a file that is not a PDF
at all, and a few extracted page ranges to exercise bulk processing.
"""

import sys
import zlib
from pathlib import Path

from pypdf import PdfReader, PdfWriter


def text_only(path: Path) -> None:
    """A small, text-only PDF: nothing here can be optimized, so it must fail gracefully."""
    content = b"BT /F1 24 Tf 72 700 Td (Nothing to optimize here.) Tj ET"
    stream = zlib.compress(content)

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length %d /Filter /FlateDecode >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"

    xref = len(out)
    out += b"xref\n0 %d\n" % (len(objects) + 1)
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        xref,
    )
    path.write_bytes(bytes(out))


def main() -> None:
    source = Path(sys.argv[1])
    out_dir = Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)

    reader = PdfReader(str(source))

    # Password-protected.
    writer = PdfWriter()
    for page in reader.pages[:2]:
        writer.add_page(page)
    writer.encrypt("hunter2")
    with open(out_dir / "locked.pdf", "wb") as fh:
        writer.write(fh)

    # Two smaller multi-page slices, for the bulk queue.
    for name, span in (("slice-a.pdf", slice(0, 4)), ("slice-b.pdf", slice(4, 8))):
        writer = PdfWriter()
        for page in reader.pages[span]:
            writer.add_page(page)
        with open(out_dir / name, "wb") as fh:
            writer.write(fh)

    text_only(out_dir / "text-only.pdf")

    # Not a PDF, but named like one.
    (out_dir / "not-really.pdf").write_bytes(b"PK\x03\x04 this is a zip, not a pdf" * 40)

    for f in sorted(out_dir.iterdir()):
        print(f"  {f.name:20} {f.stat().st_size / 1048576:8.2f} MB")


if __name__ == "__main__":
    main()
