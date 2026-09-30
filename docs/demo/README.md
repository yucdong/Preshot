# Nanjing bridge portrait walkthrough

[Documentation index](../README.md) · [Editable sample](../../samples/README.md)

Recorded and verified with **MSI-installed Preshot 0.0.24**. The 57.6-second
walkthrough starts in an empty recording workspace and builds one project
through the application UI, with Chinese/English captions and accelerated file
selection. The actual two-page PDF is exported and opened in the reader.
See the [release review](../test_reports/release-0.0.24-review.md) for validation.

Location, fictional Model A, transparent umbrella, bubble machine and lighting
reference materials are prepared before recording. The location includes three
credited bridge photos; Model A includes three original pose illustrations.
The walkthrough writes a complete shoot plan, inserts those materials at its
section headings, then drags the bubble-machine card beside the umbrella into
one two-column row. It reviews framing, exposure, direction, weather alternatives
and field checks, exports the document and opens every PDF page in Edge. The
final chapter creates one additional pictured material with searchable notes.

The recording profile must contain only this new project. Remove the startup
sample from that profile's project list and archive it outside its projects
folder before recording. Real user projects and the real library remain
untouched. The complete bundled sample is available separately; this short
workflow focuses on document authoring rather than every supported block.

## Media

- [33 focused tutorials for 0.0.24](material-tutorials.md), covering material
  creation, insertion and management, camera-photo orientation, project copying
  and settings. 32 use the installed app; C18 explicitly uses a browser
  clipboard/persistence fixture.

- [README GIF](../media/preshot-demo.gif), 880 px wide, 231 frames, 57.75 seconds.
- [Captioned MP4](../media/preshot-demo.mp4), 1280 × 900, 57.63 seconds.
- [Exported PDF](../media/preshot-demo.pdf), with ten images and expanded
  shooting notes; both exported pages are shown in the reader.
- [0.0.24 recording and release acceptance](../test_reports/release-0.0.24-review.md).
- [0.0.24 main recording acceptance](../test_reports/demo-rich-acceptance.md).
- [Historical 0.0.12 recording acceptance](../test_reports/short-demo-acceptance.md).
- [Earlier full installed acceptance and limitations](../test_reports/installed-demo-acceptance.md).
- [Photo credits and source hashes](photos/credits.json).
- [Original illustrations](illustrations), with PNGs in [photos](photos).

Model A is fictional; model and prop pictures are original mock illustrations.
The location photographs retain the credits below. Screenshot capture, media
playback and divider resizing are outside this condensed recording.

## Reproduce the short installed recording

Use Windows, the installed 0.0.24 MSI, Edge, Python with Pillow and FFmpeg with
libass/libx264. Always use an isolated recording profile, never a real profile.
Prepare the five pictured materials first, by saving the location, model, two
props and gallery from an isolated copy of the revised bundled sample through
the application's component menus. This preserves their three-picture galleries
and independent originals. The launcher defaults to
`%ProgramFiles%\Preshot\preshot.exe`; set `PRESHOT_DEMO_EXECUTABLE` for a custom
installation directory.

```powershell
$demoWork = '.preshot-build-cache/demo-rich-0.0.24'
node scripts/launch-installed-demo.mjs $demoWork
$demoProcess = [int](Get-Content "$demoWork/app-pid.txt")
powershell -NoProfile -File scripts/demo-desktop.ps1 -Action position -AppId $demoProcess
```

Confirm the isolated work path in the first-launch dialog before recording.
Before the first phase, use the project's menu to remove the auto-created sample
from the list. Archive only that recording profile's sample folder outside its
projects directory. Verify the launcher has no project cards. Keep the app open
between phases; restarting an empty profile would create a sample again.

Run each phase separately, inspecting its last screenshot and errors:

```powershell
powershell -NoProfile -File scripts/record-short-demo.ps1 -Phase author -Work $demoWork
powershell -NoProfile -File scripts/record-short-demo.ps1 -Phase reuse -Work $demoWork
powershell -NoProfile -File scripts/record-short-demo.ps1 -Phase layout -Work $demoWork
powershell -NoProfile -File scripts/record-short-demo.ps1 -Phase details -Work $demoWork
powershell -NoProfile -File scripts/record-short-demo.ps1 -Phase export -Work $demoWork
```

Open the newly exported `nanjing-bridge.pdf` in Edge and select **Fit to Page**.
Pass that reader's native window handle; its address and page numbers are checked.
Then return to the installed app for the closing material-creation chapter.

```powershell
powershell -NoProfile -File scripts/record-installed-demo-pdf.ps1 -WindowHandle <reader-window-handle> -Work $demoWork -Pages <actual-page-count> -TotalSeconds 8
powershell -NoProfile -File scripts/record-short-demo.ps1 -Phase material -Work $demoWork
python scripts/render-installed-demo.py --short --ffmpeg <path-to-ffmpeg.exe> --work $demoWork
python scripts/verify-rich-demo.py --ffmpeg <path-to-ffmpeg.exe> --work $demoWork
```

The Windows helpers operate UI controls, native file dialogs and `PrintWindow`.
They are calibrated to a 1600 × 1060 app window and English Windows dialogs.
Per-window `PrintWindow` capture and Windows UI Automation drive this recording.
No browser adapters, application IPC injection or live clipboard operations are
used. The visible desktop must remain available throughout recording.

The renderer rejects failed phases, assigns explicit chapter durations, crops
OS/browser chrome and rejects a short timeline of 60 seconds or more. Inspect
the encoded MP4/GIF duration and representative frames after rendering. Archive
failed takes before retrying; raw frames, profiles and tools remain Git-ignored.

The older `record-native-demo.ps1` and renderer without `--short` reproduce the
historical long walkthrough. `prepare-bundled-demo.py` generates the separate
complete offline template; it does not generate the document shown in this video.

## Photo credits

| Image | Author | License | Source |
| --- | --- | --- | --- |
| Daylight bridge | Jack No1 | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Nanjing_Yangtze_River_Bridge.jpg) |
| Night bridge, Pukou | Vasily Astanin | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Nanjing_Yangtze_River_Bridge_Night_Pukou.jpg) |
| Bridge panorama | Saigyouji-Noriko | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | [Source and hash](photos/credits.json) |
| Model A (three poses), umbrella, bubble machine | Preshot contributors | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | [Original SVG illustrations](illustrations) |

Photos were resized/recompressed and display frames may be cropped in Preshot.
Their original licenses apply. The sample plan, video/GIF and captions use
CC BY-SA 4.0, independently of application and dependency licenses.
