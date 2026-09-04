# Artifact Document Blocks

## Scope

Preshot adds four structured material blocks to the active BlockNote document:

1. Shooting location
2. Model information
3. Clothing
4. Prop

They are document blocks, not a reusable project asset-library panel. The
insertion menu pins Image Group, Shooting Location, Model Information,
Clothing, and Prop before ordinary BlockNote entries. Runtime labels use their
Simplified-Chinese equivalents.

## Persistence

The active plan is schema 15 with BlockNote document version 3.

Each custom block stores only an `artifactId` primitive. Full normalized records
live in `plan.artifacts`. Every artifact ID must appear exactly once in the
document and exactly once in the sidecar array. Image IDs are globally unique
across legacy image groups and all artifact collections.

Artifact creation, duplication, deletion, Undo, and Redo coordinate the document
marker and sidecar record as one plan mutation. A marker is never intentionally
saved without its record.

Schema-14 projects migrate automatically:

- document version changes from 2 to 3;
- `artifacts` starts empty;
- existing image groups and rendered content are preserved;
- duplicate legacy image IDs are deterministically replaced after their first
  occurrence;
- new artifact limits never reject a previously valid v14 image-group layout.

Pending Agent proposal recovery is resolved using its original schema before
project migration. Retained proposal checkpoints restore document text only, so
later Undo cannot remove current artifact or image-group sidecars.

## Records

### Shooting location

- one required venue-name title edited independently in the block header;
- one multiline Location Information editor that presents address and
  description together;
- the first information line persists as address and remaining lines as
  description for schema-v15 compatibility;
- image gallery.

### Model information

- required model name or ID;
- optional height in centimetres;
- optional weight in kilograms;
- optional literal shoe-size text;
- sample-image gallery.

### Clothing

- required clothing name edited independently in the block header;
- multiline Clothing Information field for source and other details;
- main image gallery sharing the information field's content-driven height;
- optional try-on gallery;
- persistent try-on expanded state, defaulting to collapsed;

The source note may contain a brand, URL, lending note, purchasing detail, or
other freeform provenance text. It is plain text and does not automatically open
URL-looking content.

### Prop

- required prop name edited independently in the block header;
- multiline Prop Information field containing freeform description/source
  text;
- image gallery;
- no try-on state.

## Empty and draft fields

New records use valid localized "Untitled location/model/clothing/prop"
names. The localized name is selected for immediate replacement.

A focused input may temporarily contain an invalid draft, but the committed
plan retains its last valid value. Autosave and export consume only validated
committed data.

The clothing source note remains available for editing. If its trimmed value is
empty, unselected reading render and PDF, DOCX, and long-image export omit the
complete source section, including its label, box, spacing, and placeholder.

Location, clothing, and prop use the same responsive 40/60
information/gallery row and stack below a 680px container width. Their
galleries use exact image-group frame behavior: persisted aspect/crop/frame
geometry, manual resize, within/cross-group drag, keyboard movement, and
wrap-before-overflow without automatic shrink. Clothing keeps its try-on
disclosure below the main balanced row.

Each information field and main gallery use one shared grid row. Their body
height is the larger of the textarea's natural content height, the wrapped
gallery height, and a compact 134px empty baseline. The textarea uses content
sizing, has no internal scrollbar or manual resize control, and stretches when
image rows grow. Actual image rows keep their user-controlled image-group dimensions.

## Image behavior

Artifact galleries reuse the production image-group engine:

- project-local imports under `references/`;
- selection and double-click viewer;
- crop;
- side-locked image resizing and wrap-before-overflow layout;
- mouse and keyboard drag within and across compatible collections;
- immutable live preview with source/target placeholders;
- one validated drop commit;
- reduced-motion behavior and Chinese announcements.

Every image uses transparent continuous edge/corner hit zones rather than
visible resize handles. Corners preserve the current frame ratio; horizontal
and vertical edges change one dimension only. Cover/crop remains the default
undistorted behavior, while explicit persisted stretch mode allows
non-uniform content scaling and is retained by every exporter.

Imported and captured artifact images are decoded through the same hydration
path as image groups. Measured source width/height replaces the temporary 1:1
placeholder and derives the default frame width from the real source ratio.

Drag preview state never reaches persistence, export, history, Agent context, or
autosave.

Artifact crop uses immutable copy-on-write. Undo reassigns the old project asset
and Redo reassigns the new asset; physical cleanup waits until committed state
and retained history no longer reference either file.

## Limits

- 512 artifact records per plan;
- 128 images per artifact collection;
- 2,048 images across artifact collections.

Legacy `imageGroups` are excluded from these new caps. Additions fail
actionably when a cap is reached; opening, saving, and exporting compatible
legacy content remain available.

## Export

All exporters follow visible recursive document order and consume a validated
immutable committed snapshot.

- PDF renders artifact headings, non-empty metadata/source notes, and galleries.
- DOCX keeps metadata editable and embeds project-local gallery images.
- Long-image export mounts the same read-only BlockNote schema and artifact
  renderer.
- A populated collapsed try-on gallery is exported so content is not lost.
- Empty optional fields, empty source notes, and empty optional sections emit no
  reserved space.

PDF, DOCX, and long-image production pipelines remain independent. Artifact
support must not introduce a silent fallback between them.

## Accessibility and responsive behavior

- Inputs have visible labels and adjacent errors.
- Icon buttons have accessible names and visible focus rings.
- Disclosure uses `aria-expanded` and keyboard activation.
- Delete confirmation traps/restores focus.
- Galleries retain keyboard drag alternatives.
- Metadata and gallery layouts stack inside narrow weighted columns.
- Motion remains 150–200 ms and honors `prefers-reduced-motion`.

## Validation

Required coverage includes:

- v14-to-v15 migration and legacy duplicate-image repair;
- marker/record and global image-ID invariants;
- pending create/clone rollback and marker undo restoration;
- input draft/commit behavior and empty-source omission;
- same-/cross-/empty-collection drag with preview non-persistence;
- copy-on-write crop Undo/Redo leases;
- PDF, DOCX, and long-image visible order and omission rules;
- Agent recovery/checkpoint compatibility;
- keyboard, focus, IME, reduced-motion, and responsive editor behavior.
