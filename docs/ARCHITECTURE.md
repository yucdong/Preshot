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
- `src/features`: workspace launcher, settings UI, production assistant UI, BlockNote editor, image-group UI, and save status
- `src/domain`: pure workspace/settings/plan models, services, ports, validation, migration, crop, and layout helpers
- `src/infrastructure`: Tauri/browser adapters, file dialogs, PDF/DOCX/long-image exporters, DOM capture, and persistence wiring
- `src-tauri`: serializable native commands for project management, plan persistence, media import/load/remove, PDF/DOCX/long-image save, reveal, settings, and screen capture

## Application flow

1. `WorkspaceProvider` asks the workspace domain service to initialize user data before loading recents. Production delegates `%USERPROFILE%\.preshot` and its `projects` child to narrow Rust bootstrap commands; browser and Midscene adapters provide deterministic in-memory equivalents.
2. When no registered project is available, startup adopts the first valid project under the default projects root or creates, registers, and auto-opens the single localized Preshot starter.
3. `AppShell` renders the resizable project rail, center workspace, settings access, focus mode, and production assistant panel.
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

## Agent workspace bridge

The mounted application has a typed agent-context seam, production model
settings/capability probing, a UI-agnostic text-proposal engine, and the full
project-scoped assistant panel.
`WorkspaceProvider` owns one `AgentWorkspaceStore`, registers the active project
with an attachment resolver, and provides only the resulting read interface to
future agent consumers. `Workspace`, `BlockNoteProjectCanvasProvider`, and
`BlockNoteDocumentEditor` receive the narrow publisher interface.

The bridge uses `useSyncExternalStore`. Plan revisions, save state, block/cursor
selection, selected-image context, and project switches update store snapshots
without placing a mutable BlockNote editor in React context or rerendering
unsubscribed shell descendants. Every captured `AgentWorkspaceSnapshot` is
frozen and contains:

- project ID/name and an opaque project handle, never the project path;
- document revision and canonical SHA-256 document hash;
- save state, selected block IDs, cursor block ID, and bounded reference-image
  metadata without paths or bytes; and
- selected-image identity, display metadata, and a bounded thumbnail.

Request-context chips are derived from a captured snapshot. The project and
document chips are fixed; block, cursor, and selected-image chips are
removable. Exactly one selected image can be attached automatically. A new
selection replaces an unpinned automatic attachment, a pinned attachment
survives selection and revision changes, and project changes clear stale
context. Selecting an image group does not attach every image in the group.

Per-turn receipts omit thumbnails and project handles. Runtime send attachments
contain only stable identity metadata. Serialization rejects
absolute Windows/UNC paths, media data URLs, oversized context, duplicate block
requests, and stale revision/hash reads.

Attachment tokens are short-lived, single-use, and project/revision-bound.
`AgentAttachmentTokenResolverPort` owns project registration, token issue,
resolution, pruning, and revocation. A visible chip never owns a token. The
Tauri runtime adapter issues and resolves a fresh token immediately before
Send, registers the resulting path in a request-scoped native bridge, and
sends only that fresh opaque token to the SDK-facing runtime. Resolution
consumes the token; publication evicts stale revisions and removed images,
automatic issuance supersedes the previous automatic token, pinned tokens are
bounded, and project switches revoke all remaining project tokens.
`RendererAgentBridge` revalidates project containment, MIME, size, and
signature before creating the SDK attachment and consumes its request-scoped
path registration on resolution. Absolute paths never enter the
React snapshot, request receipt, model prompt, or tool result.

Block and image citations are commands, not editor references. The bridge
validates the current project and source index before asking the registered
editor/image driver to focus, scroll, select, open, and briefly highlight the
source. Deleted blocks/images return an explicit unavailable result.

## Agent session controller

