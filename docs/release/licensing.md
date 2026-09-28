# Licensing and Distribution

Preshot-authored source code is available under the MIT License in
[`LICENSE`](../../LICENSE). Some optional BlockNote XL packages offer a choice of
`GPL-3.0 OR PROPRIETARY`; that choice affects distributions that include them.

## Open-source distribution policy

Preshot's open-source application distributions use the GPL-3.0 option for:

- `@blocknote/xl-multi-column@0.53.0` (a transitive exporter dependency; the editor remains single-column)
- `@blocknote/xl-pdf-exporter@0.53.0`
- `@blocknote/xl-docx-exporter@0.53.0`

A distributed application build that includes any of these packages must
follow the existing GPL-3.0 obligations, including providing corresponding
source and license notices. The proprietary option requires a separate
BlockNote commercial license and is not the open-source path documented here.

The complete GPL-3.0 text is stored in
[`LICENSES/GPL-3.0.txt`](../../LICENSES/GPL-3.0.txt). Package-specific attribution
and source links are maintained in
[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).

## DOCX export dependencies

`@blocknote/xl-docx-exporter@0.53.0` is pinned to the same version as every
other BlockNote package. Its document-generation dependency, `docx@9.6.1`, is
MIT-licensed and GPL-compatible.

Preshot uses these dependencies in the production DOCX mapping, image-group
composition, packing, toolbar, and native/browser save flows.

The `docx` browser build includes the shims used by `Packer`. Preshot does not
add app-wide Buffer, process, or global polyfills.

## DOM capture dependency

`modern-screenshot@4.7.0` is pinned as an MIT-licensed browser dependency. Its
bounded infrastructure adapter powers the production offline long-image
pipeline through a same-origin worker. BlockNote supplies the shared document
schema and read-only render surface but no image exporter; no additional
BlockNote XL package or GPL option is introduced by long-image export.
Attribution is maintained in
[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).

## SQLite and material search dependencies

The global material content store uses
`rusqlite@0.37.0` under the MIT license with its `bundled` feature. The bundled
SQLite source is public domain. The material library also pins
`jieba-rs@0.8.1` with its embedded default dictionary, `sha2@0.10.9`,
`fs2@0.4.3`, and `unicode-normalization@0.1.24`. Their MIT license options are
GPL-compatible. Version, source attribution, copyright and MIT notices are
maintained in the installer-bundled
[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).

## Image clipboard dependencies

Image clipboard history directly pins the already-used
`prosemirror-transform@1.12.0` under MIT. Enabling GIF/WebP support on the existing
Rust `image` dependency adds locked `gif@0.14.2`, `color_quant@1.1.0` and
`image-webp@0.2.4`. Preshot selects their MIT license options; these remain
GPL-compatible and run locally. Their attribution and MIT permission notice
are included in the installer-bundled
[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).
