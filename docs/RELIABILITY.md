# Reliability

## Core guarantees

Preshot keeps project data local, wraps native failures with context, and avoids success-shaped fallbacks for workspace, plan, media, and PDF operations.

The main exceptions are intentional and narrow:

- settings reads recover from absent or corrupt `settings.json` by returning `{}` and letting the TypeScript layer normalize defaults;
- browser-only adapters exist for tests and Midscene, but production persistence uses Tauri commands.

## Save lifecycle

`BlockNoteProjectCanvasProvider` is the active save coordinator for the mounted editor.

- Loading a project reads the manifest plan, then loads referenced `references/` images and `media/` files.
- During that normal load/hydration path, a pure compatibility pass upgrades
  only untouched legacy default image frames near 135 logical units high.
  Square 135-by-135 pre-hydration placeholders and widths matching stored,
  source, or crop-adjusted aspect ratios qualify; arbitrary custom dimensions
  do not.
- Every qualifying frame becomes exactly 240 units high with proportional
  width. Its identity, file, order, crop/focal metadata, and offsets remain
  unchanged, and each affected group recomputes wrap-first height from its
  authoritative width without changing group position or width.
- Editing marks the plan as unsaved in memory.
- A 5-second auto-save timer persists only when the serialized JSON changed.
- Ctrl/Cmd+S triggers an immediate save.
- No-op saves are skipped by comparing the current serialized plan with the last persisted snapshot.
- Manual saves, autosaves, and project-retirement flushes wait for the active
  image-mutation tail before they snapshot the plan. A save requested while an
  import, capture, crop, removal, or committed reorder is pending therefore
  persists the completed mutation rather than an older in-memory snapshot.

This means save status stays honest: the UI can show unsaved or saving state without pretending data is already durable.

### Live image-drag transaction boundary

Image-tile dragging snapshots the current plan revision, ordered groups, and
decoded active image into immutable domain data. Same-group, cross-group, and
empty-group reflow is derived only for rendering; preview order and temporary
group height never enter `planRef`, `savedRef`, the five-second autosave timer,
or PDF/DOCX/long-image export. The source placeholder and body overlay are
presentation state, not persisted schema fields.

Release first revalidates the snapshot revision and target. A valid drop calls
the provider move operation once, marks the plan unsaved, and records one
undo boundary; Ctrl/Cmd+Z restores the exact pre-move plan while that move is
still the latest plan mutation. Manual save, autosave, project retirement, and
all exporters therefore see either the fully committed order or the fully
restored order, never a projected intermediate state.

Release uses the latest synchronous pointer collision rather than waiting for
a scheduled preview frame. A same-frame valid release commits its stable
hysteresis target once; a same-frame outside release cancels and never falls
back to the preceding valid preview. Queued import, crop, removal, and capture
results merge into the latest plan revision so older completions cannot erase a
newer reorder, while retirement waits for all queued mutations and the reorder.

Escape, outside or invalid release, pointer cancellation, window blur,
document hiding, project replacement, plan revision change, group/image
deletion, decoded-source or frame change, and unmount all cancel without a
write. Drag start is rejected until the project-local image has decoded.
Scheduled projection frames, landing timers, and auto-scroll animation frames
are cancelled during teardown so stale work cannot commit later. Auto-scroll
tracks the latest physical pointer only, stops in the viewport center, and is
disabled for keyboard drags and after unmount.

The compatibility pass is idempotent. A changed loaded plan is compared with
the persisted snapshot, marked unsaved, shown with a one-time non-blocking
layout-review notice, and written only through the existing service autosave,
manual save, or project-retirement flush. No direct user-profile manifest
access is used. Reloading the saved 240-unit plan performs no migration or
write, and new 240-unit imports never qualify.

## First-run user-data bootstrap

Production workspace startup idempotently ensures `%USERPROFILE%\.preshot` and `%USERPROFILE%\.preshot\projects` before reading recents. Existing roots, settings, registry records, and projects remain authoritative; startup never deletes or rewrites them merely to seed content.

