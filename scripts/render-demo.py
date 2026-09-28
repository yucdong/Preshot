"""Render the recorded UI journey with bilingual captions, then a compact GIF.

Requires FFmpeg with libass and libx264; pass --ffmpeg or put it on PATH.
"""
import argparse
import json
import shutil
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"))
parser.add_argument("--gif-only", action="store_true")
args = parser.parse_args()
if not args.ffmpeg:
    parser.error("Pass --ffmpeg with the local FFmpeg executable")

root = Path(__file__).resolve().parent.parent
work = root / ".preshot-build-cache/demo"
release = root / ".preshot-build-cache/release"
release.mkdir(parents=True, exist_ok=True)
metadata = json.loads((work / "chapters.json").read_text(encoding="utf-8"))
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
chapters = metadata["chapters"]
begin = chapters[0]["seconds"]
end = metadata["duration"]
speed = max(1.5, (end - begin) / 100)
video = (work / "video-path.txt").read_text(encoding="utf-8").strip()
mp4 = release / f"Preshot-{version}-demo.mp4"
gif = root / "docs/media/preshot-demo.gif"


def timestamp(seconds):
    centiseconds = round(max(0, seconds) * 100)
    return f"{centiseconds // 360000}:{centiseconds // 6000 % 60:02}:{centiseconds // 100 % 60:02}.{centiseconds % 100:02}"


ass = """[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 900
WrapStyle: 2
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Chinese,Noto Sans SC,25,&H00FFFFFF,&H00FFFFFF,&H0017191D,&H0017191D,0,0,0,0,100,100,0,0,1,0,0,2,24,24,50,1
Style: English,Segoe UI,19,&H00B9BEC6,&H00B9BEC6,&H0017191D,&H0017191D,0,0,0,0,100,100,0,0,1,0,0,2,24,24,20,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
for index, chapter in enumerate(chapters):
    start_time = (chapter["seconds"] - begin) / speed
    next_time = (chapters[index + 1]["seconds"] if index + 1 < len(chapters) else end)
    stop_time = (next_time - begin) / speed
    for style, key in [("Chinese", "zh"), ("English", "en")]:
        ass += f"Dialogue: 0,{timestamp(start_time)},{timestamp(stop_time)},{style},,0,0,0,,{chapter[key]}\n"
(work / "captions.ass").write_text(ass, encoding="utf-8-sig")


def run(arguments):
    subprocess.run([args.ffmpeg, "-hide_banner", "-loglevel", "warning", "-y", *arguments], cwd=root, check=True)


filters = (f"trim=start={begin}:end={end},setpts=(PTS-STARTPTS)/{speed},"
           "pad=1280:900:0:0:color=0x17191d,"
           "subtitles=filename=.preshot-build-cache/demo/captions.ass:fontsdir=.preshot-build-cache/demo/fonts")
if not args.gif_only:
    fonts = work / "fonts"
    fonts.mkdir(exist_ok=True)
    for font in (root / "src/infrastructure/pdf/fonts").glob("*.ttf"):
        shutil.copyfile(font, fonts / font.name)
    run(["-i", video, "-vf", filters, "-an", "-r", "24", "-c:v", "libx264",
         "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(mp4)])
shutil.copyfile(mp4, root / "docs/media/preshot-demo.mp4")
palette = work / "palette.png"
run(["-i", str(mp4), "-vf", "fps=5,scale=880:-1:flags=lanczos,palettegen=max_colors=96:stats_mode=diff",
     "-frames:v", "1", "-update", "1", str(palette)])
run(["-i", str(mp4), "-i", str(palette), "-filter_complex",
     "[0:v]fps=5,scale=880:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
     "-loop", "0", str(gif)])
run(["-ss", "4", "-i", str(mp4), "-frames:v", "1", "-update", "1", str(work / "caption-preview.png")])
print(json.dumps({"mp4": str(mp4), "gif": str(gif), "seconds": round((end - begin) / speed, 1),
                  "gifBytes": gif.stat().st_size, "videoBytes": mp4.stat().st_size}, indent=2))
