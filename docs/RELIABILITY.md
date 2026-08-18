# Reliability

## Core guarantees

Preshot keeps project data local, wraps native failures with context, and avoids success-shaped fallbacks for workspace, plan, media, and PDF operations.

The main exceptions are intentional and narrow:

- settings reads recover from absent or corrupt `settings.json` by returning `{}` and letting the TypeScript layer normalize defaults;
- browser-only adapters exist for tests and Midscene, but production persistence uses Tauri commands.

## Save lifecycle

`BlockNoteProjectCanvasProvider` is the active save coordinator for the mounted editor.

- Loading a project reads the manifest plan, then loads referenced `references/` images and `media/` files.
- Editing marks the plan as unsaved in memory.
- A 5-second auto-save timer persists only when the serialized JSON changed.
- Ctrl/Cmd+S triggers an immediate save.
- No-op saves are skipped by comparing the current serialized plan with the last persisted snapshot.

This means save status stays honest: the UI can show unsaved or saving state without pretending data is already durable.

## Serialized plan mutations

`BlockNotePlanService` serializes mutating image/media work through an internal promise queue.

That queue protects operations such as:

- importing reference images,
- removing reference images,
- removing image groups,
- importing native media,
- purging detached image groups, and
- purging detached media files.

Mutations are therefore applied in-order instead of racing each other across the same project manifest and file tree.

## Manifest, settings, and PDF write safety

### Project manifest

The Rust workspace layer writes `.preshotproj` atomically:

1. encode JSON,
2. write `.preshotproj.tmp`,
3. rename it into place.

Saving a plan updates `manifest.plan` and refreshes `updatedAt` before that atomic commit.

### Settings

`%USERPROFILE%\.preshot\settings.json` is written through `settings.json.tmp` plus rename. Reading a missing or corrupt file returns an empty object so the app can recover to normalized defaults.

### PDF

The native `save_pdf` command decodes the base64 payload, writes a sibling `*.pdf.tmp`, then renames it to the requested destination. A failed write does not replace the previously saved PDF.

The production React-PDF adapter snapshots the plan, uses only the already
resolved project-local asset map, rejects missing/corrupt assets during
preflight, and verifies non-empty PDF bytes before opening the save target.
Mapping/render failures remain visible in the canvas and never trigger the
explicit legacy pdf-lib adapter automatically.

The native save dialog receives a platform-joined
`<project directory>\output.pdf` default path. Windows verbatim drive and UNC
prefixes are converted to Explorer-compatible drive and standard UNC forms
before path joining, without changing ordinary paths, trailing separators,
spaces, or Unicode. Cancelling the dialog performs no write and opens no
directory. After a successful `save_pdf` write, the app opens the normalized
current project directory through the existing `open_project_directory`
command without selecting a file. The native command verifies that the path
still exists and is a directory before starting Explorer. If validation or
Explorer startup fails after the write succeeds, the saved PDF remains
successful: the app logs the separate failure and shows a non-fatal
notification instead of retrying or reclassifying the write.

Browser-memory and Midscene export targets keep the `output.pdf` download
filename and do not request a native directory reveal.

Preflight and rendering are offline and deterministic: the shared schema,
bundled Noto Sans SC fonts, normalized crop/cache keys, and local optimized
assets are fixed before mapping. Root and weighted-column image groups keep
their complete flow footprint together, move to the next page when the
remaining space is insufficient, and scale uniformly only when that footprint
exceeds one usable A4 page.

Native image multiline-caption fitting uses the same bundled Noto Sans SC
regular-face metrics as the production renderer. Preflight wraps CJK and Latin
text at each candidate image width, subtracts the exact wrapped caption height
and trailing spacing from the usable page height, and iterates until the
keep-together block fits. It stores the final lines and dimensions in the
immutable export context; mapping renders those precomputed lines exactly
rather than reflowing them independently.

The production CSP permits only the React-PDF WASM capability
(`'wasm-unsafe-eval'` beside `'self'`), self-hosted fonts/assets, and Tauri IPC
connections. It does not permit general `'unsafe-eval'`, wildcard sources, or
broad HTTP/HTTPS origins.

## Schema compatibility and validation

Only schema v14 / document v2 is editable.

- Schema v13 / document v1 is migrated during load and then treated as v14.
- Older schemas are surfaced as incompatible and are not autosaved, exported, or modified by the editor flow.
- Malformed stored documents are rejected before persistence.

Validation enforces:

- unique block IDs,
- valid column nesting,
- supported native media path shapes,
- valid `imageGroup` placement, and
- exact one-to-one mapping between `imageGroup` blocks and `plan.imageGroups`.

## Reference-image and native-media handling

### Reference images

Reference image import copies the selected source file into the project-local `references/` directory.

Current behavior:

- supported types: JPG and PNG,
- size limit: 16 MiB,
- sequential project-local naming: `references/0001.<ext>`, `references/0002.<ext>`, ...,
- original user-selected source file is left untouched.

When the last logical reference to a stored file is removed, the project-local copy is deleted.

Confirmed reference-image crops overwrite only that project-local `references/`
file. The native command accepts strict in-bitmap integer bounds, decodes and
re-encodes JPG/PNG data, then atomically replaces the same relative file path.
The imported external source is never reopened for writing. Crop overwrite,
plan saves, imports, removals, and detached cleanup share one service queue so
filesystem and schema-v14 metadata cannot race. Successful commits reset every
plan alias of the overwritten file to the new pixel dimensions, full-image
crop, matching frame ratio, and zero frame offsets.

