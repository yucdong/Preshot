# Licensing and Distribution

Preshot-authored source code is available under the MIT License in
[`LICENSE`](../LICENSE). Some optional BlockNote XL packages offer a choice of
`GPL-3.0 OR PROPRIETARY`; that choice affects distributions that include them.

## Open-source distribution policy

Preshot's open-source application distributions use the GPL-3.0 option for:

- `@blocknote/xl-multi-column@0.53.0`
- `@blocknote/xl-pdf-exporter@0.53.0`
- `@blocknote/xl-docx-exporter@0.53.0`

A distributed application build that includes any of these packages must
follow the existing GPL-3.0 obligations, including providing corresponding
source and license notices. The proprietary option requires a separate
BlockNote commercial license and is not the open-source path documented here.

The complete GPL-3.0 text is stored in
[`LICENSES/GPL-3.0.txt`](../LICENSES/GPL-3.0.txt). Package-specific attribution
and source links are maintained in
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

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
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

## SQLite metadata dependency

The global agent metadata store uses `rusqlite@0.37.0` under the MIT license
with its `bundled` feature. The bundled SQLite source is public domain. Version
and source attribution are maintained in
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

## GitHub Copilot SDK and managed CLI

The Rust dependency is pinned exactly to
`github-copilot-sdk@1.0.11` with only its `bundled-cli` feature enabled. The
SDK is MIT-licensed. It embeds the unmodified GitHub Copilot CLI release
artifact `1.0.79`; that signed artifact self-reports runtime version
`1.0.81-7`. Preshot does not enable the optional in-process transport.
The reviewed Windows x64 archive is 100,644,089 bytes and its unmodified
`copilot.exe` payload is 159,403,296 bytes. The archive SHA-256 is recorded in
the third-party notice and enforced by the native packaging contract.

The CLI has its own redistribution license. Preshot's distribution fits that
license's application-bundling conditions: the CLI remains unmodified, is not
offered standalone or as the primary product, and Preshot provides material
photography-planning functionality independently. The exact SDK and CLI
license texts and checksums are recorded in
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) and [`LICENSES`](../LICENSES).
Access to GitHub services is governed separately by the applicable GitHub and
GitHub Copilot terms.
