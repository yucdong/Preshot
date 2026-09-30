"""Generate real decodable rasters; no padding or fake byte-length metadata.

All outputs are disposable test assets under the build cache. PNG IDAT data
is streamed row by row, while Pillow encodes a high entropy JPEG independently.
"""
import hashlib
import json
import random
import struct
import zlib
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent / '.preshot-build-cache' / 'buglist1-fixtures'
root.mkdir(parents=True, exist_ok=True)
rng = random.Random(170510)
png = root / 'original-10000x10000.png'
if not png.exists():
    with png.open('wb') as output:
        def chunk(kind, data):
            output.write(struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data)))
        output.write(b'\x89PNG\r\n\x1a\n')
        chunk(b'IHDR', struct.pack('>2I5B', 10000, 10000, 8, 2, 0, 0, 0))
        encoder = zlib.compressobj(1)
        for _ in range(10000):
            encoded = encoder.compress(b'\0' + rng.randbytes(30000))
            if encoded:
                chunk(b'IDAT', encoded)
        chunk(b'IDAT', encoder.flush())
        chunk(b'IEND', b'')
jpeg = root / 'original-8000x8000.jpg'
if not jpeg.exists():
    image = Image.frombytes('RGB', (8000, 8000), rng.randbytes(8000 * 8000 * 3))
    image.save(jpeg, quality=100, subsampling=0)
    image.close()
results = []
for path in [png, jpeg]:
    with path.open('rb') as data:
        digest = hashlib.file_digest(data, 'sha256').hexdigest()
    with Image.open(path) as image:
        image.verify()
        results.append(dict(file=path.name, bytes=path.stat().st_size, width=image.width, height=image.height, sha256=digest))
(root / 'manifest.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
print(json.dumps(results, indent=2))
