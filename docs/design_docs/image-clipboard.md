# Image clipboard: interaction and storage contract

Status: **implemented; interactive desktop interoperability gate pending**. The
[interactive review](../design_refs/preshot-image-clipboard-review.html) remains
an isolated simulation and does not access the system clipboard or database.
The production source now includes scoped UI, independent storage, real editor
history and recovery. Browser and private-window-station coverage must not be
described as completed WebView2/Paint/document-consumer interoperability.

## 1. Recommended product contract

Copy one explicitly selected image with its context menu or Ctrl+C. Paste with
the destination's context menu or Ctrl+V. Every successful paste creates a new
destination-owned physical file and a fresh image/block identity. Never move,
replace, link, or modify the source.

Do not add permanent copy/paste buttons to already crowded image toolbars.
The image context menu adds just **Copy image** and **Paste image**. Existing
image viewing, resizing, dragging and other unrelated commands remain intact.

The first release covers individual images, not multi-image selections, entire
components, multi-block clipboard packets, cutting, or Explorer file-list paste.
Existing ordinary text and multi-block editor clipboard behavior is not replaced
by the new single-image command.

### Component selection refinement

Selecting a component through its border, icon, non-editable header area, Tab
focus, or a single BlockNote node selection targets that component's own visible
gallery. Model cards use samples; clothing uses its main gallery, never the
retired try-on gallery. A component-level paste appends; selecting an individual
image pastes after it. No component selection may silently fall back to a new
document image when its gallery is missing.

The selected component receives an accent outline. Its gallery shows an
absolute-positioned "paste here / Ctrl+V" badge without shifting content or adding
another permanent toolbar button. A polite live announcement identifies the
destination. Clicking document text removes this targeting; focused text fields
and text selections retain native clipboard behavior.

### Source and destination coverage

| Surface | Copy source | Paste destination |
| --- | --- | --- |
| Native document image | The selected native image | A new native image block |
| Standalone image group | The selected tile | The same or another group |
| Project location/model/prop/clothing gallery | The selected tile | Its editable gallery |
| Library material creation/editing canvas, all five kinds | The selected tile, including unsaved draft images | Only that component's gallery |
| Full material preview | An individually selected image in the live preview | Never; preview remains read-only |
| Single-image viewer | The currently displayed original-backed image | Never; close the viewer to choose a destination |
| Library list thumbnail / flattened component screenshot | Not an individual-image source | Never |
| Other project | Copy can survive a project switch | The newly selected project destination |
| Other applications | Publish standard bitmap/image formats | Accept one validated raster image |

Every editable source category can paste into every editable destination category.
Copying from a read-only preview does not require opening an editing draft. It
resolves the individual image's material ID, content revision and local image ID,
not the component screenshot. This requires explicit preview-only image hit
targets; never attach these handlers to the shared PDF/DOCX/long-image renderer.

### Exact insertion rules

| Focused destination | Insertion position |
| --- | --- |
| Selected gallery tile | Immediately after that tile in row-major order |
| Gallery whitespace / heading | Append to that gallery |
| Empty gallery | First image in that gallery |
| Selected native image | A new native image immediately after it |
| Document text caret | After the top-level block containing the caret |
| Document without a genuine cursor | At the very beginning |
| Plain field: material name, tags, artifact description, etc. | Text only; never redirect an image to a remembered gallery |
| Read-only preview / no editable project / closing draft | No image paste |

Document image insertion is a full-row addition, consistent with material
insertion. It does not split a paragraph, delete selected text, or replace an
existing image. Nested paragraph positions resolve to their top-level block.
The absence of a cursor is different from a captured anchor becoming invalid:
an invalidated destination cancels with an actionable message, not an insertion
at an unexpected fallback location.

After paste, select and focus the new image. A second completed paste therefore
inserts after the first. Switching projects or closing a material editor clears
the destination, but does not discard a successfully copied image snapshot.

## 2. Selection, keyboard precedence and feedback

Use the current teal image-selection outline without changing frame size.
Retain the eight transparent resize zones and the existing drag cursors. Image
selection must never look like a text caret. Pointerdown on an image does not
steal a resize or activate a second drag implementation.

Right-click first targets the actual image under the pointer. Copy from that
menu uses the captured image, not an older selection elsewhere. Right-clicking
gallery whitespace captures the gallery append position. Opening a menu or
focusing its items must not change the captured document insertion anchor.

