# Workspace Setup Design

## Goal

Implement the `Workspace Setup` feature described in
`docs/design_docs/featurelist.json`: persist a recent-project registry in the
Windows application data directory, create and validate Preshot project
folders, present a project launcher, and expose desktop project actions through
the native File menu.

## Scope

This feature includes:

- Application metadata stored under the platform application-data directory.
- Preshot project creation and opening.
- JSON `.preshot` project manifests.
- A recent-project launcher showing three projects at a time.
- Cover-image resolution and unavailable-project recovery.
- Native File menu actions and project-selector windows.

Canvas editing, asset ingestion, copywriting, project-content persistence, and
PDF export remain outside this feature.

## Architecture

The implementation follows:

```text
React UI -> TypeScript use case -> domain port <- infrastructure adapter
                                                  |
                                                  +-> Tauri Store / Dialog
                                                  +-> narrow Rust command
```

The TypeScript domain layer owns project records, manifest types, sorting,
deduplication, availability state, and relocation rules. Infrastructure owns
Tauri Store, Dialog, event, and command integration. Rust owns operating-system
file operations and native window/menu behavior, not workspace business rules.

## Application Metadata

Tauri Store persists `workspace.json` in the platform application-data
directory. Its shape is:

```ts
interface WorkspaceMetadata {
  schemaVersion: 1;
  projects: WorkspaceProjectRecord[];
}

interface WorkspaceProjectRecord {
  projectId: string;
  path: string;
  name: string;
  coverImage: string | null;
  status: "available" | "unavailable";
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
}
```

The application does not implement accounts or local profile selection.
Records are ordered by `lastOpenedAt` descending. Opening the same project ID
updates its existing record and path rather than adding a duplicate.

At startup, every registered project is validated. Missing directories,
missing manifests, invalid manifests, and mismatched IDs mark a record
`unavailable`; they do not remove it automatically.

## Project Manifest

Every project root contains a UTF-8 JSON file named `.preshot`:

```ts
interface ProjectManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  coverImage?: string;
}
```

`coverImage`, when present, is a project-relative path and must resolve within
the project root. If it is absent or invalid, the native project inspector
selects the first supported image in the project root by deterministic
case-insensitive filename order. Supported formats are JPEG, PNG, WebP, GIF,
and BMP. The first version does not recurse into subdirectories.

## Native Commands

Rust exposes narrowly scoped commands:

- `create_project(parent_path, name)` validates the project name, creates a new
  child directory, and atomically writes its `.preshot` manifest.
- `inspect_project(path)` validates the directory and manifest, then returns
  normalized project metadata and a cover-image path when available.
- `remove_created_project(path, project_id)` removes only an empty project
  directory created by the current failed create operation and only when its
  manifest ID matches.
- `open_project_window()` creates a new window that starts on the project
  launcher.
- Native File menu handlers emit typed events for new/open actions and close
  the current window for Close.

The commands accept canonicalized absolute paths. Project creation rejects
blank names, reserved Windows names, path separators, trailing dots/spaces,
and existing destination paths. Manifest creation uses a temporary file and
rename to avoid partial JSON.

## Use Cases

### Load Workspace

1. Read or create `workspace.json`.
2. Validate its schema.
3. Inspect every project through the native adapter.
4. Update record metadata and availability.
5. Persist the validated registry.
6. Return records sorted by most recently opened.

An unreadable or unsupported metadata schema produces a recoverable launcher
error. The application does not silently replace it with an empty registry.

### Create Project

1. Select a parent directory.
2. Prompt for a project name in the application UI.
3. Call `create_project`.
4. Add the returned project to the registry and persist it.
5. Open the project workspace.

If registry persistence fails, call `remove_created_project`. If rollback also
fails, report both the persistence and cleanup failures; do not report project
creation as successful.

### Open Existing Project

1. Select a directory.
2. Call `inspect_project`.
3. Reject directories without a valid `.preshot`.
4. Upsert the project record by manifest ID.
5. Persist and open the workspace.

### Relocate Project

1. Select a candidate directory.
2. Inspect its manifest.
3. Require the manifest ID to equal the unavailable record ID.
4. Update the path, metadata, status, and last-opened timestamp.

An ID mismatch leaves the existing record unchanged.

### Remove Record

Removing an unavailable record deletes only the AppData registry entry. It
never deletes project files.

## User Interface

The launcher uses the approved editorial horizontal gallery:

- Three large project cards are visible at the default desktop width.
- The rail supports mouse-wheel translation, touchpad horizontal scrolling, a
  draggable scrollbar, arrow controls, and left/right keyboard navigation.
- Cards show the resolved cover image with the project name overlaid.
- Projects without images use a generated name-based visual.
- Unavailable cards retain their known name and show Relocate and Remove
  actions.
- Empty registries show New Project and Open Project primary actions.
- Selecting an available card opens the existing planning workspace.

The window must remain usable at the configured minimum width. Controls expose
accessible names and keyboard focus states.

## Native File Menu

Every application window has a native File menu:

- **New Project** starts the create flow in the current window.
- **Open Project** starts the open flow in the current window.
- **Close** closes the current window.
- **Open New Window** creates a new project-launcher window without inheriting
  the current project.

Menu actions reach React through typed Tauri events. UI buttons and native menu
items call the same use cases.

## Application State

The composition root owns a small workspace session state:

```ts
type AppView =
  | { kind: "launcher" }
  | { kind: "project"; project: WorkspaceProjectRecord };
```

No global state-management dependency is added. A focused React provider owns
the current view, launcher load state, recoverable error, and use-case
dependencies.

## Error Handling

- Native errors use serializable error codes and contextual messages.
- Store, Dialog, and invoke failures are wrapped with operation context.
- Expected failures appear in the launcher or dialog flow and remain
  recoverable.
- Invalid manifests, path traversal, and ID mismatches never mutate the
  registry.
- No failed operation returns success-shaped data.
- The Error Boundary remains reserved for unexpected rendering failures.

## Testing

- Domain tests cover sorting, deduplication, status transitions, path updates,
  and relocation ID matching.
- Use-case tests cover create rollback, open upsert, metadata load failure, and
  unavailable-record removal.
- React Testing Library covers launcher loading, three-card presentation,
  keyboard navigation, empty state, unavailable actions, and menu events.
- Adapter tests mock Tauri Store, Dialog, events, and invoke at the platform
  boundary.
- Rust tests use temporary directories for manifest creation, validation,
  cover selection, unsafe names, conflicts, and rollback guards.
- Playwright covers launcher startup and opening an available project through a
  seeded browser adapter.

## Feature Tracking

During implementation,
`docs/design_docs/featurelist.json` is updated without removing existing
descriptions:

- Set status to `in progress` when implementation starts.
- Record the approved architecture, manifest format, gallery layout, cover
  fallback, relocation rule, and native menu choice in `decisions`.
- Set status to `completed` only after the complete verification matrix passes.

## Acceptance Criteria

1. Workspace metadata persists under the platform application-data directory.
2. A user can create a named project under a selected parent directory.
3. Only directories with valid `.preshot` manifests can be opened.
4. The launcher shows recent projects three at a time in last-opened order.
5. Project covers follow the explicit-cover then root-image fallback rule.
6. Invalid recent projects remain visible and can be relocated by matching ID
   or removed from the registry.
7. Native File menu actions create, open, close, and open launcher windows as
   specified.
8. Domain, component, adapter, Rust, and browser tests pass.
9. `featurelist.json` records the completed status and key decisions.
