# Architecture

## Scope

Preshot is a Windows-first desktop application for local photography planning. The shipping desktop path already covers project creation/opening, a BlockNote-based plan editor, project-local media management, persisted settings, and PDF, DOCX, and long-image export.

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
- `src/features`: workspace launcher, settings UI, BlockNote editor, image-group UI, and save status
- `src/domain`: pure workspace/settings/plan models, services, ports, validation, migration, crop, and layout helpers
- `src/infrastructure`: Tauri/browser adapters, file dialogs, PDF/DOCX/long-image exporters, DOM capture, and persistence wiring
- `src-tauri`: serializable native commands for project management, plan persistence, media import/load/remove, PDF/DOCX/long-image save, reveal, settings, and screen capture

## Application flow

1. `WorkspaceProvider` asks the workspace domain service to initialize user data before loading recents. Production delegates `%USERPROFILE%\.preshot` and its `projects` child to narrow Rust bootstrap commands; browser and Midscene adapters provide deterministic in-memory equivalents.
2. When no registered project is available, startup adopts the first valid project under the default projects root or creates, registers, and auto-opens the single localized Preshot starter.
3. `AppShell` renders the resizable project rail, center workspace, settings access, and focus mode.
4. `Workspace` mounts `BlockNoteProjectCanvasProvider` for the active project.
5. `BlockNoteProjectCanvasProvider` loads the plan through `BlockNotePlanService`, then loads referenced `references/` images and `media/` files.
6. `BlockNoteDocumentEditor` owns the live BlockNote instance; the provider reconciles its serialized document with `plan.imageGroups` and runtime-loaded media URLs.
7. Reference-image crop confirmation goes through the revision-aware queued
   domain service and a narrow begin/commit/rollback crop port backed by Rust.
8. PDF export goes through `createReactPdfBlockNoteExporter`, which uses
   `@blocknote/xl-pdf-exporter@0.53.0` with
   `@react-pdf/renderer@4.3.0`; the PDF save target then opens a native save
   dialog and calls the Rust `save_pdf` command.
9. DOCX export maps the same schema through
   `@blocknote/xl-docx-exporter@0.53.0`; long-image export instead mounts a
   separate read-only DOM surface and captures it through
   `modern-screenshot@4.7.0`, because BlockNote provides no image exporter.

Browser-only adapters exist for tests and Midscene-driven workflows, but production wiring uses the Tauri adapters.

## Global material library

`AppMaterialLibrary` composes the domain `MaterialLibraryRepository`, a narrow
Tauri adapter, the library dialogs, and offline preview rendering. The shell
and launcher share the Material library entry. The active project registers its
target-bound opener; without an active document, the same browser remains available
for management with insertion disabled. The editor toolbar has no duplicate
insertion button. The slash-menu shortcut remains available, and image-group
toolbars and artifact menus save one complete component.
Opening captures the last user-focused cursor block before modal focus moves.
Materials occupy a complete row after that block's top-level ancestor; no cursor
means insertion at the document beginning, not after the default editor selection.
The browser's explicit Insert into current document action preserves this pinned
target throughout previews, searches and material editing.

Portable payload v1 supports individual images, image groups, locations, models,
props and clothing. Image materials store exactly one image; only unsaved drafts
may be empty. Project-local JPG/PNG native blocks and individual gallery images
can be collected, and direct creation supports file import or screen capture.
Single-click selection exposes an Add to library action in the native image's
floating toolbar or the gallery toolbar. Both open the existing metadata dialog
for exactly the selected image; gallery tiles keep their action visible while selected.
Project insertion creates a native image block with a fresh `media/` copy, caption
and preview width. Crop/fit is rendered into that copy when needed; untransformed
images retain their original bytes. The library original and its editable visual
fields remain unchanged. Isolated library editing and previews still use a
one-image group. Library descriptions and keyword tags use the same search projection
as other categories.
Image-group insertion opens an image chooser, initially selecting every image.
Users can insert a subset as one new group (retaining its name and description)
or as consecutive native image blocks. Both modes preserve source order. The
request and durable receipt pin the selected local image IDs and insertion mode;
only those originals are copied. Native preparation renders one image at a time,
tracks each output hash, and commits the complete batch before one editor/history
publication. Cancel or a failed copy cleans all owned files from that attempt.
It preserves component text and individual image order/frame/crop/fit fields,
but contains no source project identities or paths. Clothing excludes its hidden
legacy try-on gallery with a confirmation warning. Domain instantiation assigns
fresh block, sidecar, collection and image identities and inserts one full-row
component without changing existing document content.