If no registered project can be inspected with its recorded identity, Rust scans the direct children of the default projects root and returns the first valid project for registration. Only when neither source provides a valid project does it attempt the exact localized starter directory.

The exact directory is acquired with an exclusive native `create_dir`. Concurrent launch losers wait briefly and re-inspect the winning directory instead of choosing a suffixed duplicate. The winner writes one atomic `.preshotproj` containing the schema-14/document-v2 Chinese starter plan. Browser and Midscene adapters model the same decision path without filesystem writes.

Until registry persistence succeeds, only the newly created starter has a short-lived rollback token. Persistence failure may remove that marker-only directory; adopted or pre-existing projects never receive deletion authority. Manifest-write failure removes only the just-created empty attempt, while root creation, permission, path-conflict, registry, and rollback failures retain operation context for actionable recovery.

The TypeScript workspace service serializes startup and all later workspace
operations through one queue. Concurrent or repeated `loadProjects` calls
therefore share one completed bootstrap in that service instance. Native
concurrency remains safe across separate process launches: only one process
wins exclusive creation of the exact starter directory, while losers retry
inspection for up to one second and return the same project identity.

Bootstrap atomicity is deliberately narrow. Directory creation is idempotent;
the starter directory is exclusively acquired; and the manifest is written
through the existing atomic manifest writer before the project is returned.
The registry save is a separate boundary. A token authorizes rollback only for
the just-created, still marker-only starter and expires after 60 seconds. The
opaque token's Rust-only authorization record binds the canonical project path,
project ID, and exact original `.preshotproj` bytes. Rollback re-reads and
compares those bytes both before and after atomic quarantine, so a plan edit,
title change, timestamp-only save, or any other manifest rewrite refuses
deletion even when the ID and marker-only shape are unchanged. If new content
or a concurrent save appears during rollback, restoration wins over deletion.
Unknown, tampered, expired, and reused tokens remain unauthorized.

## Installer servicing and preservation

The per-user MSI installs only under `%LOCALAPPDATA%\Programs\Preshot`, creates
installer-owned shortcuts, and writes HKCU application registration.
`%USERPROFILE%\.preshot` is outside the MSI component graph: no WiX component,
remove rule, or custom action references it.

Servicing guarantees:

- a higher per-user version uses fixed UpgradeCode
  `493c5fb5-639d-4fba-94d3-aebe4eb0dce6` for one LocalAppData major-upgrade
  family;
- historical machine-wide UpgradeCode
  `97ee9b44-6313-52eb-a67e-a1334832eb86` is detection-only and blocks with
  localized uninstall-first guidance rather than elevated automatic removal;
- downgrades are rejected and same-version packages are not treated as
  upgrades;
- failed upgrade rollback restores installer-owned application state without
  acquiring authority over user data;
- repair reinstalls application files, registration, and shortcuts only;
- uninstall removes installer-owned state and preserves settings, workspace
  metadata, projects, `.preshotproj`, and legacy `.preshot` content.

Unsigned or partially signed local builds are allowed only as non-publishable
artifacts. Publish mode requires valid Authenticode signatures on both the
release executable and MSI. The checksum and release manifest are generated
atomically beside the MSI and are re-derived during `production:verify`;
manual edits or artifact changes fail verification.

Release metadata records both lineages and publication blockers. Per-user
`0.0.1` artifacts remain non-publishable; if machine-wide `0.0.1` was public,
the first published per-user version must be `0.0.2` or newer.

Release version changes update the root Cargo lock entry offline, and the
two-phase executable/MSI build passes an explicit version-only configuration
to the bundle phase so cached Tauri configuration cannot reuse the preceding
MSI version.

Static contracts plus a current-user lifecycle matrix cover install, first
run, repair, Desktop opt-in, major upgrade, downgrade rejection, uninstall,
and user-data preservation. Forced execute-sequence rollback, cancellation,
non-admin policy, and missing-WebView2 behavior remain clean-VM gates. Install, forced-upgrade rollback, repair, and uninstall tests must run on
a disposable user profile, never a developer workstation. See
[Windows installer operator guide](WINDOWS_INSTALLER.md).

