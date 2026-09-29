"""Render installed UI frame recordings with readable bilingual chapter captions."""
import argparse
import json
import shutil
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--ffmpeg", required=True)
parser.add_argument("--work", default=".preshot-build-cache/installed-demo")
parser.add_argument("--short", action="store_true", help="Render the under-one-minute, new-project walkthrough")
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
work = root / args.work
phases = ["author", "reuse", "layout", "details", "export", "pdf", "material"] if args.short else ["intro", "library", "columns", "tour", "export", "pdf"]
fontdir = work / "fonts"
fontdir.mkdir(exist_ok=True)
for font in (root / "src/infrastructure/pdf/fonts").glob("*.ttf"):
    shutil.copyfile(font, fontdir / font.name)

def run(*arguments):
    subprocess.run([args.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", *map(str, arguments)], cwd=root, check=True)

def stamp(seconds):
    n = round(max(0, seconds) * 100)
    return f"{n//360000}:{n//6000%60:02}:{n//100%60:02}.{n%100:02}"

style = """[Script Info]
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
"""
segments = []
timeline = []
total = 0
for phase in phases:
    folder = work / phase
    data = json.loads((folder / "recording.json").read_text(encoding="utf-8-sig"))
    if data["errors"]:
        raise RuntimeError(f"Cannot publish a recording with UI errors: {phase}: {data['errors']}")
    frames = data["frames"]
    concat = "ffconcat version 1.0\n"
    for i, frame in enumerate(frames):
        stop = frames[i + 1]["seconds"] if i + 1 < len(frames) else data["duration"]
        concat += f"file '{frame['file']}'\nduration {max(0.04, stop-frame['seconds']):.4f}\n"
    concat += f"file '{frames[-1]['file']}'\n"
    (folder / "frames.txt").write_text(concat, encoding="utf-8")
    raw = folder / "raw.mp4"
    crop = data.get("crop")
    if args.short and not crop:
        crop = dict(x=10, y=75, width=1580, height=974)
    framing = f"crop={crop['width']}:{crop['height']}:{crop['x']}:{crop['y']}," if crop else ""
    run("-f", "concat", "-safe", "0", "-i", folder / "frames.txt", "-vf", framing + "scale=1280:800:force_original_aspect_ratio=decrease,pad=1280:800:(ow-iw)/2:(oh-ih)/2:color=white", "-r", "24", "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-pix_fmt", "yuv420p", raw)
    for i, chapter in enumerate(data["chapters"]):
        # The installed posted-pointer resize attempt did not change weights.
        # Keep the raw take as evidence, but do not present it as a successful demo.
        if phase == "columns" and chapter["en"] == "Drag the column divider to change the proportions":
            continue
        begin = max(0, chapter["seconds"] - frames[0]["seconds"])
        stop = (data["chapters"][i+1]["seconds"] if i+1 < len(data["chapters"]) else data["duration"]) - frames[0]["seconds"]
        length = stop - begin
        target = chapter.get("targetSeconds", 6 / len(data["chapters"]) if phase == "pdf" else None) if args.short else None
        if args.short and (target is None or target <= 0):
            raise RuntimeError(f"Short chapters need a positive duration: {phase}")
        if target is None:
            target = length if phase == "pdf" else min(16, max(5, length / 2.5))
        speed = length / target
        caption = style
        for name, key in [("Chinese", "zh"), ("English", "en")]:
            caption += f"Dialogue: 0,0:00:00.00,{stamp(target)},{name},,0,0,0,,{chapter[key]}\n"
        ass = folder / f"caption-{i}.ass"
        ass.write_text(caption, encoding="utf-8-sig")
        segment = folder / f"segment-{i}.mp4"
        # Relative filter paths avoid Windows drive-letter escaping in libass.
        ass_path = ass.relative_to(root).as_posix()
        fonts_path = fontdir.relative_to(root).as_posix()
        run("-ss", begin, "-t", length, "-i", raw, "-vf", f"setpts=(PTS-STARTPTS)/{speed},pad=1280:900:0:0:color=0x17191d,subtitles=filename={ass_path}:fontsdir={fonts_path}", "-an", "-r", "24", "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-pix_fmt", "yuv420p", segment)
        segments.append(segment)
        timeline.append(dict(seconds=total, zh=chapter["zh"], en=chapter["en"]))
        total += target

if args.short and total >= 60:
    raise RuntimeError(f"Short walkthrough must stay below one minute: {total}s")
playlist = work / "segments.txt"
playlist.write_text("\n".join(f"file '{p.relative_to(work).as_posix()}'" for p in segments), encoding="utf-8")
mp4 = root / "docs/media/preshot-demo.mp4"
gif = root / "docs/media/preshot-demo.gif"
run("-f", "concat", "-safe", "0", "-i", playlist, "-c", "copy", "-movflags", "+faststart", mp4)
palette = work / "palette.png"
run("-i", mp4, "-vf", "fps=4,scale=880:-1:flags=lanczos,palettegen=max_colors=96:stats_mode=diff", "-frames:v", "1", "-update", "1", palette)
run("-i", mp4, "-i", palette, "-filter_complex", "[0:v]fps=4,scale=880:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle", "-loop", "0", gif)
shutil.copyfile(work / "nanjing-bridge.pdf", root / "docs/media/preshot-demo.pdf")
(work / "timeline.json").write_text(json.dumps(dict(seconds=total, chapters=timeline), ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(dict(seconds=total, videoBytes=mp4.stat().st_size, gifBytes=gif.stat().st_size)))