The native content store lives in
`%USERPROFILE%\.preshot\library\library.db`.
Database version 6 gates the new image kind and preserves all v5 instances,
legacy records and exact operation receipts without rewriting their content.
The legacy base DDL is
[`src-tauri/src/library/schema.sql`](../src-tauri/src/library/schema.sql).
The additive v5 migration retains legacy content-addressed `objects`, while all
new image writes own immutable UUID instances. Optional `MaterialImage.storageId`
selects the verified instance resolver; `blobId` remains SHA-256 integrity metadata.
Equal bytes do not imply a shared physical instance, and a missing instance never
falls back to the legacy object. Screenshots in `previews` are replaceable caches,
not saved content.
FTS5 consumes Rust-segmented Chinese text alongside literal substring matching.

Permanent deletion is restricted to trashed materials and checks the expected
metadata version. The schema tracks attributable asset ownership, content-free
operation tombstones and a durable per-material cleanup outbox. Canonical
records and search entries are removed atomically before confined file cleanup.
Shared assets and edit-draft references are rechecked; inserted project copies
are never cleanup targets. Library open resumes only already-approved outboxes
and surfaces failures so retry remains available after a restart.

The detail action area exposes only Edit material and Preview. The detail pane
shows metadata without mounting a live preview; Preview mounts the complete
read-only component in its own dialog and closing disposes it. Cached list
thumbnails and insertion source-readiness checks remain independent. Edit material
combines library name, tags, description and favorite state with a session-owned,
one-component canvas using the production
schema/renderers but no project provider or autosave. Structural transactions
are blocked; internal field/image edits use a local draft and history.
Session-scoped native image import/crop copies bytes without mutating originals.
Save checks the pinned content revision and metadata version using one transaction
and an idempotent edit receipt. It updates metadata, payload, image mappings and
search together, increments both versions once, and invalidates the thumbnail.
The v4/v5 migrations preserve earlier records and existing receipt hashes for the
optional payload-only API, which still preserves current metadata. The material UUID
and existing project copies remain independent of the edit. Cancel discards both
sets of edits and cleans only the draft. Ambiguous save results freeze the exact
metadata/content request and its source images for safe retry.
Confirmed saves keep the editor open and replace the consumed draft with a fresh,
version-pinned native session. Cleanup or re-opening failures are retryable without
another commit; late sessions are retired when their owner has gone away. Closing
refreshes the live detail and generates the cached preview from committed content,
with preview-only failure recovery in the library.

The browser's Create material action selects one of the six supported kinds and
opens the same editor without a project. Domain code supplies an image-free portable
seed; `library_begin_create` allocates a session-owned draft and a future material
UUID, not a canonical row. Only this draft response may carry empty metadata and
zero versions. First `library_commit_edit` requires validated metadata at expected
version zero and atomically publishes content, owned images, search and receipt at
content/metadata version one. Further saves resume normal editing of the same UUID.
Cancelling before first Save leaves no searchable material. Closing a saved creation
clears hiding search/type filters and selects it in the recent list.
Both creation and editing check active exact names immediately before each new save.
The frozen candidate needs explicit confirmation if another UUID has that name;
confirmation never updates by name or overwrites another record. An uncertain
commit retries its already-approved receipt, not a fresh name lookup.

Insertion prepares new project-owned `references` files and a project-local
`.preshot-library` journal. The provider loads those copies, validates the
unchanged target, and commits the complete manifest before publishing its
marker and sidecar together. Lost responses are resolved through operation
receipts; unresolved status blocks subsequent saves and destructive retirement.
An isolated BlockNote history transaction supplies insertion undo/redo.
Inserted components use the existing exporters without consulting the library.

The browser adapter fails explicitly for persistence. The E2E fixture injects
a typed test repository while mounting the real app, editor, dialogs and
preview renderer; it is not a durable browser implementation. Backup/restore,
automatic expiry/GC and revision-history UI are not shipped
by this first library implementation.

## Image clipboard

`domain/clipboard` defines detached copy data, target placement and the durable
project-paste coordinator. A shared app port connects the project editor,
isolated material canvas, live preview overlays and single-image viewer.
Preview overlays remain outside the inert export surface; exports acquire no
clipboard controls. Text fields and unrelated BlockNote clipboard content keep
their native behavior.

