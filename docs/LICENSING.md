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
