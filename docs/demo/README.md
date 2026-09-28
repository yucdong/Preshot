# Nanjing bridge portrait walkthrough

[Documentation index](../README.md)

The short walkthrough follows one portrait session at Nanjing Yangtze River
Bridge: create a project, write a shot list, add reference images, create a
fictional Model A and location/prop materials, reuse them, and export the plan.
The props are a transparent umbrella and a bubble machine. Model A is an
invented planning persona, not a real model or endorsement.

The recording operates the production React editor and library controls in
an isolated browser fixture. Project/library persistence and file pickers use
explicit demonstration adapters; PDF, DOCX, and long-image rendering use the
real exporters. It is a UI walkthrough, not evidence of native persistence or
Windows installer acceptance. Windows screen capture is explained at the
image-panel step; the recording does not simulate a successful Windows snip.

## Media

- [README GIF](../media/preshot-demo.gif)
- The MP4 is prepared as a release asset, alongside the MSI.
- The recording procedure is in `scripts/record-demo.mjs`.
- Downloaded reference images are kept in [photos](photos), with machine-readable
  [credits and hashes](photos/credits.json).

## Reproduce the recording

Run `pnpm dev --mode e2e --host 127.0.0.1 --port 1447` in one terminal, then
`node scripts/record-demo.mjs` in another. The script uses isolated headless
Edge and saves its raw recording, chapter times, and actual exports under
`.preshot-build-cache/demo`. It never writes to the real project/library roots.

Install FFmpeg with libass and libx264 support, then run
`python scripts/render-demo.py --ffmpeg <path-to-ffmpeg.exe>`. This produces
the captioned release MP4 in `.preshot-build-cache/release` and the README GIF
in `docs/media`. The raw recording and local tools are not committed.

## Photo credits

| Image | Author | License | Source |
| --- | --- | --- | --- |
| Bridge in daylight | Jack No1 | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Nanjing_Yangtze_River_Bridge.jpg) |
| Bridge at night, Pukou | Vasily Astanin | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Nanjing_Yangtze_River_Bridge_Night_Pukou.jpg) |

Photos were resized and recompressed to JPEG for this demo, and their display
frames may be adjusted in Preshot. Their original licenses apply. The demo
video/GIF and captions are distributed under CC BY-SA 4.0; this does not
change the separate licenses of Preshot source code and dependencies.