Editable components declare their primary gallery on the live view. Clipboard
target resolution uses the focused component or a genuine single-node editor
selection, never the last document anchor as a proxy for component selection.
An unavailable component gallery rejects paste instead of falling through to
document insertion. Selection outlines and destination badges are DOM-only
feedback shared by the project and structurally locked material canvas.

Windows publishes PNG, CF_DIBV5 and an opaque `Preshot.Image.v1` receipt in one
owned clipboard interval. The native state holds original bytes and display
metadata independently of the source project/draft. Decoding uses a pipe-only,
time- and memory-bounded worker entered before application initialization; it
does not initialize workspace services. Browser persistence remains
explicitly unavailable except for injected fixture adapters.

Project paste allocates one new `media` or `references` file and records a
`.preshot-image-paste` journal. Closed delta validation accepts one native row
or one image in an existing visible gallery, not an arbitrary replacement plan.
Commit/status resolves uncertain writes before editor publication or cleanup.
History retains copied files, and retained reference crops create new files.
Native media serialization resolves by block identity, not data-URL equality.
Material paste instead imports bytes through its edit-session lease; canonical
publication happens only on Save through the existing metadata/content CAS.

See [the clipboard contract](design_docs/image-clipboard.md) for representations,
limits, animation conversion and the remaining desktop interoperability gate.

## Installer and app-data ownership boundary

The WiX MSI is a per-user deployment mechanism, not a workspace provisioner.
It installs the executable and bundled resources under
`%LOCALAPPDATA%\Programs\Preshot`, creates installer-owned shortcuts, and
writes only HKCU application registration. Its fixed UpgradeCode connects
higher-version major upgrades, while WiX generates ProductCode and PackageCode
per build.

The LocalAppData lineage has its own UpgradeCode and never reuses the
historical machine-wide family. A detection-only Upgrade search blocks when
that legacy product is present and directs the user to uninstall it first;
the limited per-user MSI does not attempt cross-context removal.

The installer has no ownership below `%USERPROFILE%\.preshot`. It must not
create, seed, migrate, repair, or remove settings, workspace metadata, project
directories, `.preshotproj`, or legacy `.preshot` content. Upgrade rollback
and uninstall therefore operate only on installer-owned application state.
This boundary lets user data outlive repair, failed upgrade rollback, and
uninstall.

## Persistence model

### Workspace metadata

Workspace recents are stored through the Tauri Store plugin in `workspace.json` with schema version 1. Each record tracks the project ID, path, cover reference, availability, timestamps, and `lastOpenedAt`.

Production user-owned project storage defaults to `%USERPROFILE%\.preshot\projects`. The installer does not create or seed these folders. Startup creation and discovery stay behind `NativeWorkspace`, so React never imports Tauri directly and the layer flow remains UI -> workspace service -> native port -> infrastructure adapter -> Rust command.

Startup bootstrap is serialized by the workspace service and runs once per
service instance before recents are inspected:

1. `ensure_user_data_roots` idempotently creates and canonicalizes
   `%USERPROFILE%\.preshot` and `projects`.
2. Workspace metadata is loaded and its registered project identities are
   passed to `bootstrap_user_data`.
3. Rust returns no project when any registered path still resolves to the
   recorded identity.
4. Otherwise Rust adopts the first valid direct child of the default projects
   root.
5. If none exists, Rust exclusively creates the exact localized starter
   directory and atomically writes its schema-14/document-v2 manifest.
6. The domain service persists the returned project before it becomes the
   startup project. Only a just-created marker-only starter receives a
   short-lived rollback token; adopted or existing projects never do.

### Project manifest

Each project directory contains `.preshotproj`. The manifest has `schemaVersion: 1` and currently stores:

- project identity and timestamps,
- an optional `coverImage`, and
- an optional `plan` JSON payload.

Legacy `.preshot` manifests are still accepted on read. When one is found, Rust rewrites it as `.preshotproj` and removes the old filename on a best-effort basis.

The first-run starter is a normal user-owned project, not an installed asset. Its manifest contains a schema-15/document-v3 plan with editable Chinese paragraph blocks, an empty artifact sidecar, and no external media references.

### Plan schema

The active editable plan is schema v15:

```json
{
  "schemaVersion": 15,
  "title": "...",
  "document": {
    "format": "preshot-blocks",
    "version": 3,
    "blocks": []
  },
  "imageGroups": [],
  "artifacts": []
}
```

