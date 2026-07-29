# Basic Plan Editing Design

## Goal

Implement the first slice of the `基础方案编辑` (Basic Plan Editing) feature from
`docs/design_docs/featurelist.json`. When a project is opened, its primary
section is the **Plan** (`方案`). The Plan shows two tabs — **Photography Plan**
(`摄影计划`) and **Reference Images** (`参考样图`). This iteration fully implements
the Reference Images tab; the Photography Plan tab is an explicit "coming soon"
placeholder.

Reference Images let a user build multiple **groups**, each with a configurable
number of images per row. Images are shown as 1:1 squares and expand to full
size on click. Images are imported from disk through a per-slot `+` control.

## Scope

In scope:

- Plan as the primary section of an opened project, replacing the current
  `Workspace.tsx` placeholder.
- A two-tab Plan panel (Photography Plan placeholder, Reference Images).
- Reference Image groups: add, rename, delete, and set images-per-row.
- Reference images: import (move + renumber), display as 1:1 squares, remove,
  and expand in a lightbox.
- Plan persistence inside the `.preshot` manifest.
- Reference image files stored under a `references/` subfolder, numbered.

Out of scope (deferred):

- Photography Plan content and editing.
- Drag-and-drop reordering of groups or images.
- Server-side/Rust thumbnail generation.
- Canvas editing, copywriting, and PDF export.

## Architecture

The feature follows the same layering as Workspace Setup:

```text
React UI -> TypeScript use case -> domain port <- infrastructure adapter
                                                  |
                                                  +-> narrow Rust command
```

- `src/domain/plan` owns Plan models and the pure `PlanService` use cases
  (add/rename/delete group, set columns, add/remove image). It serializes saves
  and never imports React or Tauri.
- `src/infrastructure/plan` implements the ports with Tauri command adapters and
  an in-memory browser adapter for E2E.
- `src/features/plan` owns the Plan UI.
- `src/app/layout/Workspace.tsx` composes the Plan panel with the opened
  project's path and dependencies.

## Data Model

Plan data lives inside the versioned `.preshot` manifest. The manifest stays at
`schemaVersion: 1`; `plan` is optional, so existing projects remain valid
exactly as `coverImage` does today.

```ts
interface ProjectPlan {
  referenceGroups: ReferenceGroup[];
}

interface ReferenceGroup {
  id: string;            // uuid
  title: string;
  columnsPerRow: number; // integer, clamped 1..=6
  images: ReferenceImage[];
}

interface ReferenceImage {
  id: string;            // uuid
  file: string;          // project-relative path, e.g. "references/0007.jpg"
}
```

Manifest addition (TypeScript and Rust both extend their manifest types):

```jsonc
{
  "schemaVersion": 1,
  "id": "…", "name": "…", "createdAt": "…", "updatedAt": "…",
  "coverImage": "…",          // optional, unchanged
  "plan": {                    // optional, new
    "referenceGroups": [
      { "id": "…", "title": "Lookbook", "columnsPerRow": 3,
        "images": [ { "id": "…", "file": "references/0001.jpg" } ] }
    ]
  }
}
```

### Reference image files

- Imported images are **moved** into `<project>/references/` (source file is
  removed). Same-volume moves use rename; cross-volume falls back to copy then
  delete of the source.
- Files are renamed with a zero-padded incrementing number and their original
  extension, e.g. `0001.jpg`, `0002.png`. The next number is the maximum
  existing numeric file name under `references/` plus one.
- Only `jpg`, `jpeg`, and `png` are accepted. Single-file limit is 16 MB,
  reusing the existing cover-size ceiling.
- `references/` keeps reference images out of the project root, so they never
  interfere with root-scan cover resolution.

## Rust Commands

New narrow commands beside the existing workspace commands. All validate inputs,
keep paths inside the project, add operation context to failures, and emit
structured logs consistent with the workspace layer.

- `import_reference_image(projectPath, sourcePath) -> { file, dataUrl }`
  Validate the source extension (jpg/png) and size, create `references/` if
  needed, move + renumber the file, and return the project-relative path plus a
  base64 data URL for immediate display.
