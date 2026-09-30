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

- `.preshotproj`: manifest schema 1, editable plan schema 17, document version 5,
  `format: "preshot-blocks"`.
- Artifact blocks reference records in `plan.artifacts` by `artifactId`.
- Image-group blocks reference `plan.imageGroups` by `groupId`, exactly once
  in the document and once in the collection.
- Native media stores relative `media/<file>` paths; galleries use
  `references/`. Runtime data URLs never enter the manifest.
- Global library: database v10, portable payload v2 (v1 compatibility input), five UI categories and six
  compatible payload kinds. Immutable `storageId` identifies an image instance;
  `blobId` is an integrity hash, not file ownership.
- The per-user `%USERPROFILE%\.preshot\profile.json` locator points to the
  first-launch working directory (default `.preshot`). Settings, project registry,
  default projects and the material library share this root. Identity checks
  prevent a missing directory from silently creating replacement data.
  Existing `storage.json` library identities and legacy transfer receipts remain
  compatible; settings are mounted only after root confirmation.

## Rendering

The editor has a root vertical flow and optional root `columnList` rows with
two or more weighted `column` children. Columns hold vertical block flows;
nested column rows are rejected. v15/document-v3 inputs migrate before editing.
Cards and groups fill their container and grow with content. Gallery geometry
scales from a stable reference width in columns without rewriting image frames.
Image frames have eight resize zones.
dnd-kit previews image moves and commits only a valid drop. DOM queries stay
scoped to the owning editor across open projects.

PDF uses the BlockNote XL exporter and React-PDF; DOCX uses its XL exporter and
`docx`; long images use an export-only DOM surface and `modern-screenshot`'s
same-origin worker. Each pipeline prepares local assets before rendering.

The shared logo is `public/preshot-mark.png`, cropped from the supplied artwork
in `resources/branding/preshot-logo-original.png`. Its exterior background is
transparent; the street photographer, diagonal light and rounded charcoal frame
retain the supplied artwork without stretching. The square master is 1024px.
The app, browser favicon, and both READMEs use this same image.
`pnpm icons:generate` creates the native PNG, ICO, and ICNS resources from it;
the Windows build watches the ICO file.

See [Reliability](reliability.md), [Localization](i18n.md), and
[Build and test](build-and-test.md).
