"""
Build a PDF the Smart engine cannot touch, to exercise the Flatten fallback.

DeviceCMYK images are exactly the case Smart refuses: a canvas cannot convert four-component
colour faithfully, so it leaves them byte-identical. A print-ready brochure looks like this.
"""
import sys, zlib, math
from pathlib import Path

out = Path(sys.argv[1]); pages = int(sys.argv[2]) if len(sys.argv) > 2 else 6
W = H = 1400  # pixels per image

def image_stream(seed):
    buf = bytearray()
    for y in range(H):
        for x in range(W):
            buf += bytes((
                (x * 7 + seed * 31) % 256,
                (y * 5 + seed * 17) % 256,
                int(127 + 120 * math.sin((x + y + seed * 40) / 90.0)) % 256,
                (x ^ y) % 200,
            ))
    return zlib.compress(bytes(buf), 6)

objs = {}
def add(n, body): objs[n] = body

add(1, b"<< /Type /Catalog /Pages 2 0 R >>")
kids = b" ".join(b"%d 0 R" % (3 + i * 3) for i in range(pages))
add(2, b"<< /Type /Pages /Kids [" + kids + b"] /Count %d >>" % pages)

for i in range(pages):
    p, c, im = 3 + i * 3, 4 + i * 3, 5 + i * 3
    add(p, b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 1191] "
           b"/Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>" % (im, c))
    content = b"q 842 0 0 1191 0 0 cm /Im0 Do Q"
    cz = zlib.compress(content)
    add(c, b"<< /Length %d /Filter /FlateDecode >>\nstream\n" % len(cz) + cz + b"\nendstream")
    data = image_stream(i)
    add(im, b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceCMYK "
            b"/BitsPerComponent 8 /Filter /FlateDecode /Length %d >>\nstream\n" % (W, H, len(data))
            + data + b"\nendstream")

buf = bytearray(b"%PDF-1.4\n"); offs = {}
for n in sorted(objs):
    offs[n] = len(buf)
    buf += b"%d 0 obj\n" % n + objs[n] + b"\nendobj\n"
xref = len(buf); top = max(objs) + 1
buf += b"xref\n0 %d\n0000000000 65535 f \n" % top
for n in range(1, top):
    buf += b"%010d 00000 n \n" % offs[n]
buf += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (top, xref)
out.write_bytes(bytes(buf))
print(f"  {out.name}  {len(buf)/1048576:.1f} MB  {pages} pages, DeviceCMYK")