- `load_reference_image(projectPath, file) -> dataUrl`
  Reject any `file` that escapes `references/` (no absolute paths, no traversal),
  read within the size limit, and return a base64 data URL. Used when reopening
  a project.
- `remove_reference_image(projectPath, file) -> ()`
  Validate the path is inside `references/` and delete the file.
- `save_project_plan(projectPath, plan) -> ProjectManifest`
  Read the manifest, set `plan`, refresh `updatedAt`, and write atomically
  (write-temp-then-rename), returning the updated manifest.

`inspect_project` already returns the manifest; once the manifest type carries
`plan`, opening a project surfaces the plan structure automatically.

### Image rendering decision

Images render through on-demand base64 data URLs returned by the commands above.
This matches the existing cover-image implementation and the narrow-command,
least-privilege security posture. The alternative — the Tauri asset protocol —
was rejected because it would require dynamically widening filesystem read scope
per opened project. Thumbnail generation is deferred; CSS `object-fit: cover`
produces the 1:1 squares from full images.

## Domain Ports and Service

```ts
interface PlanRepository {
  savePlan(projectPath: string, plan: ProjectPlan): Promise<void>;
}

interface ReferenceImageStore {
  importImage(projectPath: string, sourcePath: string):
    Promise<{ file: string; dataUrl: string }>;
  loadImage(projectPath: string, file: string): Promise<string>;
  removeImage(projectPath: string, file: string): Promise<void>;
}
```

`PlanService` exposes use cases that operate on an in-memory `ProjectPlan`,
persist through `PlanRepository`, and orchestrate `ReferenceImageStore` for image
mutations. Saves are serialized through an operation queue like
`WorkspaceService`, so concurrent edits cannot interleave. Column counts are
clamped to `1..=6`. Removing an image removes it from the plan and deletes the
file; a failed file delete surfaces as an actionable error.

## UI and Data Flow

- The opened-project shell (`AppShell`) shows **方案 / Plan** as the active
  primary navigation item. Deferred tools are not presented as functional.
- `PlanPanel` renders two tabs. **Photography Plan** is a labeled placeholder.
  **Reference Images** renders the groups.
- Each group shows an editable title, an images-per-row control, and a grid at
  `columnsPerRow` columns. Each image is a 1:1 square (`object-fit: cover`) with
  a remove control; a trailing `+` slot imports a new image. An "Add group"
  action appends a group.
- Clicking an image opens `ReferenceImageLightbox` showing the full image.

Flow:

1. Open project → `PlanPanel` reads `plan` from the opened project's manifest →
   for each image calls `loadImage` → shows squares.
2. `+` → file picker filtered to jpg/png → `importImage` moves +
   renumbers → `PlanService.addImage` updates the plan → `savePlan` persists →
   the new square appears using the returned data URL.
3. Set columns / add / rename / delete group / remove image → update the plan →
   `savePlan`.

## Error Handling

Reuse the workspace patterns: adapters wrap native failures with operation
context and a `cause`; the Plan UI surfaces actionable errors instead of
success-shaped fallbacks. Rust commands return typed `CommandError`s for
unsupported types, oversized files, path traversal, missing manifests, and IO
failures. Manifest writes are atomic. Structured logs use a `plan-service`
service name mirroring `workspace-service`.

## Testing

- **Domain**: pure `PlanService` tests for add/rename/delete group, column
  clamping, add/remove image, save serialization, and error propagation, using
  typed fakes.
- **Adapters**: mock Tauri `invoke`; assert command names, serialized inputs,
  validated `{ file, dataUrl }` responses, and contextual failures.
- **Rust** (`tempfile::tempdir`): import moves + renumbers and rejects
  unsupported/oversized files; load returns a data URL and rejects traversal;
  remove deletes only inside `references/`; save writes `plan` into the manifest
  and refreshes `updatedAt`.
- **Components**: Reference Images tab — add group, set columns, `+` import with
  a mocked port, remove image, and lightbox open/close, queried by accessible
  role and name.
- **Browser E2E**: the in-memory adapter seeds a group of reference images; the
  Plan panel renders the squares and opens the lightbox.

## Verification Matrix

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:init`, `pnpm test:e2e`,
`cargo fmt --check`, `cargo test`, `pnpm build`, `pnpm tauri:build`.