The v15 document is validated in TypeScript before persistence. Key invariants:

- block IDs must be unique,
- every visible document row contains exactly one block,
- `columnList` and `column` blocks are unsupported,
- `imageGroup` blocks must be top-level,
- every image-group ID must appear exactly once in `document.blocks` and exactly once in `plan.imageGroups`,
- every artifact ID must appear exactly once in `document.blocks` and exactly once in `plan.artifacts`, and
- image IDs are globally unique across image groups and artifact collections.

Schema v14/document v2 plans migrate to v15/document v3 with an empty artifact
sidecar. Schema v13 migrates through that compatibility step. Duplicate legacy
image IDs after their first stable occurrence receive deterministic replacement
IDs. Older schemas are treated as incompatible and are not opened for editing.

### File layout inside a project

- `references/` stores imported reference JPG/PNG files.
- `media/` stores native BlockNote image/audio/video files.
- The manifest remains the source of truth for plan JSON; media and reference files are loaded lazily when the editor opens.
- Confirmed legacy image-group crops retain the same `references/<file>` identity
  and physically replace only that project-owned bitmap. The external import
  source is not part of the project model and is never written after import.
- Artifact-collection crops instead create a new immutable project-local
  reference file and update only the edited placement. The old file remains
  available to the plan-level Undo boundary.

### Artifact document blocks

`shootingLocation`, `modelCard`, `clothing`, and `prop` are content-none
BlockNote blocks carrying only `artifactId`. `plan.artifacts` owns their
validated metadata and image collections. The provider holds newly created or
cloned records as pending sidecars until the corresponding marker appears in
the serialized document; deletion moves records to a detached map so BlockNote
Undo can restore marker and sidecar together.

Artifact galleries are projected as collection-scoped reference groups for the
existing dnd-kit preview engine. This preserves immutable drag previews,
row-major placeholders, keyboard movement, and one validated drop commit
without adding a second pointer-drag implementation. Clothing exposes one
optional multiline source note. Empty notes produce no read-only or export node;
prop source text is part of its combined information field.

Artifact cards fill their document row and derive height from their header,
information, and gallery content. They expose no whole-card resize zones.
Legacy artifact `layout` metadata remains valid compatibility input but is
ignored by the editor, PDF, DOCX, and long-image renderers. Internal gallery
image frame metadata and image resize remain authoritative.

Artifact cards are top-level-only document blocks. They do not start whole-card
surface dragging, and `moveBlockRelative` rejects left/right grouping whenever
either source or target is an artifact. The editor reconciliation path hoists
an accidentally nested artifact, while strict schema-v15 validation rejects
persisted artifact markers inside ordinary blocks. Image groups, artifacts,
and ordinary content all remain in one vertical document flow.

All four artifact kinds share responsive 40/60 information/gallery CSS Grid
rows. Location, clothing, and prop keep independently editable header titles
and multiline information editors; the model uses a compact two-column field
panel for name/ID, height, weight, and shoe size plus a full-width optional
freeform notes field. Missing model notes remain valid compatibility input for
existing schema-v15 projects. Both columns use aligned 32-unit headings and one
shared content-driven body height with a compact 134-unit baseline. Textareas
grow with their content or an explicit user resize. Artifact galleries directly
reuse persisted image-group
frame/crop geometry, manual resizing, dnd-kit reorder, keyboard movement, and
no-shrink wrapping in editor and export surfaces. Below 430 CSS pixels the
card's own container query stacks information above the gallery without
viewport overflow. Clothing contains only its information and main image
gallery; legacy try-on data is not rendered or exported. Stored frame
dimensions remain authoritative.

Reference-image hydration traverses both `plan.imageGroups` and every
`plan.artifacts` image collection. Imports and screen captures begin with a
temporary square placeholder, then decoded source dimensions replace the
placeholder aspect and derive the default 240-unit frame width before the plan
is published or saved.

### App-level settings

App settings are stored in `%USERPROFILE%\.preshot\settings.json`. The current settings surface is:

- theme (`light`, `dark`, `system`),
- project-rail width.

Legacy assistant settings are ignored during normalization. The application no
longer starts an assistant runtime or reads its metadata database; existing
user-owned runtime data is left untouched.

