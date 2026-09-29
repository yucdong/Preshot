# Nanjing bridge portrait walkthrough

[Documentation index](../README.md) · [Editable sample](../../samples/README.md)

The current walkthrough is recorded from **MSI-installed Preshot 0.0.12** with
the new project logo. It starts in an empty recording workspace and builds one
new project through the application UI. The final edit stays below one minute,
with Chinese/English captions and accelerated file selection.

Location, fictional Model A, transparent umbrella, bubble machine, image-group
and single-image materials are prepared before recording. The video writes a
concept and schedule, drags text blocks into two columns, reuses pictured
materials, adds a checklist, customizes prop names, exports the new document and
opens both PDF pages in Edge. The final chapter creates one additional pictured
material, including its description and search keywords, saves it and previews
its committed content.

The recording profile contains only this new project. The startup sample was
removed from that profile's project list and archived outside its projects
folder before recording. Real user projects and the real library are untouched.
The complete bundled sample remains available separately; this short video does
not switch to it or claim to demonstrate all 22 supported blocks.

## Media

- [README GIF](../media/preshot-demo.gif), 880 px wide, 57.75 seconds, approximately 4 MB.
- [Captioned MP4](../media/preshot-demo.mp4), 1280 × 900, 57.63 seconds, approximately 2.4 MB.
- [Exported PDF](../media/preshot-demo.pdf), the two-page document created on camera.
- [Short recording acceptance](../test_reports/short-demo-acceptance.md).
- [Earlier full installed acceptance and limitations](../test_reports/installed-demo-acceptance.md).
- [Photo credits and source hashes](photos/credits.json).
- [Original illustrations](illustrations), with PNGs in [photos](photos).

Model A is fictional; model and prop pictures are original mock illustrations.
The location photographs retain the credits below. Screenshot capture, media
playback and divider resizing are outside this condensed recording.

## Reproduce the short installed recording

Use Windows, the installed 0.0.12 MSI, Edge, Python with Pillow and FFmpeg with
libass/libx264. Always use an isolated recording profile, never a real profile.
Prepare the six pictured materials first. A copy of the earlier isolated demo
library can be used while both source and destination apps are stopped.

```powershell
node scripts/launch-installed-demo.mjs .preshot-build-cache/installed-demo-short
$demoProcess = [int](Get-Content .preshot-build-cache/installed-demo-short/app-pid.txt)
powershell -NoProfile -File scripts/demo-desktop.ps1 -Action position -AppId $demoProcess
```

Before the first phase, use the project's menu to remove the auto-created sample
from the list. Archive only that recording profile's sample folder outside its
projects directory. Verify the launcher has no project cards. Keep the app open
between phases; restarting an empty profile would create a sample again.

Run each phase separately, inspecting its last screenshot and errors:

```powershell
powershell -NoProfile -File scripts/record-short-demo.ps1 -Phase author
powershell -NoProfile -File scripts/record-short-demo.ps1 -Phase reuse
powershell -NoProfile -File scripts/record-short-demo.ps1 -Phase layout
powershell -NoProfile -File scripts/record-short-demo.ps1 -Phase details
powershell -NoProfile -File scripts/record-short-demo.ps1 -Phase export
```

Open the newly exported `nanjing-bridge.pdf` in Edge and select **Fit to Page**.
Pass that reader's native window handle; its address and page numbers are checked.
Then return to the installed app for the closing material-creation chapter.

```powershell
powershell -NoProfile -File scripts/record-installed-demo-pdf.ps1 -WindowHandle <reader-window-handle> -Work .preshot-build-cache/installed-demo-short -Pages 2
powershell -NoProfile -File scripts/record-short-demo.ps1 -Phase material
python scripts/render-installed-demo.py --short --ffmpeg <path-to-ffmpeg.exe> --work .preshot-build-cache/installed-demo-short
```

The Windows helpers operate UI controls, native file dialogs and `PrintWindow`.
They are calibrated to a 1600 × 1060 app window and English Windows dialogs.
UI Automation/posted messages remain the fallback because Midscene desktop
capture returns an invalid desktop handle on this session. No browser adapters,
application IPC injection or live clipboard operations are used.

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
| Model A, umbrella, bubble machine | Preshot contributors | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | [Original SVG illustrations](illustrations) |

Photos were resized/recompressed and display frames may be cropped in Preshot.
Their original licenses apply. The sample plan, video/GIF and captions use
CC BY-SA 4.0, independently of application and dependency licenses.