`AgentSessionController` is a domain external store mounted through
`AgentProvider` at the App/Workspace boundary. It composes the native
`AgentRuntimePort`, global SQLite `AgentMetadataStorePort`, and immutable
`AgentWorkspaceBridgePort`. A typed `AgentProposalApplicationPort` is
registered by the active BlockNote provider without exposing its mutable
editor. Opening the assistant alone remains lazy: the
managed runtime starts only when model discovery/probing or session work calls
the native adapter.

The controller owns one active generation globally. It loads project-scoped
history newest-first and coordinates create, resume, rename, delete, drafts,
usage/context summaries, errors, permission/input resolution, Send, and abort.
Resume always re-supplies the current validated BYOK provider configuration and
the native closed tool policy. Pending permission/input receipts are shown as
interrupted; `continuePendingWork` is fixed to false.

The native managed-session map treats resume as a serialized swap. Because the
pinned SDK has a single router slot per session identity, the runtime retains
the old entry and its complete recovery configuration while it disconnects the
old handle and resumes the replacement. The map changes only after replacement
success. A failed replacement is restored against the retained configuration;
if replacement cleanup or restoration also fails, the retained entry stays
addressable in a detached recovery state for retry, abort, disconnect, or
delete. Disconnect errors likewise retain and reattach the original entry
instead of reporting success or discarding control.

SDK replay and the live Tauri channel feed the same bounded ordered reducer.
Event IDs are deduplicated, tool output is capped, and message/reasoning/tool
deltas are accumulated off React state then published at most once per
animation frame. SQLite stores summaries and drafts but not transcript
content; the Copilot runtime remains authoritative for replay.

Before Send, the controller captures an immutable request receipt. The Tauri
adapter reads only the disclosed block IDs through typed workspace commands,
revalidates optional attachment identity, issues and consumes a fresh token,
and registers both context and resolved path against one native request/context
ID. A failed attachment validation removes the failed turn receipt while
retaining the composer draft and visible chip for correction.
`RendererAgentBridge` implements all four Preshot tools from that frozen
registration. The three read tools return only bounded disclosed metadata and
text. `propose_text_block_edits` validates the exact closed schema and snapshot
target hashes, generates a trusted proposal ID, and stages bounded operation
JSON in SQLite; it has no apply or file-write capability.

`AgentProposalService` reloads staged operations through the TypeScript domain
validator, projects and validates the complete schema-v14 plan, and creates a
stacked Before/After diff. Apply rechecks revision/document hash, requires a
separate delete confirmation, and performs one BlockNote transaction followed
by the normal provider save queue. Before that save it creates a bounded
schema-v4 recovery row in `agent.db`; after the save, SQLite atomically commits
the checkpoint/final receipt and consumes the row. Startup, project activation,
and session resume reconcile pending rows by the validated current document
hash before proposal history becomes actionable. Before-hash rows are cleared,
after-hash rows are finalized idempotently, and other hashes become retained
conflicts with no project mutation. Discard and Ask revisions do not mutate the
plan. Proposal lifecycle and recovery receipts are bounded in controller state.

The persisted checkpoint contains the exact pre-apply plan plus affected-block
hashes. Undo can survive session/app restart and preserves unrelated later
edits. A changed, missing, or reintroduced affected block is reported as a
conflict instead of being overwritten.

Workspace switches are serialized through the controller. An active turn
opens the accepted Wait/Stop/Cancel dialog: Wait retains one queued target and
switches on idle or error, Stop performs bounded abort and disconnect before
switching, and Cancel clears the request. Workspace activation stays inside
the queued callback, so two project canvases cannot race. Removing a project
counts sessions, aborts/disconnects the active one, deletes SDK sessions, then
cascades SQLite metadata. Failed SDK deletion becomes a cleanup tombstone and
does not block normal project removal.

Browser, E2E, and Midscene composition uses `FakeAgentRuntime`, which preserves
the same single-generation and event contracts with deterministic IDs and
scriptable event emission.