Keyboard precedence, from highest to lowest:

1. IME composition, active resize/drag/crop gesture and a retiring editor do not
   start image operations.
2. Native text inputs and text selections keep native Copy/Cut/Paste/Undo.
   Selecting an image is not the same as selecting text inside its component.
3. An explicitly focused image handles Copy. A native image node selection is
   recognized separately from a ProseMirror text or multi-block selection.
4. Paste dispatch checks both clipboard formats and the current editable scope.
   A valid Preshot image packet, or a single raster-image payload without a text
   document payload, takes the image route. Rich text/HTML containing paragraphs
   and images stays in the existing document paste pipeline. Image-only HTML
   without embedded raster bytes is not fetched from a remote URL.
5. With no image command to handle, let the existing platform/editor behavior
   run. Never intercept global Ctrl+C simply because a selectedImageId remains
   somewhere in provider state.

In a plain text field, a text payload is pasted normally. If the clipboard
contains only an image, explain that the user must first choose an image region;
do not create an image behind the field. A real document caret is different:
it is a valid destination for a new native image row.

Implement exactly one dispatcher per active editor/modal scope, using the
actual copy/paste events as the operation boundary. Do not dispatch once from
keydown and again from paste. Prevent BlockNote's default single-image paste
only when the image coordinator has accepted ownership of that operation.
Unrecognized block clipboard content remains with BlockNote and its existing
upload pipeline. Preserve `componentTextInputEvents` native-default protections.

The menu is compact, portal-mounted and viewport-clamped. Support the Windows
Menu key / Shift+F10, arrow navigation, Enter, Escape and focus restoration.
Right-click and keyboard commands must work without a hover-only affordance.
Read-only previews expose Copy, not an enabled Paste command.

Show a short success notification after Copy. Paste shows a small busy indicator
at the target without inserting a temporary persisted image. On success, show
the destination and an **Undo** action; retain standard editor Undo after the
notification disappears. One paste is one undo/redo step.

While a paste is in flight, disable another image-paste request in that scope
and explain that it is busy. Ignore key autorepeat. Do not queue hidden duplicate
requests. Explicit repeated pastes after completion each allocate a new file.
Errors remain actionable; busy, unsupported, stale, oversized, read-only and
disk-write failures are not reported as an empty clipboard.

Use 150-200 ms opacity/outline feedback only, without layout-scale animation,
scroll jumps or drag-preview mutations. Respect reduced motion and Chinese
screen-reader announcements. The review's diagnostic side panel is **not**
proposed production UI.

## 3. What is copied

Recommended meaning: **the individual image's current committed pixels and
available display settings**, not a screenshot of its enclosing card.

| Transfer | Representation |
| --- | --- |
| Gallery to gallery, including material galleries | Copy the current backing file bytes; retain supported crop/frame ratio/fit metadata; clamp frame size to the destination |
| Native to native | Copy the backing file; retain caption and supported alignment/width, bounded by destination width |
| Native to gallery | Copy JPEG/PNG bytes, or normalize GIF/WebP to a new PNG; start with the image's ratio and a bounded frame; do not create a text field for its caption |
| Gallery to native / external application | Render its current visible crop/fit/stretch into an independent PNG at source-derived resolution; use native image width/alignment defaults |
| External raster to any destination | Normalize orientation and validate; create a fresh local PNG/JPEG with destination layout defaults |

Gallery-to-native conversion is necessary because the active native image block
uses BlockNote's default image schema, which does not express the gallery's
crop/stretch model. Do not silently discard that visual appearance or change
the native image schema and every exporter merely to implement Copy.

Reuse the existing pure frame/crop geometry and image compositing conventions.
Derive output resolution from source pixels and the visible crop, never screen
zoom, device pixel ratio or the low-resolution preview thumbnail. Do not upscale
for clipboard output. Preserve transparency when supported. Re-encoding must
be explicit for conversion cases; native-to-native and gallery-to-gallery must
not unnecessarily recompress JPEGs.

Do not copy selection outlines, handles, card borders, material metadata, source
paths, database IDs, or the entire component preview into the public bitmap.
A prior destructive crop may already have changed the backing file: Copy
cannot restore pixels that are no longer present. Native captions do not become
image pixels or unrelated material text.

