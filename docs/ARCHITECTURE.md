# Architecture

## Goals

Preshot targets Windows desktop first, keeps project work local and
offline-capable, isolates native APIs, and preserves a path to future Android
and iOS clients.

This foundation intentionally avoids choosing persistence and global state
management before the first real workflow needs them.

## System Shape

```text
React application
  |
  +-- app -------- startup, providers, layout, failure boundary
  +-- features --- canvas, assets, copywriting, export
  +-- domain ----- models, use cases, platform ports
  +-- shared ----- reusable UI and general utilities
  |
  +-- infrastructure -- browser and Tauri adapters
                               |
                               v
                         Tauri commands
                               |
                               v
                      Windows native services
```

The dependency direction is:

```text
app/features -> domain <- infrastructure
      |                       |
      +--------> shared <-----+
```

`domain` does not depend on React, Tauri, a browser, or a storage engine.

## Frontend Areas

### `src/app`

Owns application startup and composition. It wires feature UI to use cases and
adapters. The error boundary is a final guard for unexpected render failures,
not a replacement for normal error states.

### `src/features`

Each capability owns its UI, local orchestration, and feature-specific tests.
`workspace` and `plan` are the currently implemented capabilities: the project
switcher shell, recent-project launcher, in-project plan editing, and PDF
export flow. Planned capabilities still include canvas, asset ingestion, and
copywriting. Create a feature directory only when that capability is
implemented.

### `src/domain`

Contains pure TypeScript models, ports, and use cases. `src/domain/workspace`
defines the workspace vocabulary (`WorkspaceProjectRecord`, `ProjectManifest`,
`WorkspaceMetadata`), the platform ports (`WorkspaceRegistry`, `NativeWorkspace`,
`WorkspaceDirectoryPicker`, `WorkspaceLogger`), and the `WorkspaceService` use
case that serializes every mutation. Future planning models and their
integration ports will live here too, staying free of React, Tauri, and browser
APIs.

### `src/infrastructure`

Implements domain ports. This is the only frontend area allowed to import
`@tauri-apps/api`. Adapters add operation context to native or browser errors
before returning them to callers. `src/infrastructure/workspace` provides the
Tauri Store, Dialog, and native-command adapters, plus an in-memory browser
adapter used only by end-to-end tests.

### `src/shared`

Contains reusable UI primitives, testing setup, and general utilities. It must
not contain feature rules or platform integration.

## Native Boundary

`src-tauri` owns the application window, capabilities, and narrow Rust
commands. Command arguments and results must serialize cleanly. Native code
should handle operating-system concerns, while business decisions remain in
the domain layer.

The current `platform_info` command and its TypeScript adapter demonstrate the
boundary. Add permissions only when a command requires them; keep Tauri
capabilities least-privilege.

## Workspace Setup

Workspace Setup is the first end-to-end vertical slice and demonstrates the
intended layering: React UI -> `WorkspaceService` use case -> domain port ->
infrastructure adapter -> Tauri command -> Windows filesystem.

### Metadata and manifests

Two independent, versioned stores back the feature:

- **`workspace.json`** lives in the platform AppData directory and is owned by
  the Tauri Store adapter (`src/infrastructure/workspace/workspaceStore.ts`). It
  records the user's recent projects as a `schemaVersion: 1` document. The
  adapter and the domain service both reject unknown or malformed schemas rather
  than guessing.
- **`.preshot`** is a per-project manifest written into each project folder by
  the Rust `create_project` command. It is also `schemaVersion: 1` and carries
  the project identity (`id`, `name`, timestamps, optional `coverImage`). A
  folder is a Preshot project only if it contains a readable `.preshot`
  manifest, which keeps projects portable: moving a folder preserves its
  identity, and relocation is authorized only when the manifest ID matches the
  stored record.

### Navigation shell

On startup `WorkspaceProvider` loads the registry and, when at least one
available project exists, auto-opens the most recently edited one
(`updatedAt` descending) straight into the `AppShell` — the launcher is not a
mandatory start page. The `AppShell` left rail is a project switcher: it lists
every project sorted by most recent edit, highlights the current one
(`aria-current="page"`), and switches projects through the same
`WorkspaceService.openProject` flow when clicked. Its footer exposes New Project
and Open Project. Below the header, `AppShell` lays out three columns — the
project switcher rail (~15%), the plan workspace (~60%), and a right `AgentPanel`
Assistant preview (~25%) whose disabled bottom input is reserved for a future
planning agent. The `WorkspaceLauncher` (recent-project gallery, relocate, and
remove) is shown only when no available project exists, and clicking an
unavailable project in the rail returns there to recover it.

### Boundaries

- The domain `WorkspaceService` owns all rules and serializes every mutation
  through an internal queue so concurrent actions cannot interleave.