Production pins `github-copilot-sdk@1.0.11` with only `bundled-cli`. The
reviewed Windows x64 archive is upstream release/file version `1.0.79`, prints
`GitHub Copilot CLI 1.0.81-7`, is 100,644,089 bytes compressed, and contains
an unmodified 159,403,296-byte `copilot.exe`. The SDK launches that executable
as a separate stdio child; Preshot does not enable the in-process transport.
Extraction is isolated under
`%USERPROFILE%\.preshot\copilot\bin\1.0.79`.

## Agent model settings

`AgentModelSettingsController` is a domain external store composed once by the
application. It normalizes the user-facing proxy URL, derives the canonical
`/v1` API root, discovers models, coordinates text and optional vision probes,
ignores cancelled or stale probe completions, and exposes immutable setup state
to the settings and assistant surfaces.

Production model discovery and probing use narrow Tauri commands. The WebView
does not fetch the proxy. Browser, E2E, and Midscene modes use a deterministic
adapter with the same port. The native compatibility probe creates a temporary
Copilot SDK session and requires Responses streaming, a strict no-op custom
tool call, tool-result continuation, and terminal completion. Vision is a
separate opt-in probe using a bundled non-user PNG.

Only non-secret settings and capability evidence are stored in
`%USERPROFILE%\.preshot\settings.json`. The cache key includes the normalized
API root, model ID, and probe version. Proxy or model changes immediately
disable send eligibility and require a new probe. API keys are not represented
in the domain model, UI, native provider configuration, or persisted schema.
The assistant panel enables its composer only after the text compatibility
probe verifies Responses, streaming, and custom tools. Optional image content
is sent only after the separate vision probe succeeds.

The no-key provider uses an OpenAI-compatible Responses endpoint. The default
display URL is `http://localhost:4141` and its canonical API root is
`http://localhost:4141/v1`. Loopback HTTP and remote HTTPS are accepted;
remote HTTP, embedded credentials, paths, queries, fragments, and unsupported
schemes are rejected. Model list discovery proves identity only. Send remains
disabled until the separate bounded SDK round trip proves Responses,
streaming, a strict no-op custom tool, tool-result continuation, and terminal
completion. Changing proxy or model invalidates that evidence. Vision uses a
separate opt-in bundled non-user image probe.

## Agent panel

`AgentPanel` is a controller-backed production surface decomposed into header,
project-scoped history, transcript, composer/context attachments, proposal
review, usage, and project-switch components. It remains closed by default and
preserves the existing 240-420px splitter range and focus-mode overlay.

The transcript renders replayed and live user/assistant messages, collapsed
reasoning summaries, bounded tool progress/results, one-shot permission
requests, user-input requests, compaction, usage, and typed errors. Live deltas
are published by the controller at animation-frame cadence; the transcript is
not a token-by-token live region. Scrolling away disables auto-follow until the
user activates the new-response control.

The 14px composer persists one draft per session, handles Enter,
Shift+Enter, and IME composition, and displays the exact removable context and
single selected-image attachment that will be captured on Send. Unsupported
vision leaves the image visible but excludes it from the immutable turn
receipt. Proposal cards remain separate from tool permissions: they provide a
stacked before/after review, stale/invalid handling, destructive confirmation,
Apply/Discard/Ask revisions, persistent applied receipts, and conflict-aware
Undo.

Session history is newest-first and project-scoped, with create, resume,
rename, and confirmed deletion. Citation actions delegate to the workspace
bridge so BlockNote blocks are focused/highlighted and reference images are
selected/opened only after current-project/source validation.

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
- `columnList` blocks are top-level only,
- `column` blocks may only exist under `columnList`,
- `imageGroup` blocks may be top-level or direct children of a `column`, and
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

Location, clothing, and prop keep their required names as independently
editable header titles. Their multiline information editors map to existing
schema-v15 detail fields and share responsive 40/60 CSS Grid rows with their
main galleries. The row height follows the larger natural content; textareas
have no internal scrollbar and grow when text or image rows grow. All three
galleries directly reuse persisted image-group frame/crop geometry, manual
resizing, dnd-kit reorder, keyboard movement, and no-shrink wrapping in editor
and export surfaces. Clothing keeps its try-on disclosure below the main row.
Stored frame dimensions remain authoritative.