The default new-project parent directory is `%USERPROFILE%\.preshot\projects`.
The new-project form resolves this location through the directory-picker port
without displaying a native picker. Users edit both the parent path and project
name in that form; the optional directory picker uses the current parent path
as its starting location. Creation passes the parent and name separately to the
workspace service so the native layer creates the named child folder.

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
- custom `shootingLocation`, `modelCard`, `clothing`, and `prop` artifact blocks

### Custom image groups

`imageGroup` is a BlockNote block with no editable inline content. It stores only a primitive `groupId`; all group metadata lives in `plan.imageGroups`.

Each group record contains compatibility group geometry plus its images,
including persisted image frame sizes, aspect ratios, and optional crop data.
The outer card fills its document row and derives height from wrapped image
content; legacy group `x`/`width`/`height` values do not expose or control an
outer-card resize interaction. The React block view resolves the metadata from
context and handles:

- creating and cloning groups,
- importing images,
- Windows screen capture import,
- global image selection and double-click viewing,
- eight transparent continuous resize zones: corner ratio lock plus
  single-axis edge resizing with live non-overlap wrapping,
- image-level equal-size/edge guides,
- preset/free crop editing and project-copy overwrite,
- within-group and cross-group reordering, and
- lightbox opening.

The width-led layout computes ordered rows with a stable gap and returns the
derived content height. During an image resize, the same layout is used for the
live preview and pointer-up commit so wrapped positions and group height remain
coherent.

Resize zones cover each full edge except the four 28px corner ownership areas;
they do not render visible handles. Hover changes only the resize cursor, while
keyboard focus adds a functional highlight. `fitMode` is optional persisted
image metadata: absent/`cover` preserves the source and updates normalized crop
when an edge changes frame ratio; explicit `stretch` fills the frame
non-uniformly and is shown with a persistent warning control.

### Transactional live image drag

`ImageDragPreviewProvider` composes one dnd-kit `DndContext` around the active
BlockNote editor. It registers a pointer sensor (6px mouse activation or
180ms/6px touch and pen activation), a keyboard sensor, always-measured group
and tile droppables, a body-level `DragOverlay`, and the central-scroller
auto-scroll monitor. The export-only BlockNote surface does not mount this
interactive context: `ImageGroupBlockRenderer` selects
`ExportImageGroupBlockView` when `ImageGroupExportContext` is present and the
interactive `ImageGroupBlockView` otherwise.

The domain `imageDragProjection` module is React- and browser-free. It takes a
deeply frozen group/image snapshot plus plan revision, normalizes row-major
same-group boundaries after source removal, projects cross-group and empty
targets, derives wrapped preview groups from authoritative frame dimensions,
and finalizes to either the exact snapshot identity or one move command. The
projection never mutates the source arrays and never shrinks frames to fit a
row. Pointer collision selects the containing group first, then the nearest
wrapped row and image midpoint; an 8-CSS-pixel/two-sample hysteresis suppresses
boundary chatter. Pointer release synchronously samples the latest collision
and cancels any queued projection frame, so a same-frame valid target commits
once while a same-frame outside release cannot reuse a stale valid preview.

During preview, `ImageGroupBlockView` renders the committed source slot as a
dashed placeholder, removes the active tile from projected flow, inserts a
same-sized target placeholder, and animates other tiles with transform/opacity
only. The crop-aware overlay is portaled outside the CSS-zoomed document.
Reduced-motion preference disables reflow/drop transitions. The custom
auto-scroller listens to the latest physical pointer in a fixed 48px viewport
edge band, stops when that pointer returns to the center, never starts for a
keyboard drag, and asks dnd-kit to remeasure enabled droppables after scroll.

Keyboard group traversal uses the recursively collected visible BlockNote
document order rather than `plan.imageGroups` storage order. When projection
replaces the focused tile with a placeholder, a hidden focus anchor retains
the dnd-kit keyboard sensor and receives continued arrow/drop/cancel input;
focus returns to the real image after cancellation or landing.

No preview calls `applyPlan`, dirties the save coordinator, reaches autosave,
or becomes exporter input. Invalid/outside drops and cancellation caused by
Escape, pointer cancellation, blur/visibility, project/revision change,
deleted data, decoded-source replacement, or unmount discard the transaction.
A valid drop invokes `moveImage` exactly once, creates one provider-level undo
boundary, and then participates in normal manual save, autosave, retirement
flush, PDF, DOCX, and long-image snapshots. Older asynchronous image
import/crop/removal/capture completions rebase onto the latest committed order
instead of overwriting it, and project retirement waits for both queues.

