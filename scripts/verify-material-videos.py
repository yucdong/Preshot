"""Decode published tutorials, check timings, and generate review contact sheets."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument('--ffmpeg', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
media = root / 'docs/media/material-tutorials'
report = root / 'docs/test_reports/media/material-tutorials'
report.mkdir(parents=True, exist_ok=True)
entries = []
for video in sorted(media.glob('*.mp4')):
    probe = subprocess.run([args.ffmpeg, '-hide_banner', '-i', str(video)], capture_output=True, text=True)
    match = re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)', probe.stderr)
    assert match, video
    h, m, s = map(float, match.groups())
    seconds = h * 3600 + m * 60 + s
    assert 0 < seconds < 60, (video, seconds)
    assert '1280x900' in probe.stderr, video
    subprocess.run([args.ffmpeg, '-v', 'error', '-xerror', '-i', str(video), '-f', 'null', '-'], check=True)
    with video.open('rb') as stream:
        sha = hashlib.file_digest(stream, 'sha256').hexdigest()
    entries.append({'case': video.stem, 'seconds': seconds, 'bytes': video.stat().st_size, 'sha256': sha})

for offset in range(0, len(entries), 9):
    sheet = Image.new('RGB', (1200, 945), '#17191d')
    draw = ImageDraw.Draw(sheet)
    for index, entry in enumerate(entries[offset:offset + 9]):
        poster = Image.open(media / f"{entry['case']}.jpg")
        poster.thumbnail((400, 282))
        x, y = (index % 3) * 400, (index // 3) * 315
        sheet.paste(poster, (x, y))
        draw.text((x + 12, y + 289), f"{entry['case']} - {entry['seconds']:.2f}s", fill='white')
    sheet.save(report / f'contact-{offset // 9 + 1}.jpg', quality=88)
(report / 'videos.json').write_text(json.dumps(entries, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'videos': len(entries), 'bytes': sum(e['bytes'] for e in entries), 'allDecoded': True}))