- The Store adapter only loads and saves `workspace.json`.
- The Dialog adapter only selects a directory.
- The native-command adapter (`tauriWorkspace.ts`) wraps the Rust
  `create_project`, `inspect_project`, `rollback_created_project`, and
  `forget_created_project` commands and validates every response shape.
- `RichTextEditor` is the shared rich-text editor, now wrapping **BlockNote**
  (`useCreateBlockNote` + `@blocknote/mantine` `BlockNoteView`) in place of
  TipTap. It converts HTML at the boundary (`tryParseHTMLToBlocks` /
  `blocksToHTMLLossy`) so the `.preshot` manifest still stores HTML, supports
  native block types (headings, checklists, tables, code blocks) and BlockNote's
  palette colors, and renders a `compact` variant (no side menu) for group
  descriptions. The font-size dropdown and arbitrary-hex color picker were
  removed in favor of BlockNote's native formatting model.
- Rust commands stay narrow: filesystem work, atomic manifest writes
  (write-temp-then-rename), cover resolution, and token-authorized rollback of a
  just-created project. They hold no UI or business rules.

### Native menu flow

The Rust File menu (`src-tauri/src/menu.rs`) owns New Project, Open Project,
Open New Window, and Close. New Project and Open Project emit a `workspace://menu`
event to the focused webview; the `tauriWorkspace.onMenuAction` adapter validates
the payload and forwards it to `WorkspaceProvider`, which runs the same guarded
flows as the shell and launcher buttons. Open New Window and Close are handled
entirely in Rust, and new windows start the same auto-open flow.

## Basic Plan Editing

Basic Plan Editing is the second vertical slice and demonstrates the same clean
layering applied to in-project data: React UI -> `PlanService` use case ->
domain port -> infrastructure adapter -> Tauri command -> project filesystem.

### Plan storage

The project plan lives in the `.preshot` manifest as an optional `plan` field
(same `schemaVersion: 1`). `ProjectPlan.photographyPlan` stores the Photography
Plan body as HTML and defaults to an empty string; the Rust manifest mirror uses
`photography_plan` with `#[serde(default)]` so older manifests still load. Each
reference group carries an `id`, `title`, an editable HTML `description`, a
`columnsPerRow` count, and its images; old plain-text descriptions still render
as a paragraph everywhere for backward compatibility. Reference images are
stored in a `references/`
subdirectory as `NNNN.ext` (4-digit zero-padded, sequential jpg/png only, ≤ 16 MB
each). Imported files are **moved** (source removed): same-volume rename or
cross-volume copy+delete.

### Tauri commands

- **`save_project_plan`**: atomically writes the updated plan JSON into the
  `.preshot` manifest.
- **`read_project_plan`**: reads and validates the plan from `.preshot`.
- **`import_reference_image`**: validates, moves, and renumbers the source file
  into `references/`.
- **`load_reference_image`**: reads a reference file and returns a base64 data
  URL for on-demand rendering.
- **`remove_reference_image`**: deletes a reference file from `references/`.

All commands serialize cleanly and return contextual errors. Reference images
are loaded on demand to avoid bloating the initial plan-load payload.

### Auto-save

`ProjectPlanProvider` owns the in-memory plan and persists it with a debounced
auto-save instead of writing on every keystroke. The Photography Plan body and
group descriptions are edited in memory as HTML and flushed to `.preshot` on the
same schedule:

- Pure-metadata edits (Photography Plan body, add/rename/delete group,
  descriptions, columns) update in-memory state only and mark it dirty.
- A 5-second interval flushes to `.preshot` **only when the serialized plan
  differs** from the last saved snapshot, so an idle project performs no writes.
- Operations with filesystem side effects (image import/remove, group delete)
  still save immediately to keep `references/` and the manifest consistent, and
  they refresh the saved snapshot.
- The provider flushes any pending changes on unmount (project switch or close),
  and `PlanService.savePlan` is the single persistence use case the loop calls.
- The `PlanPanel` header shows a live `SaveStatus` pill (`Saving…` /
  `Unsaved changes` / `All changes saved`), and `Ctrl`/`Cmd`+`S` flushes pending
  changes immediately instead of waiting for the interval.

### PDF export

PDF export keeps the same layering: the header button in `PlanPanel` triggers a
pure domain transform (`buildExportDocument`) plus pure A4 geometry helpers
(`contentBox`, `squareSlotGrid`, `containSize`) before crossing any platform
boundary. The domain output is a serializable `PdfExportDocument`, and the UI
hands that document plus already-loaded image data to the `PdfExporter` port;
writing bytes to disk is isolated behind the separate `PdfSaveTarget` port.