Crop confirmation converts normalized viewer geometry into strict source-pixel
bounds. `BlockNotePlanService` serializes the native overwrite with plan saves,
imports, removals, and retirement cleanup. Every metadata alias of the same
project file is then reset to the new bitmap dimensions, a full-image crop,
zero offsets, and a frame width derived from its retained height.

### Native media

`PreshotImageFilePanel` adds screen capture to the native image file panel.
The provider tracks capture through its image mutation/save barrier and cancels
on project deactivation or close confirmation. `ScreenCapture.captureMedia`
uses the shared bounded capture lifecycle (also used by material drafts), then
`import_screen_capture_media` copies only an owned temporary PNG into `media/`.
The native boundary enforces the 16 MiB image limit before allocation completes.
The editor publishes a relative file URL and resolves it via `resolveFileUrl`,
preserving distinct file identities even for captures with identical pixels.
Cleanup drains before completion; cancelled or stale targets are not published.
Native snip sessions expose explicit `pending`, `cancelled`, and `captured`
results. Session-scoped Windows hooks observe Escape and foreground changes
from ScreenClippingHost/SnippingTool before the overlay launches. Escape ends
without reading clipboard data; overlay dismissal allows a short bitmap
publication grace period. Hooks retire with the session. Terminal polls clear
the native token, and the shared capture lifecycle clears the UI wait state
without sending another Escape. Native start/cancel are serialized, and a stale
cancel is a no-op so it cannot dismiss a subsequent capture.

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
- slash-menu insertion for image groups and artifact cards,
- side-menu block duplication/move/delete helpers, and
- single-click image selection/dragging and double-click full viewing,
- pointer and keyboard image reordering through one immutable preview
  transaction, with decoded-asset gating, stale-snapshot cancellation,
  same-/cross-/empty-group reflow, source/target placeholders, polite
  Simplified-Chinese live-region feedback, reduced-motion handling, and one
  zoom-independent 48px edge auto-scroller,
- eight-zone image resize with ratio-locked corners, single-axis edges,
  keyboard adjustment, live wrapping, and dynamic height,
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
  border, artifact, and image-group tokens.
- `pdfExportPreflight.ts` validates marker/group integrity, walks root and
  nested blocks in document order, and produces portable logical/PDF dimensions
  plus keep-together image-group geometry. Top-level image groups use the
  1008-logical-unit content scale.
- `blockNotePdfPreflight.ts` receives the exact shared BlockNote schema and
  resolved project-local assets, measures native images, and invokes the
  injectable browser canvas optimizer at 144 DPI.
- Repeated assets are normalized by project-relative source and crop, then
  optimized once at the largest required draw box. Missing or corrupt data is
  rejected with block/group/image context.
- The immutable `PreshotPdfExportContext` contains block/group indexes,
  slots, optimized assets, visual tokens, warnings, and fatal-error
  contracts. It contains no React-PDF types and does not use hosted proxies or
  private filesystem paths.
- `imageGroupPdfRenderModel.ts` resolves each marker through that context and
  produces either a normal keep-together model or ordered page-safe row
  fragments using the exact root conversion, persisted frame height,
  optimized local assets, and immutable preflight row metadata. Positive group
  Y offsets become first-fragment flow padding; negative offsets keep a
  non-negative footprint and remain relative visual positioning.
- `imageGroupPdfMapping.tsx` renders normal groups in one relative
  `wrap={false}` flow wrapper. Intrinsically over-height groups use a breakable
  wrapper containing `wrap={false}` row fragments, with explicit fresh-page
  behavior after preceding content. Rows are greedily packed without cutting
  or duplicating images; only an individually over-height row may receive the
  bounded emergency row scale.
- `blockNoteReactPdfMappings.tsx` composes the official BlockNote 0.53 defaults
  with Preshot A4/type/spacing tokens for ordinary blocks, inline content, and
  styles. It registers bundled Noto Sans SC regular/bold, disables emoji
  networking, creates real PDF links, preserves single-block order, and resolves
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
list ancestors; ordinary structural wrappers do not add a level. True nested
lists preserve levels 0-8. Level 9 and deeper are rejected before packing
rather than silently clamped. Native images are embedded from caller-supplied
local Blob or data-URL values with aspect ratio, caption, and alternative text.
Audio, video, and file blocks become contextual hyperlinks for external URLs
or path-free fallback text for project-local/missing media. Document blocks are
exported in the same single-column order as the editor.

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

## Production long-image export