## Serialized plan mutations

`BlockNoteProjectCanvasProvider` is the authoritative image-group mutation
coordinator. Each import, screen-capture import, crop, removal, and committed
reorder records the plan revision at intent creation and enters one promise
tail. When its turn starts, it resolves the current plan instead of retaining
the plan object that existed when a picker, native capture, crop transaction,
or confirmation began.

`BlockNotePlanService` independently serializes filesystem and manifest work.
Its image APIs accept operation intent plus a latest-plan provider. The service
calls that provider inside its queue immediately before deriving the manifest
mutation, so a delayed file copy or crop overwrite is applied to the current
group order. Crop reads the latest plan again after the transactional image
overwrite and rejects with rollback if the target identity or file changed.
Batch import removes every newly copied, still-unreferenced file if a later
copy or manifest write fails; rollback failures are included in the surfaced
error rather than hidden.

That queue protects operations such as:

- importing reference images,
- removing reference images,
- removing image groups,
- importing native media,
- purging detached image groups, and
- purging detached media files.

Mutations are therefore applied in-order instead of racing each other across the same project manifest and file tree.

Late provider results are revision-checked before application. If unrelated
synchronous editing advanced the revision during service persistence or image
measurement, imports are merged by their new image IDs, crop metadata is
merged by stable image identity and file, and removals are re-applied by
identity. Existing image order is retained. Reorder intent itself executes
against the latest plan in the same tail, so an older import, capture, crop, or
removal result cannot restore its pre-drag ordering.

Image-drag projection remains outside this queue because it is presentation
state only. A committed async mutation increments the plan revision and
cancels any preview created from the previous revision before that preview can
commit. On unmount or project replacement, retirement waits for capture
cleanup and the complete image-mutation tail, then reads `planRef` and
tombstones at that time for its final save and purge pass.

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

### Long-image save batches

`BlockNoteLongImageExporter` validates and snapshots the schema-14 plan and
resolved local asset map before mounting a control-free offscreen surface. It
waits for fonts, images, and two stable layout frames, then measures top-level,
atomic, column, and image-row boundaries. Parts are captured sequentially from
one reusable `modern-screenshot` context at exactly 890px or 900px wide.
Canvas and decoded-memory limits are checked before each allocation; every
canvas, worker, offscreen root, and capture context is released after success,
failure, or cancellation. JPEG quality search and JPEG/PNG byte-driven
re-splitting remain bounded and preserve contiguous integer pixel ranges.
External capture resources are rejected, and the exporter returns bytes and a
manifest without opening dialogs or writing files.

The WeChat-compatible 6000px / 1 MiB JPEG target and its 0.84-to-0.68 quality
window are conservative empirical defaults, not an official WeChat upload
specification. Platform clients may recompress or change acceptance behavior,
so the contract guarantees Preshot's deterministic target and fallback
behavior rather than acceptance by every current or future WeChat client.

Every preset also has a cumulative retention budget and a 32-part ceiling.
WeChat JPEG retains at most 24 MiB, high-quality JPEG 48 MiB, and lossless PNG
64 MiB to account for its larger parts. Before converting and retaining the
next Blob, the exporter checks its projected total. JPEG quality search keeps
only the best accepted trial Blob, and the provider passes the ordered final
`Uint8Array` references to persistence without copying them. Limit failures
tell the user to shorten the plan, export sections separately, choose a smaller
JPEG preset, or use PDF/DOCX.

Automatic splitting requires explicit consent. The checkbox starts unchecked
for every dialog instance, and changing preset, format, or width does not
enable it. Exporter calls that omit `allowSplit` also default to one-image
output. If height, decoded-memory, canvas, or encoded-byte safety requires more
than one image, the operation fails and tells the user to enable automatic
splitting, shorten the plan, or use PDF/DOCX.

