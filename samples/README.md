# Bundled sample projects

[Documentation index](../docs/README.md)

`nanjing-bridge` is an editable, offline project for a fictional portrait session
at Nanjing Yangtze River Bridge. In Preshot, use **Open project** and select this
folder (copy it first if you want to preserve the repository version).

On an empty Windows profile, application startup copies this sample to
`%USERPROFILE%\.preshot\projects\南京长江大桥 · 演示项目` and assigns a new project
identity. All images and attachments belong to that copy. Existing registered
projects or an existing default-root project take precedence and are never
overwritten. The MSI embeds the template in application files; it does not write
profile data. After an upgrade, copy
`%ProgramFiles%\Preshot\samples\nanjing-bridge` to your project directory
and open that copy. Keep the installed template unchanged for future upgrades.

The project includes all 22 supported document block types, two- and three-column
rows, five photography cards, an image group, a standalone image, a schedule,
lists, a toggle, a quote, code, a page break, a downloadable file, a short video
and audio. The transparent umbrella and bubble machine share one two-column
row. The location has three credited bridge photographs; fictional Model A has
three original pose illustrations (portrait, walking and umbrella). The plan
also includes framing, exposure, pose direction, weather alternatives, field
checks and a twelve-picture delivery goal. Model A and prop pictures are
illustrations. The video pans a credited
bridge photograph; the audio is synthesized. Static exports describe media
attachments; playback stays in the project.

See [credits](nanjing-bridge/CREDITS.md), the
[recording guide](../docs/demo/README.md), and the
[current walkthrough acceptance](../docs/test_reports/demo-rich-acceptance.md).
This revised template is packaged by subsequent builds; an already-built MSI
retains its earlier template. Copy the repository sample to use the revision now.
The sample plan and original mock assets use CC BY-SA 4.0; the photographs retain
their individual licenses. `scripts/prepare-bundled-demo.py` regenerates the plan
and copied pictures from the credited source assets (Python and Pillow required).
