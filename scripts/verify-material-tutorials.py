"""Verify release tutorial takes and encoded videos without replacing old evidence.

Example:
  python scripts/verify-material-tutorials.py --work <recording-directory> \
    --ffmpeg <ffmpeg.exe> --cases C01 C02 C18 W01 W02

The recording version is evidence from the recorder, not inferred from the
current package version. C18 records browser fixtures, not native clipboard/MSI
integration. Contact sheets aid human review; decoding cannot establish that
every demonstrated UI operation has the intended result.
"""

import argparse
import hashlib
import io
import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
CASE_PATTERN = re.compile(r"[CIMW]\d{2}\Z")
VERSION_PATTERN = re.compile(r"\d+\.\d+\.\d+(?:\.\d+)?\Z")
WIDTH, HEIGHT = 1280, 900


class VerificationError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise VerificationError(message)


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def located(value):
    path = Path(value)
    return (path if path.is_absolute() else ROOT / path).resolve()


def display_path(path):
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def number(value, label, positive=False):
    require(type(value) in (int, float) and math.isfinite(value), f"{label} must be finite")
    require(value > 0 if positive else value >= 0, f"{label} is out of range")
    return value


def validate_recording(work, case, expected_version):
    folder = work / case
    manifest = folder / "recording.json"
    data = json.loads(manifest.read_text(encoding="utf-8-sig"))
    require(isinstance(data, dict) and data.get("phase") == case, "Recording phase does not match case")
    require(data.get("errors") == [], f"Recording contains errors: {data.get('errors')!r}")
    version = data.get("version")
    require(isinstance(version, str) and VERSION_PATTERN.fullmatch(version), "Missing/invalid recorded version")
    require(version.split(".")[:3] == expected_version.split(".")[:3],
            f"Recorded version {version} does not match expected {expected_version}")
    if len(expected_version.split(".")) == 4:
        require(version == expected_version, "Recorded EXE build version does not match expected version")
    declared_environment = data.get("environment", "")
    require(isinstance(declared_environment, str), "Invalid recording environment")
    if case == "C18":
        require(all(word in declared_environment.lower() for word in ("browser", "clipboard", "persistence")),
                "C18 must explicitly identify the browser clipboard/persistence fixture")
        environment = "browser-fixture"
    else:
        require("browser" not in declared_environment.lower(), "Native tutorial declares a browser environment")
        environment = "native-windows-exe"

    duration = number(data.get("duration"), "Recording duration", positive=True)
    frames, chapters = data.get("frames"), data.get("chapters")
    require(isinstance(frames, list) and frames, "Recording has no frames")
    require(isinstance(chapters, list) and chapters, "Recording has no chapters")
    crop = data.get("crop")
    require(isinstance(crop, dict), "Recording has no crop rectangle")
    for key in ("x", "y", "width", "height"):
        number(crop.get(key), f"Crop {key}", positive=key in ("width", "height"))
        require(type(crop[key]) is int, f"Crop {key} must be an integer")

    previous = -1
    seen = set()
    timeline = []
    representatives = []
    representative_indices = {0, len(frames) // 2, len(frames) - 1}
    for index, frame in enumerate(frames):
        require(isinstance(frame, dict), f"Frame {index} is invalid")
        seconds = number(frame.get("seconds"), f"Frame {index} timestamp")
        require(previous < seconds < duration, f"Frame {index} timestamps are unordered/outside the take")
        previous = seconds
        name = frame.get("file")
        require(isinstance(name, str) and name and Path(name).name == name and "/" not in name and "\\" not in name,
                f"Frame {index} must use a local filename")
        path = (folder / name).resolve()
        require(path.parent == folder.resolve() and name not in seen, f"Frame {index} escapes/repeats a source file")
        seen.add(name)
        require(path.is_file() and path.stat().st_size > 0, f"Missing/empty frame: {name}")
        timeline.append({"file": name, "seconds": seconds, "bytes": path.stat().st_size})
        if index in representative_indices:
            with Image.open(path) as source:
                source.load()
                require(crop["x"] + crop["width"] <= source.width and crop["y"] + crop["height"] <= source.height,
                        f"Crop exceeds recorded frame: {name}")
                representatives.append({**timeline[-1], "width": source.width, "height": source.height,
                                        "sha256": sha256(path)})

    previous = -1
    planned_seconds = 0
    for index, chapter in enumerate(chapters):
        require(isinstance(chapter, dict), f"Chapter {index} is invalid")
        seconds = number(chapter.get("seconds"), f"Chapter {index} timestamp")
        require(previous < seconds < duration, f"Chapter {index} timestamps are unordered/outside the take")
        previous = seconds
        planned_seconds += number(chapter.get("targetSeconds"), f"Chapter {index} target duration", positive=True)
        require(all(isinstance(chapter.get(key), str) and chapter[key].strip() for key in ("zh", "en")),
                f"Chapter {index} lacks Chinese/English captions")
    require(0 < planned_seconds < 59, f"Planned timeline must be below 59 seconds: {planned_seconds}")
    require(chapters[-1]["seconds"] >= frames[0]["seconds"], "All chapters precede the first frame")
    return {
        "case": case,
        "recordedVersion": version,
        "recordedExeVersion": version if environment == "native-windows-exe" else None,
        "environment": environment,
        "environmentDetail": declared_environment or "Windows UI Automation / PrintWindow; EXE version from recorder",
        "versionSource": "recording.json:version",
        "recording": display_path(manifest),
        "recordingSha256": sha256(manifest),
        "rawDurationSeconds": duration,
        "frameCount": len(frames),
        "frameTimelineSha256": hashlib.sha256(json.dumps(timeline, sort_keys=True).encode("utf-8")).hexdigest(),
        "representativeRawFrames": representatives,
        "chapterCount": len(chapters),
        "chapters": chapters,
        "plannedSeconds": planned_seconds,
        "recordingMtimeNs": manifest.stat().st_mtime_ns,
    }


def ffmpeg_call(ffmpeg, arguments):
    result = subprocess.run([ffmpeg, "-nostdin", "-hide_banner", *map(str, arguments)],
                            capture_output=True, timeout=180)
    require(result.returncode == 0, "ffmpeg failed: " + result.stderr.decode("utf-8", errors="replace")[-4000:])
    return result


def verify_video(ffmpeg, media, entry):
    video = media / f"{entry['case']}.mp4"
    require(video.is_file() and video.stat().st_size > 0, f"Missing/empty published video: {video}")
    require(video.stat().st_mtime_ns >= entry["recordingMtimeNs"], "Published video predates this take; render it again")
    # ffmpeg's input-only inspection normally exits 1 because no output was requested.
    probe = subprocess.run([ffmpeg, "-nostdin", "-hide_banner", "-i", str(video)],
                           capture_output=True, timeout=30)
    metadata = probe.stderr.decode("utf-8", errors="replace")
    match = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", metadata)
    require(match is not None, "Cannot read the encoded duration")
    h, m, s = map(float, match.groups())
    seconds = h * 3600 + m * 60 + s
    require(0 < seconds < 60, f"Encoded duration must be below 60 seconds: {seconds}")
    sizes = re.findall(r"Video:[^\r\n]*?\b(\d{2,5})x(\d{2,5})\b", metadata)
    require(sizes == [(str(WIDTH), str(HEIGHT))], f"Expected exactly one {WIDTH}x{HEIGHT} video stream, got {sizes}")
    require(abs(seconds - entry["plannedSeconds"]) <= 1, "Encoded duration differs from this take's planned timeline by over 1 second")
    decoded = ffmpeg_call(ffmpeg, ["-v", "error", "-xerror", "-err_detect", "explode", "-i", video,
                                  "-map", "0:v:0", "-map", "0:a?", "-progress", "pipe:1", "-nostats", "-f", "null", "-"])
    progress = decoded.stdout.decode("utf-8", errors="replace").replace("\r\n", "\n")
    frame_counts = re.findall(r"^frame=(\d+)$", progress, re.MULTILINE)
    require(frame_counts and int(frame_counts[-1]) > 0 and "progress=end" in progress, "Full decode did not complete")
    require(not decoded.stderr.strip(), "Decoder reported errors: " + decoded.stderr.decode("utf-8", errors="replace")[-2000:])
    entry.update({"video": display_path(video), "seconds": seconds, "width": WIDTH, "height": HEIGHT,
                  "bytes": video.stat().st_size, "sha256": sha256(video), "decodedFrames": int(frame_counts[-1]),
                  "fullDecode": "passed", "sourceFreshness": "video mtime is not older than recording.json"})
    return video


def make_contact_sheet(ffmpeg, media, entries, path):
    sheet = Image.new("RGB", (1200, 315 * len(entries)), "#17191d")
    draw = ImageDraw.Draw(sheet)
    for row, entry in enumerate(entries):
        video = media / f"{entry['case']}.mp4"
        entry["contactSheet"] = path.name
        entry["encodedSamplesSeconds"] = []
        for column, fraction in enumerate((0.15, 0.5, 0.9)):
            seconds = round(entry["seconds"] * fraction, 3)
            entry["encodedSamplesSeconds"].append(seconds)
            sample = ffmpeg_call(ffmpeg, ["-v", "error", "-ss", seconds, "-i", video,
                                          "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"])
            with Image.open(io.BytesIO(sample.stdout)) as source:
                source.load()
                require(source.size == (WIDTH, HEIGHT), "Encoded sample has unexpected dimensions")
                frame = source.convert("RGB").resize((400, 281), Image.Resampling.LANCZOS)
            x, y = column * 400, row * 315
            sheet.paste(frame, (x, y))
            environment = "browser fixture" if entry["environment"] == "browser-fixture" else "EXE"
            label = f"{entry['case']} | {environment} {entry['recordedVersion']} | {seconds:.1f}s"
            draw.text((x + 8, y + 292), label, fill="white")
    sheet.save(path, quality=88)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--work", required=True, help="Directory containing CASE/recording.json and raw frames")
    parser.add_argument("--ffmpeg", required=True, help="Existing ffmpeg executable; no downloads are performed")
    parser.add_argument("--cases", nargs="+", required=True, help="Exact expected case IDs; missing/failed takes are fatal")
    parser.add_argument("--version", help="Expected x.y.z (or exact x.y.z.build); defaults to package.json")
    parser.add_argument("--media-dir", default="docs/media/material-tutorials")
    parser.add_argument("--report-dir", help="Default: docs/test_reports/media/release-VERSION; existing evidence is never overwritten")
    args = parser.parse_args()
    version = args.version or json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    require(VERSION_PATTERN.fullmatch(version), "Expected version must be x.y.z or x.y.z.build")
    require(all(CASE_PATTERN.fullmatch(case) for case in args.cases), "Case IDs must be C/I/M/W followed by two digits")
    require(len(set(args.cases)) == len(args.cases), "Duplicate requested case IDs")
    ffmpeg = shutil.which(args.ffmpeg) or str(located(args.ffmpeg))
    require(Path(ffmpeg).is_file(), f"ffmpeg executable not found: {args.ffmpeg}")
    work, media = located(args.work), located(args.media_dir)
    require(work.is_dir(), f"Recording directory not found: {work}")
    report = located(args.report_dir or f"docs/test_reports/media/release-{version}")
    names = ["tutorial-videos.json"] + [f"tutorial-contact-{index + 1:03}.jpg" for index in range(math.ceil(len(args.cases) / 3))]
    require(not any((report / name).exists() for name in names), "Evidence already exists; select a fresh --report-dir")

    entries, failures = [], []
    for case in args.cases:
        try:
            entry = validate_recording(work, case, version)
            verify_video(ffmpeg, media, entry)
            entries.append(entry)
            print(f"Verified {case}: {entry['seconds']:.2f}s, {entry['environment']}, version {entry['recordedVersion']}", flush=True)
        except (VerificationError, OSError, ValueError, subprocess.SubprocessError) as error:
            failures.append(f"{case}: {error}")
            print(f"FAILED {failures[-1]}", file=sys.stderr, flush=True)
    require(not failures, "No release evidence published because verification failed:\n" + "\n".join(failures))

    with tempfile.TemporaryDirectory(prefix="tutorial-review-", dir=work) as temporary:
        staging = Path(temporary)
        for offset in range(0, len(entries), 3):
            make_contact_sheet(ffmpeg, media, entries[offset:offset + 3], staging / names[offset // 3 + 1])
        inventory = {
            "reportVersion": 1, "expectedVersion": version,
            "verifiedAtUtc": datetime.now(timezone.utc).isoformat(),
            "recordingWorkDirectory": display_path(work), "requestedCases": args.cases,
            "videoCount": len(entries), "allDecoded": True,
            "totalBytes": sum(entry["bytes"] for entry in entries),
            "scope": "Encoded-file integrity, timing, recording provenance and representative frames; UI semantics require human review.",
            "limitations": "C18 uses browser in-memory clipboard/persistence; it does not verify Windows clipboard or MSI integration. Recorded EXE versions are supplied by the native recorder.",
            "videos": entries,
            "contactSheets": [{"file": name, "sha256": sha256(staging / name)} for name in names[1:]],
        }
        # Preserve bilingual caption values with JSON escapes so generated
        # evidence follows the repository's English documentation source rule.
        (staging / names[0]).write_text(json.dumps(inventory, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
        report.mkdir(parents=True, exist_ok=True)
        published = []
        try:
            for name in names:
                # Exclusive creation avoids accidental replacement, even if another verifier races us.
                with (report / name).open("xb") as target:
                    published.append(report / name)
                    with (staging / name).open("rb") as source:
                        shutil.copyfileobj(source, target)
        except OSError:
            for path in published:
                path.unlink(missing_ok=True)
            raise
    print(json.dumps({"videos": len(entries), "allDecoded": True, "expectedVersion": version,
                      "inventory": display_path(report / names[0])}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except (VerificationError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"Tutorial verification failed: {error}", file=sys.stderr)
        sys.exit(1)
