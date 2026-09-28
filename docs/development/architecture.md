# Architecture

[Documentation index](../README.md)

Preshot combines React/TypeScript, BlockNote 0.53/Mantine, and Tauri/Rust.
Project files and SQLite provide offline persistence.

```text
React UI -> domain service -> domain port -> infrastructure adapter -> Tauri/Rust
```

| Directory | Responsibility |
| --- | --- |
| `src/app` | Composition, shell, theme/language, project sessions |
| `src/features` | Workspace, editor, images, library, settings |
| `src/domain` | Pure models, validation, services, geometry, ports |
| `src/infrastructure` | Native/browser adapters, dialogs, exporters |
| `src/shared` | Generic UI, localization, logging, test utilities |
| `src-tauri/src` | Serializable file, SQLite, media, capture, export commands |

Domain code cannot import React, browser APIs, Tauri, or infrastructure.
Direct Tauri imports belong in infrastructure. Rust commands do not own UI
rules. `BlockNoteProjectCanvasProvider.tsx` owns the active plan/editor
boundary. Inactive open providers stay mounted but cannot receive active
shortcuts, clipboard, drag, or material insertion.

## Persisted data

- `.preshotproj`: manifest schema 1, editable plan schema 15, document version 3,
  `format: "preshot-blocks"`.
- Artifact blocks reference records in `plan.artifacts` by `artifactId`.
- Image-group blocks reference `plan.imageGroups` by `groupId`, exactly once
  in the document and once in the collection.
- Native media stores relative `media/<file>` paths; galleries use
  `references/`. Runtime data URLs never enter the manifest.
- Global library: database v6, portable payload v1, five UI categories and six
  compatible payload kinds. Immutable `storageId` identifies an image instance;
  `blobId` is an integrity hash, not file ownership.
- Global preferences and library live under `%USERPROFILE%\.preshot`.

## Rendering

The editor is one vertical flow with one block per visible row. Cards and
groups are full-width and content-height. Image frames have eight resize zones.
dnd-kit previews image moves and commits only a valid drop. DOM queries stay
scoped to the owning editor across open projects.

PDF uses the BlockNote XL exporter and React-PDF; DOCX uses its XL exporter and
`docx`; long images use an export-only DOM surface and `modern-screenshot`'s
same-origin worker. Each pipeline prepares local assets before rendering.

The logo source is `public/preshot-mark.svg`. `pnpm icons:generate` creates
native resources; the Windows build watches the ICO file.

See [Reliability](reliability.md), [Localization](i18n.md), and
[Build and test](build-and-test.md).
