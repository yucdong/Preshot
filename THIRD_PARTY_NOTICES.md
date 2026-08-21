# Third-Party Notices

## BlockNote XL Multi-Column

- Package: `@blocknote/xl-multi-column`
- Version: `0.53.0`
- Copyright: TypeCellOS / BlockNote contributors
- License: `GPL-3.0 OR PROPRIETARY`
- Source: <https://github.com/TypeCellOS/BlockNote>
- License text: [`LICENSES/GPL-3.0.txt`](LICENSES/GPL-3.0.txt)

Preshot uses the GPL-3.0 option. Distributed Preshot application builds that
include this package are provided under GPL-3.0 and include corresponding
source code. Preshot-authored source files remain available under the MIT
license in [`LICENSE`](LICENSE); the MIT license is GPL-compatible.

## BlockNote XL PDF Exporter

- Package: `@blocknote/xl-pdf-exporter`
- Version: `0.53.0`
- Copyright: TypeCellOS / BlockNote contributors
- License: `GPL-3.0 OR PROPRIETARY`
- Source: <https://github.com/TypeCellOS/BlockNote>
- License text: [`LICENSES/GPL-3.0.txt`](LICENSES/GPL-3.0.txt)

Preshot uses the GPL-3.0 option, matching the existing distribution treatment
for `@blocknote/xl-multi-column`. Distributed Preshot application builds that
include the PDF exporter are provided under GPL-3.0 with corresponding source
code and license notices.

## BlockNote XL DOCX Exporter

- Package: `@blocknote/xl-docx-exporter`
- Version: `0.53.0`
- Copyright: TypeCellOS / BlockNote contributors
- License: `GPL-3.0 OR PROPRIETARY`
- Source: <https://github.com/TypeCellOS/BlockNote>
- License text: [`LICENSES/GPL-3.0.txt`](LICENSES/GPL-3.0.txt)

Preshot uses the GPL-3.0 option for open-source distribution. Distributed
Preshot application builds that include the DOCX exporter are provided under
GPL-3.0 with corresponding source code and license notices. The proprietary
option would require a separate BlockNote commercial license and is not the
open-source distribution path documented by this repository.

Preshot uses the dependency for its production DOCX mappings, offline asset
resolution, image-group composition, ZIP packing, and desktop/browser export
workflow.

## docx

- Package: `docx`
- Version: `9.6.1`
- Copyright: Dolan Miu and docx contributors
- License: MIT
- Source: <https://github.com/dolanmiu/docx>

`docx` is the document-generation library used by the BlockNote XL DOCX
exporter. Its MIT license is GPL-compatible and does not change Preshot's
existing GPL obligations when an XL exporter is included in a distributed
application build.

## React-PDF Renderer

- Package: `@react-pdf/renderer`
- Version: `4.3.0`
- Copyright: React-PDF contributors
- License: MIT
- Source: <https://github.com/diegomura/react-pdf>

React-PDF is the production renderer used by the BlockNote XL PDF exporter.
Its MIT license is compatible with Preshot's distribution obligations.

## modern-screenshot

- Package: `modern-screenshot`
- Version: `4.7.0`
- Copyright: wxm and modern-screenshot contributors
- License: MIT
- Source: <https://github.com/qq15725/modern-screenshot>

Preshot includes this dependency behind a bounded infrastructure adapter for
the production long-image export workflow. BlockNote does not provide the
image exporter used by this feature: Preshot renders its shared schema on an
export-only DOM surface and captures bounded segments with `modern-screenshot`.
The adapter uses a same-origin worker, bundled fonts and project-local images,
rejects external capture resources, and explicitly releases its context,
workers, canvases, and offscreen surface.
