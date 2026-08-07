# Reliability

## Error Context and Logging

Adapters preserve the operation and original failure when crossing a platform
boundary. The UI reports actionable errors instead of returning empty
success-shaped data. `src/shared/logging/logger.ts` emits bounded structured
JSON and removes sensitive keys such as tokens, data URLs, passwords, and
authorization values.

The canvas provider logs failed background work with context: image batch index,
capture cleanup, project path retirement, and PDF reveal failures. Expected
operation errors are shown in the plan workspace; the application error
boundary is reserved for unexpected rendering failures.

## Windows Screen Capture Sessions

`ScreenCapture` uses an explicit token lifecycle:

1. `start_screen_capture` records the current Windows clipboard sequence
   number under a UUID token, then opens `ms-screenclip:`.
2. `poll_screen_capture` returns `pending` while the sequence is unchanged.
   A changed sequence is not accepted until the clipboard supplies an image.
3. The native command writes the clipboard RGBA image to a token-specific
   temporary PNG and returns `captured { path }`; it removes that token only
   after the PNG is written successfully.
4. `cancel_screen_capture` removes an active token and sends Escape to dismiss
   the Windows overlay.

The Tauri adapter validates all token and poll shapes and adds start, poll, or
cancel context to errors. The provider additionally tracks a project token and
generation. A completion from a cancelled capture, switched project, or stale
generation cannot import an image or change visible capture state.

After a captured path is returned, it enters the ordinary import pipeline; a
successful import moves it into `references/`. PNG-write, clipboard, or import
failures are surfaced with their operation context. A cancellation before a
capture creates no temporary PNG. If native capture succeeds but the subsequent
import fails, the temporary source is left for OS cleanup/manual recovery rather
than being silently treated as a successful import.

## Image Import Batches

Batch selection is intentionally per-file rather than all-or-nothing. The
provider updates progress after every file, logs each failure with its index,
continues later files, and rebases all successful imports onto the latest plan.
It shows a localized success/failure summary when any file fails. This avoids
discarding valid imports because one source is unreadable or unsupported.

Aspect-ratio measurement is asynchronous and is rebased by file onto every
matching reference before persistence. Image removal deletes a file only when
no reference still uses it; deletion failures are logged as warnings after the
manifest update so the user does not receive a false success for the file
cleanup.

## Project Retirement and Persistence

Each canvas provider owns a project-scoped persistence snapshot. Metadata
changes save only when serialized state differs; native image operations and
rebased completion deltas are serialized through the canvas service queue.

On project switch or unmount, `ProjectRetirementCoordinator` queues a barrier
for the retiring project. The provider waits for in-flight imports, image
measurement, and destructive mutations, then saves the latest rebased
snapshot. A later mount waits for the relevant retirement barrier before
loading, preventing an older disk snapshot from overwriting a completed
operation or leaking a completion into another project.

## Atomic Native Writes

The Rust manifest and PDF writers use temporary sibling files followed by
rename, so a failed write does not replace the previous project manifest or
PDF. Rust commands return serializable `CommandError` values with stable codes
and actionable messages; TypeScript adapters retain that context for the
feature layer.