Long-image export is independent of both page-oriented export pipelines. It
does not call the BlockNote XL PDF or DOCX exporters, and adding it does not
change their mappings, pagination, save commands, or output bytes.

`src/domain/plan/blocknote/longImageExportContract.ts` owns the pure contract:
900px default and 890px compatibility geometry, preset limits, decoded-memory
estimates, block/row boundary planning, adaptive JPEG decisions, PNG
re-splitting, safe filenames, manifests, warnings, and typed failures. The
default WeChat/JPEG values (6000px, 1 MiB, quality 0.84 down to 0.68) are
conservative empirical compatibility targets rather than official WeChat
limits. High-quality JPEG targets 8000px / 3 MiB; lossless PNG targets
4000px / 8 MiB. All presets stop at 32 parts. Their cumulative encoded-byte
budgets are 24 MiB for WeChat JPEG, 48 MiB for high-quality JPEG, and 64 MiB
for lossless PNG.

`LongImageExportSurface` mounts the exact shared `preshotBlockNoteSchema` as a
read-only, control-free BlockNote view. The 1080px logical document, including
36px side padding and 1008px content, is uniformly scaled to the requested
890px or 900px outer width. It resolves only already supplied local URLs,
waits for local fonts/images and stable layout, and annotates top-level blocks,
atomic blocks, and wrapped image-group rows for measurement.

`BlockNoteLongImageExporter` snapshots schema-15 plan/assets, creates one
reusable `modern-screenshot` context, and captures sequential integer-pixel
viewports. Segmentation prefers the last complete block within the target;
oversized image groups may split only between complete rows; an indivisible
block is tiled only at the absolute 20000px safety cap. Capture allows up to
18 million pixels and 72,000,000 decoded RGBA bytes (900 x 20000). JPEG encoding searches
the highest quality under the byte target, then re-splits at an earlier
semantic boundary when minimum quality is still too large. PNG never exposes
quality and re-splits by the same byte-aware path. Canvases are zeroed and
removed after each attempt; workers, capture context, and offscreen React root
are destroyed after success, failure, or cancellation.

The capture adapter imports a bundled `modern-screenshot` worker as a
same-origin Vite asset. Its fetch hook rejects external HTTP(S) origins, and
the Tauri CSP keeps `default-src`/`script-src` at `'self'` without a hosted
capture proxy or broad worker/network source.

The provider adds long image after PDF and DOCX in the existing export menu.
Its modal settings select preset, JPEG/PNG, 900/890px width, and automatic
splitting. Automatic splitting starts unchecked on each dialog open and is not
enabled by preset, format, or width changes. The exporter also defaults an
omitted `allowSplit` option to `false`, so non-UI callers retain one-image
behavior and receive an actionable safety-limit error rather than silent
multipart output. Generation reports phase and part progress and supports
AbortController cancellation before save. Desktop persistence opens one save
dialog, derives deterministic sibling paths, and invokes the narrow
`save_long_images` command. Rust preflights and serializes the whole batch,
atomically commits each part, restores replaced bytes and removes only
attempt-owned new files on failure, then returns exact paths. Successful
desktop saves request the existing project-directory reveal; cancellation,
generation/save failure, browser, and Midscene output do not. Browser output
downloads one part directly; multipart is deliberately represented by a typed
no-op test adapter rather than a fake ZIP or extra archive dependency.

The desktop adapter preflights part count and cumulative raw bytes before
opening the dialog or creating base64 strings. Its single JSON IPC request is
hard-capped at 64 MiB of raw encoded image data. This keeps the existing native
all-or-rollback batch semantics without introducing a stateful multi-command
transaction; Rust repeats the 32-part and 64 MiB checks before decoding.

## Native boundary

Direct `@tauri-apps/api` imports are confined to `src/infrastructure`. Native responsibilities are intentionally narrow:

- create/inspect/relocate-compatible project directories,
- read and write the manifest plan payload,
- import, load, and remove reference images,
- validate, encode, atomically replace, commit, or roll back a cropped project
  reference image,
- import, load, and remove native media,
- save PDF, DOCX, or rollback-safe long-image batches through distinct commands,
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
- [Windows installer operator guide](WINDOWS_INSTALLER.md)
- [BlockNote v14 design](design_docs/blocknote_v14_design.md)
- [UI/UX contract](design_docs/UI_UX_CONTRACT.md)
- [Feature status tracker](design_docs/featurelist.json)