`src/infrastructure/pdf/pdfLibExporter.ts` implements `PdfExporter` with
`pdf-lib` and `@pdf-lib/fontkit`. It fetches bundled Noto Sans SC font files
through Vite `?url` imports, embeds subset Regular/Bold fonts, parses the
schema-safe plan HTML into PDF blocks, and lays out each image row into fixed
square slots — drawing a light-gray frame around every slot and contain-fit
letterboxing each image inside it. Rows are page-atomic: if one row does not
fit beneath the current cursor, the exporter starts a new page before drawing
that whole row. Text color still flows through inline `style`; BlockNote
checklists render as bullet lists, code blocks as preformatted paragraphs
(regular font), and tables are flattened to text (one paragraph per row).
Italic is kept in the parsed model but rendered with the regular font, and
links are styled blue/underlined without adding clickable PDF annotations.

`src/infrastructure/pdf/tauriPdfSave.ts` implements `PdfSaveTarget` for desktop
builds by opening the Tauri save dialog (`dialog:allow-save`) and then calling
the narrow Rust `save_pdf` command. The export defaults that dialog to
`output.pdf` in the current project directory. `src-tauri/src/pdf.rs` decodes
the base64 payload, writes a temporary sibling file, and renames it into place
for an atomic save. End-to-end browser tests swap in `browserPdfSaveTarget`,
which resolves success without showing an OS dialog while still exercising the
real `pdfLibExporter`.

### Drag-and-drop reordering

Reference images support drag-and-drop reordering within and across groups via
`@dnd-kit` (confined to `src/features/plan`). Dragging now previews the
post-drop layout live: `ReferenceImagesTab` holds an optimistic `preview`
computed by the domain `moveImage` reducer on each `onDragOver` (so the preview
equals the committed result), renders from `preview ?? groups`, and commits the
same params via `onMoveImage` on `onDragEnd` (revert on cancel/invalid). A pure
`computeDropTarget`/`dropTargetFromEvent` (`src/features/plan/dropTarget.ts`)
maps a dnd-kit event to `{ toGroupId, toIndex }` supporting front/middle/end,
cross-group, and empty-group insertion. The v1 `resolveImageMove` /
`handleImageDragEnd` helpers were replaced. A pure `moveImage(plan, {
fromGroupId, imageId, toGroupId, toIndex })` reducer computes the next plan
with adjusted image arrays, and a non-persisting `PlanService.moveImage` use
case defers to the 5-second auto-save instead of writing immediately; moves
produce no file I/O. A pure `resolveImageMove(groups, activeId, overId)` helper
maps a dnd-kit drop event to move parameters or null (cancel on invalid drop).
The `DndContext` lives in `ReferenceImagesTab`, with `GroupImageGrid` as a
droppable per group and `SortableImageTile` wrapping each tile. The pointer
activation distance preserves click-to-open behavior on tiles.

### Boundaries

- The domain `PlanService` owns plan rules (group management, per-group
  description edits, photography-plan edits, column clamping 1..=6, reference
  ordering); pure-metadata use cases (including `moveImage`) compute the next
  plan without persisting, while `savePlan`,
  `importImage`, `removeImage`, and `deleteGroup` persist through a serialized
  queue.
- The `PlanPanel` renders one scrollable, tab-free view: the Photography Plan
  editor stacked above the Reference Images groups (WYSIWYG). Both the plan body
  and group descriptions share `src/features/plan/RichTextEditor.tsx`, a TipTap
  wrapper with a formatting toolbar (bold, italic, underline, strikethrough,
  H1/H2, bullet/ordered lists, font size, text color, and links) that emits a
  bounded, schema-safe HTML subset and supports placeholder copy. Group titles
  use high-contrast text, reference thumbnails are capped at ~160px squares so
  the gallery stays bounded, and rich-text edits stay in memory until the
  5-second auto-save or an explicit flush.
- The Tauri plan adapter (`src/infrastructure/plan/tauriPlan.ts`) wraps the five
  commands and validates response shapes.
- The browser plan adapter (`src/infrastructure/plan/browserPlan.ts`) seeds an
  in-memory "Editorial Demo" project for E2E tests and fails closed in production
  builds.
- Rust commands (`src-tauri/src/plan.rs`) handle atomic manifest updates,
  validated imports, base64 encoding, and file removal without holding UI or
  business rules.

## Future Capabilities

- Canvas UI belongs in `src/features/canvas`; Konva-specific code stays behind
  feature-facing interfaces.
- Asset selection and native file reads use a domain port implemented in
  `src/infrastructure/desktop`.
- Copywriting remains a platform-independent domain capability.
- Project persistence implements `ProjectRepository` without changing feature
  consumers.
- Broader export workflows can reuse `PdfExporter` and `PdfSaveTarget` ports
  without reading UI state directly.

## Mobile Evolution

Do not create a monorepo preemptively. When the first mobile client starts,
extract platform-independent domain models and use cases into a workspace
package. React UI and platform adapters remain client-specific.

## Error Flow

Expected failures travel from adapters to use cases and then to explicit UI
states. Adapters retain the failed operation and original cause. Unexpected
render failures reach `ErrorBoundary`, which displays a recovery message and
logs the diagnostic context.