Reference-image hydration traverses both `plan.imageGroups` and every
`plan.artifacts` image collection. Imports and screen captures begin with a
temporary square placeholder, then decoded source dimensions replace the
placeholder aspect and derive the default 240-unit frame width before the plan
is published or saved.

### App-level settings

App settings are stored in `%USERPROFILE%\.preshot\settings.json`. The current settings surface is:

- theme (`light`, `dark`, `system`),
- project-rail width, and
- assistant-panel width,
- assistant visibility, and
- non-secret agent proxy/model settings plus versioned capability evidence.

The default new-project parent directory is `%USERPROFILE%\.preshot\projects`.

### Agent metadata

Agent metadata is stored globally in `%USERPROFILE%\.preshot\agent.db`, not in
individual project directories and not in the Copilot runtime directory. The
Rust `AgentMetadataStore` owns this database and the TypeScript
`AgentMetadataStorePort` exposes only project/session metadata, drafts,
proposal receipts/checkpoints, bounded proposal recovery records, usage
summaries, and cleanup tombstones. Browser and Midscene flows use the matching
in-memory adapter.

The bundled `rusqlite`/SQLite database contains:

- `agent_schema_migrations`;
- `agent_projects`, keyed by project ID with one canonical path and name;
- `agent_sessions`, ordered newest-first per project, with optional model,
  error, interruption, token/context, and reliable cost metadata;
- `agent_drafts`, with one bounded composer draft per session;
- `agent_proposals`, with bounded optional validated operation JSON and
  staged/stale/applied/discarded/undone receipts;
- `agent_proposal_checkpoints`, with one bounded exact pre-apply checkpoint per
  proposal;
- `agent_proposal_recovery`, with at most one pending apply/undo operation per
  project, exact before/after hash/revision boundaries, checkpoint/finalization
  data, and retained conflict evidence; and
- `agent_cleanup_tombstones`, which remain after project metadata deletion so
  failed Copilot runtime cleanup can be retried.

Foreign keys cascade session-owned drafts and proposals when a session or
project is deleted. Cleanup tombstones and proposal recovery conflicts
deliberately have no project foreign key because they represent evidence or
external work remaining after local project metadata is gone. The database
never stores full transcripts, prompt or response bodies, image bytes,
attachment payloads, API keys, access tokens, or project paths in recovery
rows. Copilot runtime files under `%USERPROFILE%\.preshot\copilot` remain
authoritative for resumable runtime state.

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
- `columnList` and `column` through `@blocknote/xl-multi-column@0.53.0`

### Custom image groups

`imageGroup` is a BlockNote block with no editable inline content. It stores only a primitive `groupId`; all group metadata lives in `plan.imageGroups`.

Each group record contains the image-group frame plus its images, including persisted frame sizes, aspect ratios, and optional crop data. The React block view resolves the metadata from context and handles:

- creating and cloning groups,
- importing images,
- Windows screen capture import,
- global image selection and double-click viewing,
- eight transparent continuous resize zones: corner ratio lock plus
  single-axis edge resizing with live non-overlap wrapping,
- eight-direction group resizing and prioritized equal-size/edge guides,
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
  produces either a normal keep-together model or ordered page-safe row
  fragments using the exact root/column conversion, persisted frame height,
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
atomic blocks, column rows, and wrapped image-group rows for measurement.

`BlockNoteLongImageExporter` snapshots schema-15 plan/assets, creates one
reusable `modern-screenshot` context, and captures sequential integer-pixel
viewports. Segmentation prefers the last complete block within the target;
oversized image groups may split only between complete rows; an indivisible
block is tiled only at the absolute 8000px safety cap. JPEG encoding searches
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
