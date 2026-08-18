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
6. Reference-image crop confirmation goes through the revision-aware queued
   domain service and a narrow begin/commit/rollback crop port backed by Rust.
7. PDF export goes through `createReactPdfBlockNoteExporter`, which uses
   `@blocknote/xl-pdf-exporter@0.53.0` with
   `@react-pdf/renderer@4.3.0`; the PDF save target then opens a native save
   dialog and calls the Rust `save_pdf` command.

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
- Confirmed reference-image crops retain the same `references/<file>` identity
  and physically replace only that project-owned bitmap. The external import
  source is not part of the project model and is never written after import.

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
- global image selection and double-click viewing,
- side-only current-ratio image resizing with live non-overlap wrapping,
- eight-direction group resizing and prioritized equal-size/edge guides,
- preset/free crop editing and project-copy overwrite,
- within-group and cross-group reordering, and
- lightbox opening.

The width-led layout computes ordered rows with a stable gap and returns the
derived content height. During an image resize, the same layout is used for the
live preview and pointer-up commit so wrapped positions and group height remain
coherent.

Crop confirmation converts normalized viewer geometry into strict source-pixel
bounds. `BlockNotePlanService` serializes the native overwrite with plan saves,
imports, removals, and retirement cleanup. Every metadata alias of the same
project file is then reset to the new bitmap dimensions, a full-image crop,
zero offsets, and a frame width derived from its retained height.

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
- single-click image selection/dragging and double-click full viewing,
- side-only ratio-locked image resize with live wrapping and dynamic height,
- edge/equal-size Smart Guide feedback, and
- crop presets, pan, zoom, reset/cancel/confirm, and project-local overwrite.

## PDF export

`createReactPdfBlockNoteExporter` is the production default. It snapshots the
v14 plan and resolved local asset map, builds deterministic preflight context,
converts the exact shared schema through the official
`@blocknote/xl-pdf-exporter@0.53.0` mappings, and renders with
`@react-pdf/renderer@4.3.0` to a browser-compatible Blob before adapting it to
the existing byte-oriented exporter/save contracts.

Important consequences:

- the editor does not need to emulate paged PDF layout,
- image-group geometry and crops are consumed from persisted metadata,
- a confirmed destructive crop exports the physically cropped project bitmap
  with full-image crop metadata, both immediately and after reload,
- project-local media images can be embedded directly, and
- video/audio remain readable in PDF via fallback rows even though PDF cannot host an interactive player.

Saving the PDF uses a native dialog plus the narrow Rust `save_pdf` command for atomic writes.

The production BlockNote React-PDF path has deterministic preflight and mapping
layers:

- `pdfVisualContract.ts` fixes A4 at 595.28 × 841.89pt with 24pt margins and a
  547.28pt content width, and owns the shared typography, spacing, color,
  border, column, and image-group tokens.
- `pdfExportPreflight.ts` validates marker/group integrity, walks root and
  weighted-column blocks in document order, and produces portable logical/PDF
  dimensions plus keep-together image-group geometry. Root groups use the
  1008-logical-unit content scale; column children use the persisted weights
  and width-conserving column rounding.
- `blockNotePdfPreflight.ts` receives the exact shared BlockNote schema and
  resolved project-local assets, measures native images, and invokes the
  injectable browser canvas optimizer at 144 DPI.
- Repeated assets are normalized by project-relative source and crop, then
  optimized once at the largest required draw box. Missing or corrupt data is
  rejected with block/group/image context.
- The immutable `PreshotPdfExportContext` contains block/group indexes,
  columns, slots, optimized assets, visual tokens, warnings, and fatal-error
  contracts. It contains no React-PDF types and does not use hosted proxies or
  private filesystem paths.
- `imageGroupPdfRenderModel.ts` resolves each marker through that context and
  produces a pure keep-together model using the exact root/column conversion,
  persisted frame height, wrapped slot geometry, optimized local assets, and
  preflight oversized scale. Positive group Y offsets become explicit flow-top
  padding and participate in the flow height and scale; negative offsets keep a
  non-negative footprint and remain relative visual positioning.
- `imageGroupPdfMapping.tsx` renders one relative `wrap={false}` flow wrapper,
  an optional positive-offset spacer, and one visual container with absolute
  image frames and no editor chrome. This applies the visible offset once while
  giving Yoga the complete keep-together footprint. A group that does not fit
  the remaining space moves intact to the next page; uniform scaling is applied
  only when its complete flow footprint is taller than one usable A4 page.
- `blockNoteReactPdfMappings.tsx` composes the official BlockNote 0.53 defaults
  with Preshot A4/type/spacing tokens for ordinary blocks, inline content, and
  styles. It registers bundled Noto Sans SC regular/bold, disables emoji
  networking, creates real PDF links, preserves weighted columns, and resolves
  images only through preflight assets. The custom image-group renderer remains
  a typed injected seam.
- Native image blocks are measured before mapping, preserve aspect ratio, and
  remain keep-together. Preflight loads the bundled Noto Sans SC regular-face
  metrics, wraps CJK characters and Latin words at the candidate image width,
  and iterates caption layout plus image scaling until the image, wrapped
  caption, and trailing spacing fit one usable page. The resulting line array
  is stored in the export context and rendered verbatim, so React-PDF cannot
  choose different line breaks after fitting.

