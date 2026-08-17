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

### Native media

Native BlockNote media is stored under `media/`.

Current accepted types and limits in Rust are:

- images: `jpg`, `jpeg`, `png`, `gif`, `webp` up to 16 MiB,
- audio: `mp3`, `wav`, `ogg`, `m4a` up to 64 MiB,
- video: `mp4`, `webm`, `mov` up to 128 MiB.

Runtime editing may use data URLs returned by the native layer, but persisted plan JSON must keep only relative `media/<file>` paths.

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
- unable to start/poll/cancel screen capture, or
- unable to save the PDF.

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
