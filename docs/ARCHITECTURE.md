# Architecture

## Scope

Preshot is a Windows-first desktop application for local photography planning. The shipping desktop path already covers project creation/opening, a BlockNote-based plan editor, project-local media management, persisted settings, and PDF export.

```text
Workspace launcher / app shell
  -> BlockNote project canvas provider
  -> domain plan service
  -> infrastructure adapter
  -> Tauri command
  -> Rust filesystem / dialog / OS integration
```

The mounted editor path in the app is `BlockNoteProjectCanvasProvider`; legacy canvas modules remain in the repository for compatibility, migration support, and shared layout logic, but they are not the primary UI route.

## Layers

- `src/app`: dependency composition, theme provider, workspace provider, and shell layout
- `src/features`: workspace launcher, settings UI, assistant preview UI, BlockNote editor, image-group UI, and save status
- `src/domain`: pure workspace/settings/plan models, services, ports, validation, migration, crop, and layout helpers
- `src/infrastructure`: Tauri/browser adapters, file dialogs, PDF exporter, and persistence wiring
- `src-tauri`: serializable native commands for project management, plan persistence, media import/load/remove, PDF save, reveal, settings, and screen capture

## Application flow

1. `WorkspaceProvider` loads recent projects and auto-opens the most recently edited available project.
2. `AppShell` renders the resizable project rail, center workspace, settings access, focus mode, and assistant preview panel.
3. `Workspace` mounts `BlockNoteProjectCanvasProvider` for the active project.
4. `BlockNoteProjectCanvasProvider` loads the plan through `BlockNotePlanService`, then loads referenced `references/` images and `media/` files.
5. `BlockNoteDocumentEditor` owns the live BlockNote instance; the provider reconciles its serialized document with `plan.imageGroups` and runtime-loaded media URLs.
6. PDF export goes through `createBlockNotePdfExporter`, then the PDF save target opens a native save dialog and calls the Rust `save_pdf` command.

Browser-only adapters exist for tests and Midscene-driven workflows, but production wiring uses the Tauri adapters.

## Persistence model

### Workspace metadata

Workspace recents are stored through the Tauri Store plugin in `workspace.json` with schema version 1. Each record tracks the project ID, path, cover reference, availability, timestamps, and `lastOpenedAt`.

### Project manifest

Each project directory contains `.preshotproj`. The manifest has `schemaVersion: 1` and currently stores:

- project identity and timestamps,
- an optional `coverImage`, and
- an optional `plan` JSON payload.

Legacy `.preshot` manifests are still accepted on read. When one is found, Rust rewrites it as `.preshotproj` and removes the old filename on a best-effort basis.

### Plan schema

The active editable plan is schema v14:

```json
{
  "schemaVersion": 14,
  "title": "...",
  "document": {
    "format": "preshot-blocks",
    "version": 2,
    "blocks": []
  },
  "imageGroups": []
}
```

The v14 document is validated in TypeScript before persistence. Key invariants:

- block IDs must be unique,
- `columnList` blocks are top-level only,
- `column` blocks may only exist under `columnList`,
- `imageGroup` blocks may be top-level or direct children of a `column`, and
- every image-group ID must appear exactly once in `document.blocks` and exactly once in `plan.imageGroups`.

Schema v13 plans are migrated in the load path to schema v14 / document v2. Older schemas are treated as incompatible and are not opened for editing.

### File layout inside a project

- `references/` stores imported reference JPG/PNG files.
- `media/` stores native BlockNote image/audio/video files.
- The manifest remains the source of truth for plan JSON; media and reference files are loaded lazily when the editor opens.

### App-level settings

App settings are stored in `%USERPROFILE%\.preshot\settings.json`. The current settings surface is:

- theme (`light`, `dark`, `system`),
- project-rail width, and
- assistant-panel width.

The default new-project parent directory is `%USERPROFILE%\.preshot\projects`.

## BlockNote editor model

Preshot uses BlockNote 0.53 with Mantine styling and the built-in Chinese dictionary. The active schema includes:

- `paragraph`
- `heading`
- `bulletListItem`
- `numberedListItem`
- `checkListItem`
- `toggleListItem`
- `quote`
- `codeBlock`
- `table`
- `divider`
- native `image`, `video`, and `audio`
- custom `imageGroup`
- `columnList` and `column` through `@blocknote/xl-multi-column@0.53.0`

### Custom image groups

`imageGroup` is a BlockNote block with no editable inline content. It stores only a primitive `groupId`; all group metadata lives in `plan.imageGroups`.

Each group record contains the image-group frame plus its images, including persisted frame sizes, aspect ratios, and optional crop data. The React block view resolves the metadata from context and handles:

- creating and cloning groups,
- importing images,
- Windows screen capture import,
- resize and crop updates,
- within-group and cross-group reordering, and
- lightbox opening.

### Multi-column layout

The multi-column extension is the source of `columnList` and `column` blocks. Preshot adds slash-menu entries for two-column and three-column layouts and enforces valid nesting when serializing the document.

### Native media

BlockNote native image/video/audio blocks use the editor `uploadFile` boundary. Runtime editing may use data URLs, but persisted JSON must store only relative `media/<file>` paths. In the exported PDF:

- image blocks render as embedded images when their source is project-local media,
- video blocks render as labeled fallback text, and
- audio blocks render as labeled fallback text.

## Editor behavior

The visible editor is one continuous white document surface inside a zoomable viewport; it is not an A4-paged runtime canvas.

Implemented editor behaviors include:

- auto-fit width on first load,
- manual zoom controls plus Ctrl+wheel zoom,
- a 5-second change-detected auto-save loop,
- Ctrl/Cmd+S immediate save,
- slash-menu insertion for image groups and columns,
- side-menu block duplication/move/delete helpers, and
- image/lightbox interactions that remain project-local.

## PDF export

`createBlockNotePdfExporter` converts the v14 block document directly into export blocks, lays them out against A4 content width, paginates at export time, and renders with bundled Noto Sans SC fonts.

Important consequences:

- the editor does not need to emulate paged PDF layout,
- image-group geometry and crops are consumed from persisted metadata,
- project-local media images can be embedded directly, and
- video/audio remain readable in PDF via fallback rows even though PDF cannot host an interactive player.

Saving the PDF uses a native dialog plus the narrow Rust `save_pdf` command for atomic writes.

## Native boundary

Direct `@tauri-apps/api` imports are confined to `src/infrastructure`. Native responsibilities are intentionally narrow:

- create/inspect/relocate-compatible project directories,
- read and write the manifest plan payload,
- import, load, and remove reference images,
- import, load, and remove native media,
- save PDF bytes,
- reveal project/output paths,
- start/poll/cancel Windows screen capture, and
- read/write app settings.

Rust commands should stay serializable and free of editor, layout, or business-rule logic.

## Localization and documentation

The runtime UI is Simplified Chinese and should stay that way unless the task explicitly changes localization. English documentation exists for contributors and maintenance work.

Use these companion documents:

- [Documentation index](README.md)
- [Testing](TESTING.md)
- [Reliability](RELIABILITY.md)
- [BlockNote v14 design](design_docs/blocknote_v14_design.md)
- [UI/UX contract](design_docs/UI_UX_CONTRACT.md)
- [Feature status tracker](design_docs/featurelist.json)
