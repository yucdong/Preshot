# Third-Party Notices

## rusqlite and SQLite

- Crate: `rusqlite`
- Version: `0.37.0`
- License: MIT
- Source: <https://github.com/rusqlite/rusqlite>
- Bundled SQLite source: <https://www.sqlite.org/>
- SQLite status: public domain

Preshot enables rusqlite's `bundled` feature so the production agent metadata
store and separate material content store use SQLite compiled with the
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

The following MIT permission and warranty notice applies to these components:

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

## GitHub Copilot SDK for Rust

- Crate: `github-copilot-sdk`
- Version: `1.0.11`
- Copyright: GitHub, Inc.
- License: MIT
- Source: <https://github.com/github/copilot-sdk>
- crates.io checksum:
  `68e64592681b206e19d9bcd5b96e7cac2851fa5144df224a990b1158735d1a63`
- License text:
  [`LICENSES/GITHUB-COPILOT-SDK-MIT.txt`](LICENSES/GITHUB-COPILOT-SDK-MIT.txt)

Preshot enables only the SDK's `bundled-cli` feature. It does not enable
`bundled-in-process`; the SDK launches and manages a separate CLI child
process over stdio.

## GitHub Copilot CLI

- Component: GitHub Copilot CLI
- Release/archive and Windows file version: `1.0.79`
- Self-reported runtime version: `1.0.81-7`
- Copyright: GitHub, Inc.
- License: GitHub Copilot CLI License
- Source and releases: <https://github.com/github/copilot-cli>
- Windows x64 archive SHA-256:
  `ae87705442b502853374a58938ca48309b44ad1aef201e3de56b9ff89fe3b6bd`
- Windows x64 archive size: `100,644,089` bytes
- Unmodified `copilot.exe` size: `159,403,296` bytes
- License text:
  [`LICENSES/GITHUB-COPILOT-CLI-LICENSE.md`](LICENSES/GITHUB-COPILOT-CLI-LICENSE.md)

The unmodified CLI executable is embedded in Preshot through the SDK and is
extracted only when the managed service is started. Preshot provides material
photography-planning functionality independent of the CLI and does not
distribute the CLI as a standalone or primary product. Use of GitHub services
remains subject to the applicable GitHub and GitHub Copilot terms. The
checksum-matched `v1.0.79` Windows artifact reports `1.0.79` in its signed
Windows metadata but prints `GitHub Copilot CLI 1.0.81-7` from `--version`;
both upstream identifiers are retained here for auditability.

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