When explicit automatic splitting reaches one complete block or image-group
row that still exceeds a height or encoded-size limit, it does not claim that
another automatic split can solve the indivisible content. The runtime instead
tells the user to shorten or divide that block or image group, export smaller
sections separately, use the smaller WeChat JPEG preset or reduce image detail
when applicable, or switch to PDF/DOCX. Typed boundary and part context remains
available for diagnostics without becoming the user-facing explanation.

Long-image encoding and rendering are separate from persistence. The domain
save port accepts an explicit JPEG/PNG format, safe base name, default
directory, and ordered byte parts with deterministic expected filenames. One
part uses `<base>.<ext>`; multiple parts use `<base>-01.<ext>`,
`<base>-02.<ext>`, and so on. JPG and JPEG are treated as the same image
format, while every part in one batch must use one consistent extension.
Project-title base names are normalized to Unicode NFC, sanitized for Windows,
and truncated to 120 Unicode code points with `Array.from`, never by UTF-8
bytes or UTF-16 code units. Rust validates selected output bases with
`chars().count()` against the same 120-code-point limit. Combining marks remain
valid (and project-title input is NFC-composed where possible), while reserved
device names, control/path characters, traversal names, and trailing dots or
spaces remain invalid. The 120-code-point limit leaves room for numbering and
the extension. Generated and dialog-selected bases also use a 120 UTF-16-unit
cap, and every final component uses a 128-unit cap. This conservative budget
keeps both the destination and the atomic writer's UUID-suffixed temporary
sibling below Windows' 255-unit component limit.

The desktop adapter normalizes ordinary, verbatim drive, and verbatim UNC
paths before opening the existing save dialog. Cancelling returns `null` and
does not invoke Rust. A one-part dialog selects the exact destination; a
multi-part dialog selects a base or first destination and derives the complete
numbered sibling set. Selecting an unrelated extension is rejected rather
than rewritten, so a JPEG save never replaces a similarly named PNG (or vice
versa).

Before opening that dialog or allocating any base64 string, the adapter
preflights the same 32-part limit and a 64 MiB total encoded-byte ceiling. The
desktop bridge intentionally keeps one bounded JSON IPC request so the native
batch can preserve all-or-rollback behavior without a crash-sensitive stateful
transaction. Rust checks the estimated decoded total before allocating part
buffers and checks the exact total again after each decode. Browser download
object URLs are revoked in a `finally` path.

The save-dialog destination is authoritative. For a multi-part save, the
desktop adapter derives numbered siblings from that selected base and sends
only those actual paths and bytes to Rust; the original project-derived base
name is not revalidated natively because it cannot affect the destination.
The narrow `save_long_images` command preflights the complete batch before
writing: format, count, selected base safety, numbered output names, unique
sibling destinations, existing parent directories, regular-file targets, and
all base64 payloads. It serializes long-image batches within the process, then
writes each part through the shared UUID-scoped sibling temporary writer. If
any sequential commit fails, already replaced files are atomically restored
from their exact original bytes and only outputs created by that attempt are
removed. A newly created path is removed only when its current bytes still
match that attempt, and each atomic writer removes its own temporary file on
write, flush, sync, or finalize failure.

Rust returns the actual committed paths. The adapter marks desktop saves for
the existing higher-layer project-directory reveal; cancellation and write
failure remain no-reveal outcomes. Browser saves directly download one
unchanged byte part. Because the repository has no general ZIP utility,
multi-part browser/Midscene behavior is exposed only through an explicitly
typed no-op test adapter rather than adding a capture or archive dependency or
pretending that a ZIP was produced.

The worker is emitted as a same-origin build asset. No hosted capture service
or proxy is used: resolved document assets are local, the capture fetch hook
rejects external HTTP(S) origins, and the existing self-only CSP fallback
covers the worker without adding a broad `worker-src`.

Long-image generation and `save_long_images` are separate from the PDF and
DOCX exporters and their native save commands. A long-image failure cannot
trigger either page-oriented exporter as a fallback or alter their outputs.

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
