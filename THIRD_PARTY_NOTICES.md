# Third-Party Notices

## rusqlite and SQLite

- Crate: `rusqlite`
- Version: `0.37.0`
- License: MIT
- Source: <https://github.com/rusqlite/rusqlite>
- Bundled SQLite source: <https://www.sqlite.org/>
- SQLite status: public domain

Preshot enables rusqlite's `bundled` feature so the material content
store uses SQLite compiled with the
application instead of depending on a system SQLite installation.

## Material library native dependencies

| Crate | Pinned version | Purpose | License option used | Source |
| --- | --- | --- | --- | --- |
| `jieba-rs` | `0.8.1` | Offline Chinese segmentation with the embedded default dictionary | MIT | <https://github.com/messense/jieba-rs> |
| `sha2` | `0.10.9` | Original-image content hashes | MIT | <https://github.com/RustCrypto/hashes> |
| `fs2` | `0.4.3` | Cross-process library/project file locks | MIT | <https://github.com/danburkert/fs2-rs> |
| `unicode-normalization` | `0.1.24` | Display/search Unicode normalization | MIT | <https://github.com/unicode-rs/unicode-normalization> |

`sha2`, `fs2`, and `unicode-normalization` also offer Apache-2.0; Preshot uses
their MIT option. The embedded dictionary ships with `jieba-rs`; no dictionary
download, Java runtime, hosted search or external tokenizer service is used.
Upstream Jieba attribution is retained as well:
<https://github.com/fxsjy/jieba>.

Copyright notices from the selected MIT license files:

- `jieba-rs`: Copyright (c) 2018 - 2019 messense; Copyright (c) 2019 Paul Meng.
- Upstream Jieba: Copyright (c) 2013 Sun Junyi.
- `sha2`: Copyright (c) 2006-2009 Graydon Hoare; Copyright (c) 2009-2013 Mozilla Foundation; Copyright (c) 2016 Artyom Pavlov.
- `fs2`: Copyright (c) 2015 The Rust Project Developers.
- `unicode-normalization`: Copyright (c) 2015 The Rust Project Developers.

## Image clipboard and editor history dependencies

| Package or crate | Locked version | Purpose | License option used | Source |
| --- | --- | --- | --- | --- |
| `prosemirror-transform` | `1.12.0` | Accepted editor-history steps for gallery image paste | MIT | <https://github.com/ProseMirror/prosemirror-transform> |
| `gif` | `0.14.2` | Bounded first-frame GIF decoding | MIT | <https://github.com/image-rs/image-gif> |
| `color_quant` | `1.1.0` | Image codec dependency | MIT | <https://github.com/image-rs/color_quant> |
| `image-webp` | `0.2.4` | WebP decoding inside the memory-limited worker | MIT | <https://github.com/image-rs/image-webp> |

The GIF and WebP crates also offer Apache-2.0; Preshot uses their MIT option.
These codec features do not introduce a hosted conversion service.

Copyright notices from the selected upstream license files:

- `prosemirror-transform`: Copyright (C) 2015-2017 by Marijn Haverbeke <marijn@haverbeke.berlin> and others.
- `gif`: Copyright (c) 2015 nwin.
- `color_quant`: Copyright (c) 2016 PistonDevelopers.
- `image-webp`: its packaged MIT license contains no separate copyright line.

The following MIT permission and warranty notice applies to the material-library
and image-clipboard components listed above:

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

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