Queued plan saves capture the crop revision at enqueue time. If a later crop
commits before an older snapshot reaches the repository, the service coalesces
the committed pixel dimensions, aspect ratio, full-image crop, and zero offsets
into that snapshot before saving it. This preserves the queued document edit
without allowing stale image metadata to overwrite the crop.

The crop bitmap overwrite and manifest update form one recoverable transaction:

1. write and flush a UUID-scoped sibling backup of the original bytes;
2. write and flush a unique sibling temporary crop;
3. atomically replace the project-owned JPG/PNG;
4. update every schema-v14 alias and save the manifest plan;
5. request idempotent backup deletion only after the manifest save succeeds,
   or atomically restore it when that save fails.

A native write failure leaves the previous project bitmap in place. A manifest
save failure restores the exact original project bytes and surfaces the save
failure; if restoration also fails, the same error includes rollback context.
Transaction commands accept only the validated project path, existing
`references/` path, and UUID generated by the crop command.

Backup deletion is post-commit housekeeping, not part of the user-visible crop
result. A cleanup failure is logged, retried asynchronously, and cannot turn an
already committed bitmap and manifest into a reported crop failure. Native
cleanup treats an already-absent backup as success, making retries safe.

Normalized crop edges use the same round-and-clamp rule for both sides of each
axis, with a minimum one-pixel extent. Small images therefore keep preset
ratios, including a 2x3 source cropped to 1:1.

### Native media

Native BlockNote media is stored under `media/`.

Current accepted types and limits in Rust are:

- images: `jpg`, `jpeg`, `png`, `gif`, `webp` up to 16 MiB,
- audio: `mp3`, `wav`, `ogg`, `m4a` up to 64 MiB,
- video: `mp4`, `webm`, `mov` up to 128 MiB.

Runtime editing may use data URLs returned by the native layer, but persisted plan JSON must keep only relative `media/<file>` paths.

### DOCX export isolation and save semantics

The production DOCX exporter is infrastructure-only and receives an immutable map
of project-relative asset names to Blob, byte, or data-URL content. Its private
resolver accepts only single-file `media/` and `references/` names or direct
data URLs. It rejects HTTP(S), absolute paths, traversal, missing assets, and
unsupported image bytes without invoking the BlockNote hosted proxy or any
network request.

Project-local media fallback text never includes the stored relative path.
Native images embed only the supplied bytes and use caption/name metadata for
alternative text. Chinese text relies on Word/system fallback fonts, so exact
automatic pagination can vary by installed fonts and Word version; explicit
page breaks and section geometry remain deterministic.

DOCX generation validates a non-empty ZIP/PK payload before save. The native
`save_docx` command accepts only `.docx` output paths with an existing parent
directory, decodes bytes, writes and syncs a create-new UUID-named sibling
temporary file, and atomically replaces the destination. PDF uses the same
shared byte writer. Every write, flush, sync, or finalize failure removes only
that writer's temporary file and preserves the prior destination. Windows
finalization retries bounded transient access, sharing, and lock conflicts so
concurrent writers can each commit one complete payload without sharing temp
state.

Save cancellation is quiet and never reveals Explorer. A write failure stops
the flow before reveal. Explorer is opened only after a successful desktop
write through the existing normalized project-directory command; reveal
failure is logged and shown as a non-fatal format-specific notice. Browser and
Midscene targets download `output.docx` and never request reveal.

### Detached cleanup

The active provider tracks detached image groups and detached media references while the editor is open. On unmount, it asks the plan service to delete project-local files that are no longer referenced by the active document.

## Path safety

Native path resolution rejects absolute paths and path traversal for stored project assets.

- Reference-image paths must stay inside `references/`.
- Native-media paths must stay inside `media/`.
- Canonicalized resolved paths must still point inside the project directory.

This prevents persisted file references from escaping the project boundary.

## Windows screen capture

Screen capture uses a tokenized start/poll/cancel lifecycle:

1. `start_screen_capture` records the current clipboard sequence number and launches `ms-screenclip:`.
2. `poll_screen_capture` returns `pending` until the clipboard sequence changes and an image is readable.
3. Once available, Rust writes the clipboard RGBA image to a token-specific PNG in the OS temp directory and returns its path.
4. The React provider imports that PNG through the normal reference-image pipeline.
5. The provider calls `discard_screen_capture` to remove the temporary PNG after the import attempt.

If capture is cancelled before completion, `cancel_screen_capture` removes the token and sends Escape to dismiss the Windows capture overlay.

The TypeScript adapter validates the returned shapes and adds operation-specific error context for start, poll, and cancel failures.

## Error context and logging

Infrastructure adapters wrap native failures with clear operation context such as:

- unable to create/open a project,
- unable to read/save a plan,
- unable to import/load/remove media,
- unable to start/poll/cancel screen capture,
- unable to save the PDF, or
- unable to open the project directory after a successful PDF save.

`src/shared/logging/logger.ts` emits structured JSON and intentionally removes sensitive keys such as:

- `coverDataUrl`,
- `rollbackToken`,
- `stack`,
- keys ending in `token`, and
- keys containing `password`, `secret`, or `authorization`.

Strings, arrays, and nested objects are also truncated to keep logs bounded.

## What reliability docs must track

If you change persistence, media ownership, screen capture, validation, or native error shaping, update this file together with:

- [Architecture](ARCHITECTURE.md)
- [Testing](TESTING.md)
- [BlockNote v14 design](design_docs/blocknote_v14_design.md), when accepted interaction behavior changes
- [UI/UX contract](design_docs/UI_UX_CONTRACT.md), when visible behavior changes
