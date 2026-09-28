# Nanjing bridge portrait walkthrough

[Documentation index](../README.md)

The short walkthrough follows one portrait session at Nanjing Yangtze River
Bridge: create a project, write a shot list, add reference images, create a
fictional Model A and location/prop materials with sample images, reuse them,
export a PDF, and open it in Edge's PDF reader to inspect the finished pages.
The props are a transparent umbrella and a bubble machine. Model A is an
invented planning persona, not a real model or endorsement. The model, umbrella,
and bubble-machine images are original mock illustrations. The location card
includes a bridge photograph.

The recording operates the production React editor and library controls in
an isolated browser fixture. Project/library persistence and file pickers use
explicit demonstration adapters. This recording uses the real PDF exporter;
the exported file is opened in the actual Edge PDF reader in the recorded tab.
The ending shows every PDF page at normal speed. It is a UI walkthrough, not
evidence of native persistence or
Windows installer acceptance. Windows screen capture is explained at the
image-panel step; the recording does not simulate a successful Windows snip.

The refreshed recording is approximately two minutes long. New materials return
to the library automatically after their first confirmed save. The walkthrough
asserts that behaviour, then previews and reuses the saved items. Its actual
three-page PDF includes bridge, model, umbrella and bubble-machine images.
See the [acceptance record](../test_reports/msi-full-journey.md) for automated
results and the separate installed-desktop verification status.

## Media

- [README GIF](../media/preshot-demo.gif)
- [Captioned MP4](../media/preshot-demo.mp4), also prepared as a release asset.
- [Exported PDF example](../media/preshot-demo.pdf), the actual file opened at
  the end of the recording.
- The recording procedure is in `scripts/record-demo.mjs`.
- Downloaded reference images are kept in [photos](photos), with machine-readable
  [credits and hashes](photos/credits.json).
- Original mockup SVGs are kept in [illustrations](illustrations), alongside
  their generated PNG files in [photos](photos).

## Reproduce the recording

Install Microsoft Edge. The sample PNGs are committed; to regenerate them from
the original SVGs, run `node scripts/generate-demo-illustrations.mjs`.

Run `pnpm dev --mode e2e --host 127.0.0.1 --port 1447 --strictPort` in one terminal, then
`node scripts/record-demo.mjs` in another. The script uses isolated headless
Edge and saves its raw recording, chapter times, material screenshots, PDF-page
screenshots, and actual exported PDF under
`.preshot-build-cache/demo`. It never writes to the real project/library roots.
Review the raw video before rendering. Chapter timestamps initially use the
automation clock; align `chapters.json` to the recorded frames if Edge's video
encoder introduces timing drift. The final review must include the PDF closeups.
Avoid running initializer or packaging-script tests while recording; those
tests create temporary project trees that the development server may observe.
The recorder logs top-level navigations to help diagnose unexpected reloads.

Install FFmpeg with libass and libx264 support, then run
`python scripts/render-demo.py --ffmpeg <path-to-ffmpeg.exe>`. This produces
the captioned release MP4 in `.preshot-build-cache/release`, and copies the MP4
and README GIF to `docs/media`. It also copies the actual exported PDF to
`docs/media/preshot-demo.pdf`. Setup actions are accelerated; the PDF review
remains at normal speed so viewers can inspect the output. The raw recording
and local tools are not committed.

## Photo credits

| Image | Author | License | Source |
| --- | --- | --- | --- |
| Bridge in daylight | Jack No1 | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Nanjing_Yangtze_River_Bridge.jpg) |
| Bridge at night, Pukou | Vasily Astanin | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Nanjing_Yangtze_River_Bridge_Night_Pukou.jpg) |
| Model A, transparent umbrella, bubble machine | Preshot contributors | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Original SVG mock illustrations in [illustrations](illustrations) |

Photos were resized and recompressed to JPEG for this demo, and their display
frames may be adjusted in Preshot. Their original licenses apply. The demo
video/GIF and captions are distributed under CC BY-SA 4.0; this does not
change the separate licenses of Preshot source code and dependencies.
