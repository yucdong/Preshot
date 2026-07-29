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
`workspace` is the first implemented capability: the recent-project launcher and
the new-project dialog. Planned capabilities are canvas, asset ingestion,
copywriting, and export. Create a feature directory only when that capability is
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

### Boundaries

- The domain `WorkspaceService` owns all rules and serializes every mutation
  through an internal queue so concurrent actions cannot interleave.
- The Store adapter only loads and saves `workspace.json`.
- The Dialog adapter only selects a directory.
- The native-command adapter (`tauriWorkspace.ts`) wraps the Rust
  `create_project`, `inspect_project`, `rollback_created_project`, and
  `forget_created_project` commands and validates every response shape.
- Rust commands stay narrow: filesystem work, atomic manifest writes
  (write-temp-then-rename), cover resolution, and token-authorized rollback of a
  just-created project. They hold no UI or business rules.

### Native menu flow

The Rust File menu (`src-tauri/src/menu.rs`) owns New Project, Open Project,
Open New Window, and Close. New Project and Open Project emit a `workspace://menu`
event to the focused webview; the `tauriWorkspace.onMenuAction` adapter validates
the payload and forwards it to `WorkspaceProvider`, which runs the same guarded
flows as the launcher buttons. Open New Window and Close are handled entirely in
Rust, and new windows open the launcher.

## Basic Plan Editing

Basic Plan Editing is the second vertical slice and demonstrates the same clean
layering applied to in-project data: React UI -> `PlanService` use case ->
domain port -> infrastructure adapter -> Tauri command -> project filesystem.

### Plan storage

The project plan lives in the `.preshot` manifest as an optional `plan` field
(same `schemaVersion: 1`). Reference images are stored in a `references/`
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

### Boundaries

- The domain `PlanService` owns plan rules (group management, column clamping
  1..=6, reference ordering) and validates all mutations.
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
- PDF generation implements `PdfExporter` with pdf-lib and receives a domain
  project rather than reading UI state directly.

## Mobile Evolution

Do not create a monorepo preemptively. When the first mobile client starts,
extract platform-independent domain models and use cases into a workspace
package. React UI and platform adapters remain client-specific.

## Error Flow

Expected failures travel from adapters to use cases and then to explicit UI
states. Adapters retain the failed operation and original cause. Unexpected
render failures reach `ErrorBoundary`, which displays a recovery message and
logs the diagnostic context.