Production, memory-browser, and Midscene composition select the React-PDF
adapter. The previous pdf-lib implementation remains explicitly constructible
as `createLegacyBlockNotePdfExporter` for acceptance comparison and rollback;
the production adapter never invokes it after a React-PDF failure.

The Tauri CSP remains least-privilege for this pipeline:
`script-src 'self' 'wasm-unsafe-eval'` permits the renderer's required WASM
execution without allowing general `unsafe-eval`; bundled Noto Sans SC files
are loaded from self under `default-src 'self'`; and `connect-src` is limited to
self plus the Tauri IPC origins. Hosted font, emoji, image, or asset proxies
are not permitted.

## Production DOCX export

`src/infrastructure/docx` contains the infrastructure-only BlockNote 0.53 DOCX
mapping, image-group compositor, production adapter, and save targets. It uses
the exact `preshotBlockNoteSchema`
instance and composes `docxDefaultSchemaMappings` with Preshot overrides rather
than maintaining a second document schema.

The ordinary mapping layer preserves editable paragraphs, H1-H6, all four list
kinds, quote/code/divider/page-break/table blocks, links, inline emphasis,
text/background colors, and alignment. Word `ilvl` is calculated only from
list ancestors; ordinary structural wrappers do not add a level, and entering
a `columnList` or `column` resets list context so every column starts at level
0. True nested lists preserve levels 0-8. Level 9 and deeper are rejected
before packing rather than silently clamped. Native images are embedded from
caller-supplied local Blob or data-URL values with aspect ratio, caption, and
alternative text. Audio, video, and file blocks become contextual hyperlinks
for external URLs or path-free fallback text for project-local/missing media.

Multi-column rows are represented by a borderless fixed-layout Word table.
The A4 body is 10,946 twips wide after 24pt margins; each 10pt inter-column gap
is exactly 200 twips, and the remaining integer twips are allocated
deterministically from persisted column weights. Mixed or long-text rows remain
splittable. `cantSplit` is emitted only for the conservative known-short
all-atomic set.

The factory configures A4 portrait, 24pt page margins, `zh-CN` styles, and
Chinese document metadata. It intentionally does not embed a Chinese font:
ordinary Chinese text uses Word/system fallback, so line breaks and final page
counts can vary between machines. Explicit page-break blocks remain stable,
but exact pagination is not a cross-system contract.

The production adapter snapshots the current plan and resolved asset map, runs
the same immutable offline geometry/asset preflight used by PDF, injects the
custom image-group mapping, asks `DOCXExporter` for a docx.js `Document`, and
packs it with `docx` `Packer` into validated ZIP bytes. DOCX/docx.js types stay
inside infrastructure.

Image resolution is private to the exporter. It accepts only supplied
`media/<file>`, `references/<file>`, or data-URL content and returns Blob data;
it never calls the BlockNote hosted CORS proxy, fetches the network, reads an
absolute filesystem path, or writes a local path into the DOCX. `imageGroup`
has a typed injected block-mapping seam and no ordinary-content fallback
renderer.

The provider exposes adjacent PDF and DOCX actions with independent progress
labels and one shared concurrency guard. Native DOCX saving uses a dedicated
`save_docx` command, defaults the dialog to `<project>\output.docx`, validates
the extension and parent directory, writes decoded bytes through a unique
UUID-named sibling temporary file, and atomically finalizes them. Windows
replacement retries only transient access, sharing, or lock conflicts so
concurrent PDF/DOCX saves cannot collide on a shared temporary name.
After a successful desktop write the existing normalized project-directory
revealer opens Explorer; cancellation and write failure never reveal, while a
reveal failure is a separate non-fatal notice. Browser, memory, and Midscene
composition downloads `output.docx` and skips reveal.

## Native boundary

Direct `@tauri-apps/api` imports are confined to `src/infrastructure`. Native responsibilities are intentionally narrow:

- create/inspect/relocate-compatible project directories,
- read and write the manifest plan payload,
- import, load, and remove reference images,
- validate, encode, atomically replace, commit, or roll back a cropped project
  reference image,
- import, load, and remove native media,
- save PDF or DOCX bytes through distinct commands,
- reveal project/output paths,
- start/poll/cancel Windows screen capture, and
- read/write app settings.

Rust commands should stay serializable and free of editor, layout, or business-rule logic.

`crop_reference_image` accepts only a project path, a project-relative
`references/` path, and integer pixel bounds. It validates containment and
bitmap bounds, writes a UUID-scoped sibling backup and a unique flushed
temporary crop, then uses an atomic replace operation. The matching commit and
rollback commands derive the backup path from the validated reference path and
UUID rather than accepting an arbitrary path. The domain layer decides which
plan records must be updated and retains the backup until the manifest save
succeeds.

## Localization and documentation

The runtime UI is Simplified Chinese and should stay that way unless the task explicitly changes localization. English documentation exists for contributors and maintenance work.

Use these companion documents:

- [Documentation index](README.md)
- [Testing](TESTING.md)
- [Reliability](RELIABILITY.md)
- [BlockNote v14 design](design_docs/blocknote_v14_design.md)
- [UI/UX contract](design_docs/UI_UX_CONTRACT.md)
- [Feature status tracker](design_docs/featurelist.json)