The current native media importer also accepts GIF and WebP. Native-to-native
copy preserves those original formats, including animation. Gallery/material
storage remains JPEG/PNG: decode static WebP to PNG, and use a deterministic
first frame for animated GIF/WebP. Before an animated image is pasted into a
static-only destination, confirm the still-image conversion; cancellation
creates no file. Its system bitmap representation is also the first frame, not
an arbitrary animation frame at clipboard-read time. Do not call that result
an animated copy. Decoder format/animation support and bounded first-frame
decoding are implementation gates; relabeling bytes as PNG is not conversion.

## 4. Desktop clipboard protocol and lifetime

Use a narrow native adapter, not renderer filesystem access or a browser-only
in-memory clipboard that stops working outside Preshot.

Production delivery is desktop-first. Browser/Midscene adapters must explicitly
declare test-only or unavailable capabilities and may not claim durable native
copies. The standalone review intentionally has only a simulated clipboard.

**Copy flow**

1. Capture the selected image and current scope/revision. Resolve only an
   authorized project-local, material-revision or edit-session asset.
2. Under the existing source-operation ownership rules, read and validate the
   asset, then create a bounded native-owned snapshot. Copy need not autosave
   or modify the document. Unsaved draft sources are explicitly supported.
3. Prepare the standard visible-image buffers and a small application-defined
   **registered** format named `Preshot.Image.v1`.
4. In one owned Windows clipboard-open interval, publish the registered packet,
   PNG and CF_DIBV5 representations. Do not call unrelated convenience setters
   successively if each empties the clipboard.
5. Publish success only after the formats are available and the native snapshot
   is owned by the final clipboard receipt.

The registered packet contains only a version, process-instance nonce and
opaque snapshot ID. It contains neither source paths nor original file bytes.
The native cache owns the validated pixels and display metadata. The packet is
not a secret or trusted input: another application can read or forge clipboard
formats. Validate the live receipt, process instance, schema, sequence and
snapshot integrity before using the internal representation.

Prepare buffers before emptying the clipboard. Win32 publication is not a
transaction with automatic rollback: a partial SetClipboardData failure must
report Copy failure, release untransferred allocations, invalidate the internal
receipt and not claim that the old clipboard was preserved.

**Paste flow**

Read one coherent clipboard snapshot at invocation. A valid current internal
packet preserves the richer Preshot representation. If the process restarted,
the internal packet expired or another app replaced it, do not reuse stale
cached data; use independently valid standard raster bytes when available.
That is a documented format conversion, not a success-shaped recovery from a
failed file operation. If no supported representation exists, give an explicit
unsupported/empty message. Never interpret clipboard JSON, file URLs, HTML
paths or CF_HDROP as permission to read arbitrary files.

Clipboard sequence numbers are change hints, not authentication. Reconcile
them with the receipt and actual available data; zero is an access failure, and
sequence wraparound/delayed rendering must not authorize a stale packet.
Freeze the accepted snapshot for a started paste. A later Copy may replace the
clipboard without changing that in-flight paste's source.

Keep one current rich snapshot plus reference-counted in-flight leases. Retire
unleased snapshots when the clipboard changes or the app closes; clean only
app-owned temporary entries on next startup after a crash. Do not retain a
clipboard history database or use `agent.db`. A copied image survives source
deletion, material purge, source-draft cancellation and project switching
because the snapshot owns its bytes, not a source-path promise.

Enforced limits: one image, 16 MiB encoded source/output each, dimensions at most
8192 and at most 32 million pixels, matching the existing library image
validation. Budget the complete operation at 256 MiB including decode,
compositing, OS buffers and encoding, not each buffer independently. Reject
before unsafe allocation; do not silently downsample to fit. Bound temporary
snapshots cumulatively (64 MiB) and serialize expensive transforms. Existing
destination collection and draft batch limits still apply.

Preshot performs no network transfer. Windows clipboard history/cloud sync is
governed by OS policy/settings; do not claim that writing to the system clipboard
is invisible to other applications. Do not log clipboard bodies or images.

### Native implementation and desktop release gate

Windows documents multiple simultaneous formats, registered formats and
CF_DIBV5 bitmap interoperability. `arboard` is already used for screenshot
image reads, but that does **not** establish support for this multi-format
write/ownership contract. The implementation uses the existing `windows-sys`
dependency and enables GIF/WebP features on the existing `image` dependency.
Image decoding runs in a pipe-only child with kernel-enforced memory limits and
a timeout. `run_codec_worker_if_requested()` runs before app initialization.
Project paste uses the same isolated validation boundary.

