"""Verify the expanded installed walkthrough and retain compact review evidence."""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument('--work', default='.preshot-build-cache/demo-rich-0.0.24')
parser.add_argument('--ffmpeg', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
work = root / args.work
sys.path.insert(0, str(root / '.preshot-build-cache/python-pdf'))
import fitz

def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def inspect_plan(plan, folder):
    location = next(a for a in plan['artifacts'] if a['kind'] == 'shootingLocation')
    model = next(a for a in plan['artifacts'] if a['kind'] == 'modelCard')
    assert len(location['gallery']['images']) == len(model['samples']['images']) == 3
    props = {a['id']: a['title'] for a in plan['artifacts'] if a['kind'] == 'prop'}
    rows = [b for b in plan['document']['blocks'] if b['type'] == 'columnList']
    assert any(len(row['children']) == 2 and
               {b.get('props', {}).get('artifactId') for c in row['children'] for b in c['children']} == set(props)
               for row in rows), 'Both props must occupy one two-column row'
    for collection in [location['gallery'], model['samples']]:
        hashes = [sha(folder / image['file']) for image in collection['images']]
        assert len(set(hashes)) == 3, 'Three genuinely different source images required'
    def files(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key in ('file', 'url') and isinstance(child, str) and child.startswith(('references/', 'media/')):
                    yield child
                else:
                    yield from files(child)
        elif isinstance(value, list):
            for child in value:
                yield from files(child)
    references = set(files(plan))
    for name in references:
        path = (folder / name).resolve()
        assert path.is_relative_to(folder.resolve()) and path.is_file(), name
    return len(references)

profile = work / 'profile/.preshot'
manifests = list((profile / 'projects').glob('*/.preshotproj'))
assert len(manifests) == 1
manifest = json.loads(manifests[0].read_text('utf-8'))
assert inspect_plan(manifest['plan'], manifests[0].parent) == 10
sample = root / 'samples/nanjing-bridge'
inspect_plan(json.loads((sample / '.preshotproj').read_text('utf-8'))['plan'], sample)
for phase in ['author', 'reuse', 'layout', 'details', 'export', 'pdf', 'material']:
    recording = json.loads((work / phase / 'recording.json').read_text('utf-8-sig'))
    assert recording['frames'] and recording['chapters'] and not recording['errors'], phase

media = root / 'docs/media'
pdf_path = media / 'preshot-demo.pdf'
assert sha(pdf_path) == sha(work / 'nanjing-bridge.pdf')
pdf = fitz.open(pdf_path)
assert len(pdf) >= 2
text = ''.join(page.get_text() for page in pdf)
assert len(text) >= 1500, 'The PDF must retain the expanded photography guidance'
for expected in ('1/500', '1/160', '35mm', '12', '南京长江大桥', '泡泡机', '透明伞', '蓝调', '备用', '交付'):
    assert expected in text, expected
image_counts = [len(page.get_image_info()) for page in pdf]
assert sum(image_counts) == 10, image_counts
prop_heading_pages = [i + 1 for i, page in enumerate(pdf) if '03 道具与执行方法' in page.get_text()]
assert prop_heading_pages == [2], 'The prop-section heading must share page two with its cards'
for page in pdf:
    for image in page.get_image_info():
        bounds = fitz.Rect(image['bbox'])
        assert bounds.x0 >= -1 and bounds.y0 >= -1 and bounds.x1 <= page.rect.width + 1 and bounds.y1 <= page.rect.height + 1

mp4 = media / 'preshot-demo.mp4'
probe = subprocess.run([args.ffmpeg, '-hide_banner', '-i', str(mp4)], capture_output=True, text=True)
match = re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)', probe.stderr)
assert match and '1280x900' in probe.stderr
h, m, s = map(float, match.groups())
duration = h * 3600 + m * 60 + s
assert duration < 60
subprocess.run([args.ffmpeg, '-v', 'error', '-xerror', '-i', str(mp4), '-f', 'null', '-'], check=True)
gif = Image.open(media / 'preshot-demo.gif')
seconds = 0
for i in range(gif.n_frames):
    gif.seek(i)
    gif.load()
    seconds += gif.info.get('duration', 0) / 1000
assert seconds < 60 and gif.width == 880

evidence = root / 'docs/test_reports/media/demo-rich'
evidence.mkdir(parents=True, exist_ok=True)
sheet = Image.new('RGB', (1200, 1260), '#17191d')
draw = ImageDraw.Draw(sheet)
for i, t in enumerate([0.1, 4.5, 10.5, 16, 23, 28, 33, 39, 43, 46, 51, min(56, duration - .5)]):
    path = work / f'encoded-{i:02}.png'
    subprocess.run([args.ffmpeg, '-v', 'error', '-y', '-ss', str(t), '-i', str(mp4), '-frames:v', '1', '-update', '1', str(path)], check=True)
    frame = Image.open(path).convert('RGB').resize((400, 281))
    x, y = (i % 3) * 400, (i // 3) * 315
    sheet.paste(frame, (x, y))
    draw.text((x + 10, y + 288), f'{t:.1f} s', fill='white')
sheet.save(evidence / 'contact-sheet.jpg', quality=90)
for i, page in enumerate(pdf):
    page.get_pixmap(matrix=fitz.Matrix(1, 1)).save(evidence / f'pdf-page-{i + 1}.png')
recorded_version = json.loads((work / 'author/recording.json').read_text('utf-8-sig'))['version']
report = dict(recordedVersion=recorded_version, mp4Seconds=duration, gifSeconds=round(seconds, 2),
              gifFrames=gif.n_frames, pdfPages=len(pdf), pdfCharacters=len(text),
              propHeadingPages=prop_heading_pages, imageDrawsPerPage=image_counts,
              projectImages=10, locationImages=3, modelImages=3, propColumns=2,
              artifacts=[dict(file=p.name, bytes=p.stat().st_size, sha256=sha(p)) for p in (mp4, media / 'preshot-demo.gif', pdf_path)])
(evidence / 'artifacts.json').write_text(json.dumps(report, indent=2) + '\n', 'utf-8')
print(json.dumps(report))
