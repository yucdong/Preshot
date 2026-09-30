"""Render each successful installed material take as a separate captioned MP4."""
import argparse
import json
import shutil
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--work', default='.preshot-build-cache/material-tutorials-0.0.20')
parser.add_argument('--ffmpeg', required=True)
parser.add_argument('--cases', nargs='*')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
work = root / args.work
destination = root / 'docs/media/material-tutorials'
destination.mkdir(parents=True, exist_ok=True)
fonts = work / 'fonts'
fonts.mkdir(exist_ok=True)
for font in (root / 'src/infrastructure/pdf/fonts').glob('*.ttf'):
    shutil.copyfile(font, fonts / font.name)

def run(*arguments):
    subprocess.run([args.ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', *map(str, arguments)], cwd=root, check=True)

style = '''[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 900
WrapStyle: 2
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Chinese,Noto Sans SC,25,&H00FFFFFF,&H00FFFFFF,&H0017191D,&H0017191D,0,0,0,0,100,100,0,0,1,0,0,2,18,18,50,1
Style: English,Segoe UI,18,&H00B9BEC6,&H00B9BEC6,&H0017191D,&H0017191D,0,0,0,0,100,100,0,0,1,0,0,2,18,18,20,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
cases = args.cases or sorted(p.parent.name for p in work.glob('*/recording.json') if p.parent.name[0] in 'CIM')
for case in cases:
    folder = work / case
    data = json.loads((folder / 'recording.json').read_text(encoding='utf-8-sig'))
    if data['errors'] or not data['frames']:
        raise RuntimeError(f'Rejecting failed or empty take: {case}')
    total = sum(c['targetSeconds'] for c in data['chapters'])
    if not 0 < total < 59:
        raise RuntimeError(f'Tutorial needs a timeline below 59 seconds: {case} {total}')
    frames = data['frames']
    concat = 'ffconcat version 1.0\n'
    for i, frame in enumerate(frames):
        stop = frames[i+1]['seconds'] if i+1 < len(frames) else data['duration']
        concat += f"file '{frame['file']}'\nduration {max(0.04, stop-frame['seconds']):.4f}\n"
    concat += f"file '{frames[-1]['file']}'\n"
    (folder / 'frames.txt').write_text(concat, encoding='utf-8')
    crop = data['crop']
    framing = f"crop={crop['width']}:{crop['height']}:{crop['x']}:{crop['y']},"
    run('-f', 'concat', '-safe', '0', '-i', folder / 'frames.txt', '-vf', framing+'scale=1280:800:force_original_aspect_ratio=decrease,pad=1280:800:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1', '-r', '24', '-c:v', 'libx264', '-preset', 'fast', '-crf', '21', '-pix_fmt', 'yuv420p', folder / 'raw.mp4')
    segments = []
    for i, chapter in enumerate(data['chapters']):
        begin = max(0, chapter['seconds']-frames[0]['seconds'])
        end = (data['chapters'][i+1]['seconds'] if i+1 < len(data['chapters']) else data['duration'])-frames[0]['seconds']
        length = end-begin
        target = chapter['targetSeconds']
        caption = style
        for name, key in [('Chinese', 'zh'), ('English', 'en')]:
            caption += f"Dialogue: 0,0:00:00.00,0:00:{target:05.2f},{name},,0,0,0,,{chapter[key]}\n"
        ass = folder / f'caption-{i}.ass'
        ass.write_text(caption, encoding='utf-8-sig')
        segment = folder / f'segment-{i}.mp4'
        run('-ss', begin, '-t', length, '-i', folder / 'raw.mp4', '-vf', f"setpts=(PTS-STARTPTS)/{length/target},pad=1280:900:0:0:color=0x17191d,subtitles=filename={ass.relative_to(root).as_posix()}:fontsdir={fonts.relative_to(root).as_posix()},setsar=1", '-an', '-r', '24', '-c:v', 'libx264', '-preset', 'fast', '-crf', '21', '-pix_fmt', 'yuv420p', segment)
        segments.append(segment)
    playlist = folder / 'segments.txt'
    playlist.write_text('\n'.join(f"file '{p.name}'" for p in segments), encoding='utf-8')
    video = destination / f'{case}.mp4'
    run('-f', 'concat', '-safe', '0', '-i', playlist, '-c', 'copy', '-movflags', '+faststart', video)
    run('-ss', max(0, total-1), '-i', video, '-frames:v', '1', '-update', '1', destination / f'{case}.jpg')
    print(json.dumps(dict(case=case, plannedSeconds=total, bytes=video.stat().st_size)), flush=True)