Native tests cover PNG alpha, DIB orientation, contention, replacement and
publisher exit inside a private noninteractive window station. Real Edge cases
exercise scoped keyboard/menu interactions and browser bitmap paste events.
The remaining desktop release gate is WebView2 event/format exposure and
interoperability with Paint and an installed document/chat image consumer.
An approved interactive attempt was blocked by Windows screen-capture failure;
it does not satisfy that gate. Do not promise every third-party program accepts
the same formats.

References:
- [Microsoft: Clipboard formats](https://learn.microsoft.com/en-us/windows/win32/dataxchg/clipboard-formats)
- [Microsoft: GetClipboardSequenceNumber](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getclipboardsequencenumber)

## 5. Physical file ownership and library database

**A fresh UUID pointing to a shared existing file does not meet this requirement.**
No hardlinks, symlinks or content-addressed file reuse for a pasted image.

| Destination | New file ownership |
| --- | --- |
| Native document image | Fresh project-relative `media\...` file and block ID |
| Project group or artifact gallery | Fresh `references\####.jpg/png` and image ID |
| Material editing/creation | Fresh draft-staging file and local image ID |
| Material after Save | Fresh immutable library storage instance for that pasted image |

Keep the active plan v15, BlockNote document v3 and portable material payload v1.
Filesystem paths shown here are ownership conventions, not clipboard content.

Before v5 the library stored one physical object per content hash. Its
`material_images` mappings, read validators, receipts and purge ownership all
assume that layout. Consequently a draft-only copy followed by hash deduplication
on Save would **not** satisfy the promised persistent independence.

The additive **library DB v5** migration preserves that legacy layout:

| Schema change | Purpose |
| --- | --- |
| `image_instances(storage_id PK, blob_hash FK blobs)` | UUID physical identity separate from the existing integrity hash; multiple instances may have the same hash |
| Nullable `material_images.storage_id FK image_instances` | Existing rows remain legacy hash objects; new pasted rows name an independent instance |
| `material_instance_owners(material_id, storage_id)` | Retain instances used by current content and durable edit receipts |
| `purge_instance_files(material_id, storage_id, mime_type, blob_hash)` | Durable deletion outbox separate from existing hash-addressed purge files |
| `instance_publications` | Durable ownership of uncommitted instance publication |
| `snapshot_instance_saves` | Frozen identity/intent for exact snapshot-save retries |

Use strict UUID/hash/MIME validation, foreign keys and unique owner mappings.
Derive `instances\<prefix>\<storage_id>.<ext>` natively; do not store caller-owned
absolute paths. The existing `blobs` table can remain shared **integrity
metadata** without making independently owned instance files shared.

Extend `MaterialImage` with an optional `storageId`. Its existing `blobId`
continues to mean SHA-256. A present storageId selects the instance resolver;
an absent value selects explicit legacy compatibility. A missing/corrupt
instance must fail, never fall back to an equal-hash object.

Old records and exact receipt JSON stay readable and are not eagerly rewritten.
Update native/TypeScript validators, exact detail-vs-relational comparisons,
draft formats, session renewal, image reads, project insertion, preview resolution,
asset-owner triggers and purge retry/recovery together. Legacy ownership triggers
must not invent a hash-object file for an instance-backed image.

New paste staging allocates the future storage identity once and pins it to the
operation. Publish that file before committing its mapping/receipt, with a
bounded orphan-recovery record. Retry reuses the **same owned operation**;
matching bytes alone do not authorize reuse of somebody else's existing file.
Saving unchanged draft content again reuses its own committed instance rather
than creating endless copies. Copying/pasting that image again allocates another
instance. All new snapshot saves, imports, captures and crops use independent
instances too, so saving a project component cannot deduplicate pasted files.
Unchanged legacy images need no storage migration.

Migration acceptance must cover reopening a v4 library, existing edit receipts,
trash restoration, mixed legacy/instance material previews and interrupted purge.
Old app versions must reject the newer DB rather than downgrade its schema.
Physical independence must be asserted before **and after** Save/reopen.

## 6. Transaction, failure and undo contract

Keep domain selection/placement rules pure, infrastructure in adapters and Rust
commands narrowly scoped to validated image/file operations. Shared contracts
are `ImageClipboardInput`, `ImageClipboardSelection`, `ImagePasteTarget`,
`ImageClipboardPort` and `ImagePasteRepository`; `pasteProjectImage` coordinates
the project transaction.

Project paste should follow the existing material-insertion durability pattern:
freeze project/revision/target, allocate and copy, validate exact one-image
addition, commit file plus manifest intent/receipt, then publish one provider/
editor history step. Do not disguise gallery mutation as a material insertion
or accept an arbitrary replacement plan. Reuse transaction and cleanup helpers,
but keep a closed image-paste mutation contract.

Native-image uploads must not bypass this boundary by allowing the default
BlockNote image handler to paste the same content again. Pure text and unrelated
block clipboard behavior remain untouched.

For a material draft, paste changes only the isolated component and its
session-owned staging, not the project or canonical library. Save performs the
existing metadata/content CAS transaction, keeps the editor open, and renews
the session baseline. Close refreshes the committed preview. Cancel/discard
retains no unpublished image, and drains in-flight paste leases just as it
currently drains import/capture leases.

Reject stale source/destination revisions, removed anchors, closed/replaced
drafts and retired project scopes. No late operation may target the next project.
On copy/write/manifest failure, keep the source and current document unchanged;
remove only owned, definitely uncommitted files. An unknown native commit
outcome is resolved through its exact operation receipt before retry or cleanup.
Cleanup durably records its internal Aborting phase and resolved destination/
staging ownership before deleting either file. Removing staging must never turn
a failed no-replace publication into apparent ownership of an identical foreign
destination on the next recovery attempt.

Undo removes the pasted row/reference in one step, not the source. Redo restores
the same pasted identity/file without reading the clipboard or allocating again.
Pin files for history and unconfirmed receipts; reclaim only when no document,
draft, history, recovery or in-flight operation owns them. Clipboard replacement
does not erase pasted files.

## 7. Integration map and acceptance matrix

Existing integration anchors:
- `src/features/plan/blocknote/componentTextInput.ts`: native text-event isolation.
- `src/features/plan/blocknote/BlockNoteDocumentEditor.tsx`: native node selection,
  real cursor tracking, upload behavior and editor bridge.
- `src/features/plan/blocknote/ImageGroupBlockView.tsx`: single-image selection,
  shared standalone/embedded gallery UI and existing dnd-kit activator.
- `src/features/plan/blocknote/preshotBlockNoteSchema.ts`: default native image spec.
- `src/features/library/materialEditLease.ts`: retirement and import/capture ownership.
- `src/infrastructure/library/materialPreview.tsx`: live/flattened preview distinction.
- `src/domain/plan/blocknote/service.ts`: image import, confined assets and save rollback.
- `src-tauri/src/screenshot.rs`: existing arboard image reads and sequence checks.
- `src-tauri/src/library/{schema.sql,mod.rs,edit.rs,purge.rs}`: hash objects,
  relational integrity, revisioned publication and retained asset ownership.

| Layer | Required acceptance cases |
| --- | --- |
| Domain | Every source/destination pair, row order, nested/top-level anchor, no-cursor prepend, no replacement, limits and stale targets |
| Component | Right-click targeting, Ctrl+C/V precedence, real text selection/IME, empty galleries, Menu key/Escape/focus, read-only preview, busy/error states |
| Native | Fresh physical files and IDs on repeated paste, no links, source immutability, snapshot survival after source deletion, bounded decode and forged formats |
| Persistence | Failure at every copy/commit step, idempotent unknown-outcome retry, reload, source-project removal, undo/redo retention and orphan recovery |
| Library | All five kinds; unsaved source/destination drafts; Save stays open; preview refresh; cancel drains work; v4-to-v5 and purge/receipt matrix |
| Windows | Native WebView2 versus browser event ordering, standard external images, transparency/orientation, clipboard contention/replacement/restart |
| Exports | Pasted native/group/artifact images in PDF, DOCX and long image; committed order only; no clipboard/cache paths |

The HTML draft demonstrates selection, both menu commands, keyboard routing,
same/cross/empty-group paste, native document insertion, artifact/material
galleries, read-only preview Copy, save-without-close, undo/redo, failure and
distinct simulated files. It uses inline illustrations and an in-page clipboard;
it does not prove OS interoperability, real file copies, database migration or
native transaction durability. Those remain implementation acceptance gates.
