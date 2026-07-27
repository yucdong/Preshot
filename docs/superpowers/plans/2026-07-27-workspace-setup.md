# Workspace Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable recent-project metadata, `.preshot` project folders, a three-card project launcher, unavailable-project recovery, and native File menu actions.

**Architecture:** Keep workspace rules in pure TypeScript domain/use-case modules. Tauri Store, Dialog, events, and `invoke` live behind infrastructure ports; Rust owns guarded filesystem operations and native menu/window behavior. React composes those capabilities through a focused workspace provider without adding a global state library.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Tauri v2, Rust, Tauri Store/Dialog plugins, Vitest, React Testing Library, Playwright

---

## File Map

- `docs/design_docs/featurelist.json`: feature status and approved decisions.
- `src/domain/workspace/models.ts`: manifest, registry, status, and inspected-project types.
- `src/domain/workspace/ports.ts`: registry, native project, directory picker, clock, and logger ports.
- `src/domain/workspace/registry.ts`: deterministic sort, upsert, availability, and relocation rules.
- `src/domain/workspace/registry.test.ts`: pure registry tests.
- `src/domain/workspace/service.ts`: load/create/open/relocate/remove use cases.
- `src/domain/workspace/service.test.ts`: use-case success, failure, and rollback tests.
- `src/shared/logging/logger.ts`: single-line structured JSON logger.
- `src/infrastructure/workspace/tauriWorkspace.ts`: typed native command and menu-event adapter.
- `src/infrastructure/workspace/tauriWorkspace.test.ts`: Tauri boundary tests.
- `src/infrastructure/workspace/workspaceStore.ts`: Tauri Store registry adapter.
- `src/infrastructure/workspace/workspaceStore.test.ts`: Store serialization and failure tests.
- `src/infrastructure/workspace/workspaceDialog.ts`: directory picker adapter.
- `src/infrastructure/workspace/browserWorkspace.ts`: explicit E2E-only seeded adapter.
- `src/features/workspace/WorkspaceLauncher.tsx`: launcher loading, empty, error, and gallery states.
- `src/features/workspace/WorkspaceLauncher.test.tsx`: launcher behavior tests.
- `src/features/workspace/ProjectRail.tsx`: accessible three-card horizontal navigation.
- `src/features/workspace/ProjectCard.tsx`: available and unavailable project presentation.
- `src/features/workspace/NewProjectDialog.tsx`: project-name input and validation display.
- `src/app/workspace/WorkspaceProvider.tsx`: application workspace session and action orchestration.
- `src/app/workspace/dependencies.ts`: production and E2E dependency composition.
- `src/app/App.tsx`: switch between launcher and project workspace.
- `src/app/App.test.tsx`: launcher-to-workspace integration tests.
- `src-tauri/src/workspace.rs`: guarded manifest and cover filesystem operations.
- `src-tauri/src/menu.rs`: native File menu and launcher-window creation.
- `src-tauri/src/error.rs`: serializable native error payload.
- `src-tauri/src/lib.rs`: plugin, command, setup, and menu registration.
- `src-tauri/capabilities/default.json`: minimum Store and Dialog permissions.
- `src-tauri/tauri.conf.json`: CSP support for in-memory cover images.
- `src-tauri/Cargo.toml`: native dependencies.
- `playwright.config.ts`: explicit E2E adapter mode.
- `.env.e2e`: select the deterministic browser workspace adapter.
- `e2e/workspace.spec.ts`: launcher and project-open smoke flow.
- `docs/ARCHITECTURE.md`: workspace architecture and data ownership.
- `docs/TESTING.md`: workspace test commands and boundaries.
- `docs/RELIABILITY.md`: workspace structured logging points.

### Task 1: Track the Feature and Enable Tauri Plugins

**Files:**
- Modify: `docs/design_docs/featurelist.json`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Mark the feature in progress and record approved decisions**

Preserve `feature_descriptions` and replace the feature status and decisions
with:

```json
"status": "in progress",
"decisions": [
  "Use TypeScript domain use cases with narrow Tauri adapters and Rust filesystem commands.",
  "Store workspace metadata in AppData through Tauri Store.",
  "Use a versioned JSON .preshot manifest with project identity and timestamps.",
  "Create projects by selecting a parent directory and entering a project name.",
  "Use an editorial horizontal gallery showing three recent projects at a time.",
  "Resolve covers from manifest coverImage, then the first supported root image.",
  "Keep invalid projects visible and require matching project IDs for relocation.",
  "Use a native Tauri File menu; new windows open the project launcher."
]
```

- [ ] **Step 2: Install JavaScript plugin bindings**

Run:

```powershell
pnpm add @tauri-apps/plugin-dialog@2.7.2 @tauri-apps/plugin-store@2.4.4
```

Expected: both packages appear in `dependencies` and the lock file updates.

- [ ] **Step 3: Add Rust dependencies**

Add these entries to `[dependencies]` in `src-tauri/Cargo.toml`:

```toml
base64 = "0.22"
chrono = { version = "0.4", features = ["serde"] }
tauri-plugin-dialog = "2"
tauri-plugin-store = "2"
uuid = { version = "1", features = ["v4", "serde"] }
```

Add:

```toml
[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 4: Grant only required plugin permissions**

Set `windows` to `["main", "workspace-*"]` so newly created launcher windows
receive the same capability, and set `permissions` in
`src-tauri/capabilities/default.json` to:

```json
[
  "core:default",
  "dialog:allow-open",
  "store:allow-load",
  "store:allow-get-store",
  "store:allow-get",
  "store:allow-set",
  "store:allow-save"
]
```

- [ ] **Step 5: Permit generated cover data URLs**

Change the CSP image directive in `src-tauri/tauri.conf.json` to:

```json
"csp": "default-src 'self'; connect-src ipc: http://ipc.localhost; img-src 'self' data:; style-src 'self' 'unsafe-inline'"
```

- [ ] **Step 6: Verify manifests**

Run:

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
cargo metadata --manifest-path src-tauri\Cargo.toml --no-deps
```

Expected: all commands exit with code 0.

- [ ] **Step 7: Commit the feature setup**

```powershell
git add docs/design_docs/featurelist.json package.json pnpm-lock.yaml `
  src-tauri/Cargo.toml src-tauri/Cargo.lock `
  src-tauri/capabilities/default.json src-tauri/tauri.conf.json
git commit -m "build: enable workspace setup dependencies"
```

### Task 2: Implement Pure Workspace Registry Rules

**Files:**
- Create: `src/domain/workspace/models.ts`
- Create: `src/domain/workspace/ports.ts`
- Create: `src/domain/workspace/registry.ts`
- Create: `src/domain/workspace/registry.test.ts`

- [ ] **Step 1: Write failing registry tests**

Create `src/domain/workspace/registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  markProjectUnavailable,
  relocateProject,
  sortProjects,
  upsertProject,
} from "./registry";
import type { WorkspaceProjectRecord } from "./models";

const project = (
  projectId: string,
  lastOpenedAt: string,
): WorkspaceProjectRecord => ({
  projectId,
  path: `C:\\shoots\\${projectId}`,
  name: projectId,
  coverImage: null,
  coverDataUrl: null,
  status: "available",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  lastOpenedAt,
});

describe("workspace registry", () => {
  it("sorts projects by most recently opened", () => {
    expect(
      sortProjects([
        project("older", "2026-07-01T00:00:00.000Z"),
        project("newer", "2026-07-02T00:00:00.000Z"),
      ]).map(({ projectId }) => projectId),
    ).toEqual(["newer", "older"]);
  });

  it("upserts by project ID instead of duplicating a moved project", () => {
    const existing = project("same-id", "2026-07-01T00:00:00.000Z");
    const moved = { ...existing, path: "D:\\shoots\\same-id" };

    expect(upsertProject([existing], moved)).toEqual([moved]);
  });

  it("retains known metadata when a project becomes unavailable", () => {
    const existing = project("missing", "2026-07-01T00:00:00.000Z");

    expect(markProjectUnavailable(existing)).toEqual({
      ...existing,
      status: "unavailable",
      coverDataUrl: null,
    });
  });

  it("rejects relocation to a different project ID", () => {
    const existing = markProjectUnavailable(
      project("expected", "2026-07-01T00:00:00.000Z"),
    );

    expect(() =>
      relocateProject(existing, project("different", existing.lastOpenedAt)),
    ).toThrow("Selected folder belongs to a different Preshot project");
  });
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run:

```powershell
pnpm test -- src/domain/workspace/registry.test.ts
```

Expected: FAIL because workspace registry modules do not exist.

- [ ] **Step 3: Define workspace types and ports**

Create `src/domain/workspace/models.ts`:

```ts
export type ProjectAvailability = "available" | "unavailable";

export interface ProjectManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  coverImage?: string;
}

export interface WorkspaceProjectRecord {
  projectId: string;
  path: string;
  name: string;
  coverImage: string | null;
  /** Runtime-only preview; WorkspaceRegistry adapters must not persist it. */
  coverDataUrl?: string | null;
  status: ProjectAvailability;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
}

export interface WorkspaceMetadata {
  schemaVersion: 1;
  projects: WorkspaceProjectRecord[];
}

export interface InspectedProject {
  path: string;
  manifest: ProjectManifest;
  resolvedCoverImage: string | null;
  coverDataUrl: string | null;
}

export const EMPTY_WORKSPACE: WorkspaceMetadata = {
  schemaVersion: 1,
  projects: [],
};
```

Create `src/domain/workspace/ports.ts`:

```ts
import type {
  InspectedProject,
  WorkspaceMetadata,
  WorkspaceProjectRecord,
} from "./models";

export interface WorkspaceRegistry {
  load(): Promise<WorkspaceMetadata>;
  save(metadata: WorkspaceMetadata): Promise<void>;
}

export interface NativeWorkspace {
  createProject(parentPath: string, name: string): Promise<InspectedProject>;
  inspectProject(path: string): Promise<InspectedProject>;
  removeCreatedProject(path: string, projectId: string): Promise<void>;
  onMenuAction(handler: (action: WorkspaceMenuAction) => void): Promise<() => void>;
}

export interface WorkspaceDirectoryPicker {
  pickDirectory(title: string): Promise<string | null>;
}

export interface WorkspaceClock {
  now(): string;
}

export interface WorkspaceLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export type WorkspaceMenuAction = "new-project" | "open-project";

export interface WorkspaceService {
  loadProjects(): Promise<WorkspaceProjectRecord[]>;
  createProject(parentPath: string, name: string): Promise<WorkspaceProjectRecord>;
  openProject(path: string): Promise<WorkspaceProjectRecord>;
  relocateProject(
    record: WorkspaceProjectRecord,
    path: string,
  ): Promise<WorkspaceProjectRecord>;
  removeRecord(projectId: string): Promise<WorkspaceProjectRecord[]>;
}
```

- [ ] **Step 4: Implement deterministic registry functions**

Create `src/domain/workspace/registry.ts`:

```ts
import type {
  InspectedProject,
  WorkspaceProjectRecord,
} from "./models";

export function sortProjects(
  projects: WorkspaceProjectRecord[],
): WorkspaceProjectRecord[] {
  return [...projects].sort((a, b) =>
    b.lastOpenedAt.localeCompare(a.lastOpenedAt),
  );
}

export function upsertProject(
  projects: WorkspaceProjectRecord[],
  project: WorkspaceProjectRecord,
): WorkspaceProjectRecord[] {
  return sortProjects([
    project,
    ...projects.filter(({ projectId }) => projectId !== project.projectId),
  ]);
}

export function markProjectUnavailable(
  project: WorkspaceProjectRecord,
): WorkspaceProjectRecord {
  return { ...project, status: "unavailable", coverDataUrl: null };
}

export function inspectedToRecord(
  inspected: InspectedProject,
  lastOpenedAt: string,
): WorkspaceProjectRecord {
  return {
    projectId: inspected.manifest.id,
    path: inspected.path,
    name: inspected.manifest.name,
    coverImage: inspected.resolvedCoverImage,
    coverDataUrl: inspected.coverDataUrl,
    status: "available",
    createdAt: inspected.manifest.createdAt,
    updatedAt: inspected.manifest.updatedAt,
    lastOpenedAt,
  };
}

export function relocateProject(
  current: WorkspaceProjectRecord,
  replacement: WorkspaceProjectRecord,
): WorkspaceProjectRecord {
  if (current.projectId !== replacement.projectId) {
    throw new Error("Selected folder belongs to a different Preshot project");
  }
  return replacement;
}
```

- [ ] **Step 5: Run registry tests**

Run:

```powershell
pnpm test -- src/domain/workspace/registry.test.ts
pnpm typecheck
```

Expected: four tests pass and type checking succeeds.

- [ ] **Step 6: Commit registry rules**

```powershell
git add src/domain/workspace
git commit -m "feat: add workspace registry domain"
```

### Task 3: Implement Workspace Use Cases

**Files:**
- Create: `src/domain/workspace/service.ts`
- Create: `src/domain/workspace/service.test.ts`

- [ ] **Step 1: Write failing use-case tests**

Create `src/domain/workspace/service.test.ts` with in-memory fakes and these
behaviors:

```ts
it("rolls back a newly created project when registry persistence fails", async () => {
  registry.save.mockRejectedValue(new Error("disk full"));
  native.createProject.mockResolvedValue(inspected("project-1"));

  await expect(
    service.createProject("C:\\shoots", "Editorial"),
  ).rejects.toThrow("Unable to save workspace metadata: disk full");
  expect(native.removeCreatedProject).toHaveBeenCalledWith(
    "C:\\shoots\\Editorial",
    "project-1",
  );
});

it("keeps invalid registered projects as unavailable", async () => {
  registry.load.mockResolvedValue({
    schemaVersion: 1,
    projects: [record("missing")],
  });
  native.inspectProject.mockRejectedValue(new Error("manifest missing"));

  await expect(service.loadProjects()).resolves.toEqual([
    expect.objectContaining({ projectId: "missing", status: "unavailable" }),
  ]);
});

it("upserts an opened project and updates lastOpenedAt", async () => {
  registry.load.mockResolvedValue({
    schemaVersion: 1,
    projects: [record("project-1")],
  });
  native.inspectProject.mockResolvedValue(inspected("project-1", "D:\\moved"));

  await expect(service.openProject("D:\\moved")).resolves.toEqual(
    expect.objectContaining({
      projectId: "project-1",
      path: "D:\\moved",
      lastOpenedAt: NOW,
    }),
  );
});

it("does not mutate metadata for a relocation ID mismatch", async () => {
  native.inspectProject.mockResolvedValue(inspected("different"));

  await expect(
    service.relocateProject(record("expected"), "D:\\other"),
  ).rejects.toThrow("different Preshot project");
  expect(registry.save).not.toHaveBeenCalled();
});
```

Define `record`, `inspected`, `registry`, `native`, `clock`, and `logger` as
typed Vitest fakes matching the ports from Task 2.

- [ ] **Step 2: Verify the use-case tests fail**

Run:

```powershell
pnpm test -- src/domain/workspace/service.test.ts
```

Expected: FAIL because `createWorkspaceService` does not exist.

- [ ] **Step 3: Implement the service**

Create `src/domain/workspace/service.ts`:

```ts
import type {
  NativeWorkspace,
  WorkspaceClock,
  WorkspaceLogger,
  WorkspaceRegistry,
  WorkspaceService,
} from "./ports";
import type { WorkspaceMetadata, WorkspaceProjectRecord } from "./models";
import {
  inspectedToRecord,
  markProjectUnavailable,
  relocateProject as assertRelocation,
  sortProjects,
  upsertProject,
} from "./registry";

interface Dependencies {
  registry: WorkspaceRegistry;
  native: NativeWorkspace;
  clock: WorkspaceClock;
  logger: WorkspaceLogger;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createWorkspaceService({
  registry,
  native,
  clock,
  logger,
}: Dependencies): WorkspaceService {
  let metadata: WorkspaceMetadata | null = null;

  async function readMetadata(): Promise<WorkspaceMetadata> {
    if (metadata) return metadata;
    try {
      metadata = await registry.load();
      if (metadata.schemaVersion !== 1) {
        throw new Error(`Unsupported workspace schema ${metadata.schemaVersion}`);
      }
      return metadata;
    } catch (error) {
      throw new Error(`Unable to load workspace metadata: ${message(error)}`, {
        cause: error,
      });
    }
  }

  async function save(projects: WorkspaceProjectRecord[]): Promise<void> {
    const next: WorkspaceMetadata = { schemaVersion: 1, projects };
    try {
      await registry.save(next);
      metadata = next;
    } catch (error) {
      throw new Error(`Unable to save workspace metadata: ${message(error)}`, {
        cause: error,
      });
    }
  }

  return {
    async loadProjects() {
      const current = await readMetadata();
      const validated = await Promise.all(
        current.projects.map(async (record) => {
          try {
            const inspected = await native.inspectProject(record.path);
            if (inspected.manifest.id !== record.projectId) {
              return markProjectUnavailable(record);
            }
            return {
              ...inspectedToRecord(inspected, record.lastOpenedAt),
              lastOpenedAt: record.lastOpenedAt,
            };
          } catch (error) {
            logger.warn("Workspace project unavailable", {
              projectId: record.projectId,
              reason: message(error),
            });
            return markProjectUnavailable(record);
          }
        }),
      );
      const projects = sortProjects(validated);
      await save(projects);
      return projects;
    },

    async createProject(parentPath, name) {
      const inspected = await native.createProject(parentPath, name);
      const record = inspectedToRecord(inspected, clock.now());
      const current = await readMetadata();
      try {
        await save(upsertProject(current.projects, record));
      } catch (saveError) {
        try {
          await native.removeCreatedProject(record.path, record.projectId);
        } catch (rollbackError) {
          throw new Error(
            `${message(saveError)}; rollback failed: ${message(rollbackError)}`,
            { cause: saveError },
          );
        }
        throw saveError;
      }
      logger.info("Workspace project created", { projectId: record.projectId });
      return record;
    },

    async openProject(path) {
      const inspected = await native.inspectProject(path);
      const record = inspectedToRecord(inspected, clock.now());
      const current = await readMetadata();
      await save(upsertProject(current.projects, record));
      return record;
    },

    async relocateProject(currentRecord, path) {
      const inspected = await native.inspectProject(path);
      const replacement = inspectedToRecord(inspected, clock.now());
      const relocated = assertRelocation(currentRecord, replacement);
      const current = await readMetadata();
      await save(upsertProject(current.projects, relocated));
      return relocated;
    },

    async removeRecord(projectId) {
      const current = await readMetadata();
      const projects = current.projects.filter(
        (project) => project.projectId !== projectId,
      );
      await save(projects);
      return sortProjects(projects);
    },
  };
}
```

- [ ] **Step 4: Run use-case and domain tests**

Run:

```powershell
pnpm test -- src/domain/workspace
pnpm typecheck
```

Expected: registry and service tests pass.

- [ ] **Step 5: Commit use cases**

```powershell
git add src/domain/workspace
git commit -m "feat: add workspace project use cases"
```

### Task 4: Implement Guarded Native Project Operations

**Files:**
- Create: `src-tauri/src/error.rs`
- Create: `src-tauri/src/workspace.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/workspace.rs`

- [ ] **Step 1: Write Rust tests before command implementation**

Add a `#[cfg(test)]` module to `workspace.rs` covering:

```rust
#[test]
fn creates_a_versioned_manifest_in_a_named_child_directory() {
    let parent = tempfile::tempdir().unwrap();
    let created = create_project_in(parent.path(), "Editorial").unwrap();
    let manifest_path = parent.path().join("Editorial").join(".preshot");
    assert!(manifest_path.is_file());
    assert_eq!(created.manifest.name, "Editorial");
    assert_eq!(created.manifest.schema_version, 1);
}

#[test]
fn rejects_reserved_windows_project_names() {
    let parent = tempfile::tempdir().unwrap();
    let error = create_project_in(parent.path(), "CON").unwrap_err();
    assert_eq!(error.code, "invalid_project_name");
}

#[test]
fn rejects_directories_without_a_manifest() {
    let project = tempfile::tempdir().unwrap();
    let error = inspect_project_directory(project.path()).unwrap_err();
    assert_eq!(error.code, "manifest_missing");
}

#[test]
fn prefers_manifest_cover_then_falls_back_to_sorted_root_image() {
    let project = project_fixture_with_images(&["z.jpg", "a.png"]);
    let inspected = inspect_project_directory(project.path()).unwrap();
    assert!(inspected.cover_data_url.unwrap().starts_with("data:image/png;base64,"));
}

#[test]
fn rollback_refuses_a_directory_with_user_files() {
    let parent = tempfile::tempdir().unwrap();
    let created = create_project_in(parent.path(), "Editorial").unwrap();
    std::fs::write(
        parent.path().join("Editorial").join("notes.txt"),
        "keep me",
    )
    .unwrap();
    let error = remove_created_project_directory(
        &parent.path().join("Editorial"),
        &created.manifest.id,
    )
    .unwrap_err();
    assert_eq!(error.code, "rollback_not_empty");
}
```

The helper `project_fixture_with_images` writes a valid `.preshot` and minimal
image fixture bytes with deterministic names.

- [ ] **Step 2: Run Rust tests to verify failure**

Run:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml workspace
```

Expected: FAIL because workspace functions and types are missing.

- [ ] **Step 3: Add serializable native errors**

Create `src-tauri/src/error.rs`:

```rust
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl CommandError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
        }
    }
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for CommandError {}
```

- [ ] **Step 4: Implement manifest creation and validation**

Create `src-tauri/src/workspace.rs` with:

```rust
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::Utc;
use uuid::Uuid;

use crate::error::CommandError;

#[derive(Debug, Clone, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_image: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectedProject {
    pub path: String,
    pub manifest: ProjectManifest,
    pub resolved_cover_image: Option<String>,
    pub cover_data_url: Option<String>,
}

fn validate_project_name(name: &str) -> Result<(), CommandError> {
    let trimmed = name.trim();
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5",
        "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4",
        "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let stem = trimmed.split('.').next().unwrap_or("").to_ascii_uppercase();
    if trimmed.is_empty()
        || trimmed != name
        || trimmed.ends_with(['.', ' '])
        || trimmed.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])
        || reserved.contains(&stem.as_str())
    {
        return Err(CommandError::new(
            "invalid_project_name",
            "Project name is not valid on Windows",
        ));
    }
    Ok(())
}

pub fn create_project_in(
    parent: &Path,
    name: &str,
) -> Result<InspectedProject, CommandError> {
    validate_project_name(name)?;
    let parent = parent.canonicalize().map_err(|error| {
        CommandError::new("parent_not_found", format!("Parent folder is unavailable: {error}"))
    })?;
    let project = parent.join(name);
    if project.exists() {
        return Err(CommandError::new(
            "project_exists",
            "A file or folder with this project name already exists",
        ));
    }
    fs::create_dir(&project).map_err(|error| {
        CommandError::new("create_directory_failed", format!("Unable to create project: {error}"))
    })?;

    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let manifest = ProjectManifest {
        schema_version: 1,
        id: Uuid::new_v4().to_string(),
        name: name.to_string(),
        created_at: now.clone(),
        updated_at: now,
        cover_image: None,
    };
    write_manifest_atomically(&project, &manifest).map_err(|error| {
        let _ = fs::remove_dir(&project);
        error
    })?;
    inspect_project_directory(&project)
}

fn write_manifest_atomically(
    project: &Path,
    manifest: &ProjectManifest,
) -> Result<(), CommandError> {
    let temporary = project.join(".preshot.tmp");
    let destination = project.join(".preshot");
    let bytes = serde_json::to_vec_pretty(manifest).map_err(|error| {
        CommandError::new("manifest_encode_failed", error.to_string())
    })?;
    fs::write(&temporary, bytes).map_err(|error| {
        CommandError::new("manifest_write_failed", error.to_string())
    })?;
    fs::rename(&temporary, &destination).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        CommandError::new("manifest_commit_failed", error.to_string())
    })
}
```

Complete `inspect_project_directory`, `resolve_cover_path`,
`encode_cover_data_url`, and `remove_created_project_directory` in the same
file with these exact guards:

1. Canonicalize the project root and require a regular `.preshot` file.
2. Decode JSON, require `schema_version == 1`, a non-empty UUID ID, name, and
   RFC3339 timestamps.
3. Accept `cover_image` only when it is relative, contains no parent/root
   components, canonicalizes under the project root, is a regular supported
   image, and is no larger than 16 MiB.
4. Otherwise sort root files by lowercase filename and select the first
   `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, or `.bmp`.
5. Return the chosen project-relative path as `resolved_cover_image`; use MIME
   types derived from the validated extension and return the runtime-only
   preview as `data:<mime>;base64,<contents>`.
6. Rollback only when `.preshot` has the requested ID and the directory
   contains no entry except `.preshot`; remove the manifest, then the directory.

Expose commands:

```rust
#[tauri::command]
pub fn create_project(parent_path: String, name: String) -> Result<InspectedProject, CommandError> {
    create_project_in(Path::new(&parent_path), &name)
}

#[tauri::command]
pub fn inspect_project(path: String) -> Result<InspectedProject, CommandError> {
    inspect_project_directory(Path::new(&path))
}

#[tauri::command]
pub fn remove_created_project(
    path: String,
    project_id: String,
) -> Result<(), CommandError> {
    remove_created_project_directory(Path::new(&path), &project_id)
}
```

- [ ] **Step 5: Register modules and commands**

In `src-tauri/src/lib.rs`, declare `mod error; mod workspace;` and register:

```rust
.invoke_handler(tauri::generate_handler![
    platform_info,
    workspace::create_project,
    workspace::inspect_project,
    workspace::remove_created_project,
])
```

- [ ] **Step 6: Run Rust tests**

Run:

```powershell
cargo fmt --manifest-path src-tauri\Cargo.toml --check
cargo test --manifest-path src-tauri\Cargo.toml
```

Expected: workspace and platform tests pass.

- [ ] **Step 7: Commit native project operations**

```powershell
git add src-tauri
git commit -m "feat: add guarded Preshot project operations"
```

### Task 5: Add Store, Dialog, Native, and Logging Adapters

**Files:**
- Create: `src/shared/logging/logger.ts`
- Create: `src/infrastructure/workspace/workspaceStore.ts`
- Create: `src/infrastructure/workspace/workspaceStore.test.ts`
- Create: `src/infrastructure/workspace/workspaceDialog.ts`
- Create: `src/infrastructure/workspace/tauriWorkspace.ts`
- Create: `src/infrastructure/workspace/tauriWorkspace.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Test Store serialization:

```ts
it("loads and saves versioned workspace metadata", async () => {
  store.get.mockResolvedValue({
    schemaVersion: 1,
    projects: [],
  });
  const registry = createWorkspaceStore();

  await expect(registry.load()).resolves.toEqual({
    schemaVersion: 1,
    projects: [],
  });
  await registry.save({
    schemaVersion: 1,
    projects: [record],
  });
  const persistedRecord = { ...record };
  delete persistedRecord.coverDataUrl;
  expect(store.set).toHaveBeenCalledWith("workspace", {
    schemaVersion: 1,
    projects: [persistedRecord],
  });
  expect(store.save).toHaveBeenCalled();
});
```

Test native command context and menu event cleanup:

```ts
it("wraps structured native failures with operation context", async () => {
  invoke.mockRejectedValue({
    code: "manifest_missing",
    message: "Missing .preshot",
  });
  await expect(adapter.inspectProject("C:\\shoot")).rejects.toThrow(
    "Unable to inspect Preshot project: Missing .preshot",
  );
});

it("maps typed menu events and returns the unlisten function", async () => {
  const unlisten = vi.fn();
  listen.mockImplementation(async (_event, handler) => {
    handler({ payload: "open-project" });
    return unlisten;
  });
  const handler = vi.fn();
  await expect(adapter.onMenuAction(handler)).resolves.toBe(unlisten);
  expect(handler).toHaveBeenCalledWith("open-project");
});
```

- [ ] **Step 2: Verify adapter tests fail**

Run:

```powershell
pnpm test -- src/infrastructure/workspace
```

Expected: FAIL because adapters do not exist.

- [ ] **Step 3: Implement structured logging**

Create `src/shared/logging/logger.ts`:

```ts
import type { WorkspaceLogger } from "../../domain/workspace/ports";

function write(
  level: "DEBUG" | "INFO" | "WARN" | "ERROR",
  message: string,
  data: Record<string, unknown> = {},
) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: "workspace-service",
    message,
    data,
  });
  const sink = {
    DEBUG: console.debug,
    INFO: console.info,
    WARN: console.warn,
    ERROR: console.error,
  }[level];
  sink(entry);
}

export const workspaceLogger: WorkspaceLogger = {
  debug: (message, data) => write("DEBUG", message, data),
  info: (message, data) => write("INFO", message, data),
  warn: (message, data) => write("WARN", message, data),
  error: (message, data) => write("ERROR", message, data),
};
```

- [ ] **Step 4: Implement Store and Dialog adapters**

`workspaceStore.ts` loads `workspace.json` with `{ autoSave: false }`, stores
metadata under the single key `workspace`, returns `EMPTY_WORKSPACE` only when
the key is absent, validates `schemaVersion === 1` and every required project
field with a type guard, strips every runtime-only `coverDataUrl`, and calls
`set` then `save`. Invalid stored shapes throw an explicit schema error rather
than being treated as an empty workspace.
Every plugin failure must be rethrown as:

```ts
throw new Error(`Unable to load workspace metadata: ${detail}`, {
  cause: error,
});
```

`workspaceDialog.ts` implements:

```ts
import { open } from "@tauri-apps/plugin-dialog";

export const workspaceDirectoryPicker = {
  async pickDirectory(title: string) {
    const selected = await open({ title, directory: true, multiple: false });
    return typeof selected === "string" ? selected : null;
  },
};
```

- [ ] **Step 5: Implement the native adapter**

`tauriWorkspace.ts` invokes `create_project`, `inspect_project`, and
`remove_created_project` with camelCase arguments, validates menu payloads from
`listen<WorkspaceMenuAction>("workspace://menu", ...)`, and wraps structured
errors while retaining `cause`.

- [ ] **Step 6: Run adapter tests**

Run:

```powershell
pnpm test -- src/infrastructure/workspace
pnpm typecheck
```

Expected: adapter tests pass.

- [ ] **Step 7: Commit adapters**

```powershell
git add src/shared/logging src/infrastructure/workspace
git commit -m "feat: add workspace platform adapters"
```

### Task 6: Build the Project Launcher

**Files:**
- Create: `src/features/workspace/WorkspaceLauncher.tsx`
- Create: `src/features/workspace/WorkspaceLauncher.test.tsx`
- Create: `src/features/workspace/ProjectRail.tsx`
- Create: `src/features/workspace/ProjectCard.tsx`
- Create: `src/features/workspace/NewProjectDialog.tsx`

- [ ] **Step 1: Write failing launcher tests**

Cover:

```tsx
it("shows the three most recent projects and scroll controls", () => {
  render(<WorkspaceLauncher {...props} projects={fourProjects} />);
  expect(screen.getAllByRole("button", { name: /Open project/ })).toHaveLength(4);
  expect(screen.getByRole("region", { name: "Recent projects" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Next projects" })).toBeVisible();
});

it("supports keyboard movement through the project rail", async () => {
  render(<WorkspaceLauncher {...props} projects={fourProjects} />);
  const rail = screen.getByRole("region", { name: "Recent projects" });
  rail.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(props.onRailOffsetChange).toHaveBeenCalledWith(1);
});

it("offers relocate and remove for unavailable projects", () => {
  render(
    <WorkspaceLauncher
      {...props}
      projects={[{ ...fourProjects[0], status: "unavailable" }]}
    />,
  );
  expect(screen.getByRole("button", { name: "Relocate project" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Remove from recent projects" })).toBeVisible();
});

it("submits a trimmed project name from the create dialog", async () => {
  render(<WorkspaceLauncher {...props} projects={[]} />);
  await userEvent.click(screen.getByRole("button", { name: "New project" }));
  await userEvent.type(screen.getByLabelText("Project name"), "  Editorial  ");
  await userEvent.click(screen.getByRole("button", { name: "Create project" }));
  expect(props.onCreate).toHaveBeenCalledWith("Editorial");
});
```

- [ ] **Step 2: Verify launcher tests fail**

Run:

```powershell
pnpm test -- src/features/workspace/WorkspaceLauncher.test.tsx
```

Expected: FAIL because launcher components do not exist.

- [ ] **Step 3: Implement focused components**

Implement `ProjectRail` with a clamped `offset`, three cards per page,
`aria-label="Recent projects"`, `tabIndex={0}`, ArrowLeft/ArrowRight handlers,
wheel delta translation, Previous/Next buttons, and a native horizontal
scrollbar. Use CSS grid classes:

```tsx
<div
  className="grid auto-cols-[calc((100%-2rem)/3)] grid-flow-col gap-4 overflow-x-auto scroll-smooth pb-4"
>
```

Implement `ProjectCard` as an article. Available cards have one
`Open project <name>` button; unavailable cards show the known name and
separate Relocate/Remove buttons. Render `coverDataUrl` only as an image `src`;
otherwise render a deterministic gradient with the project name.

Implement `NewProjectDialog` with `role="dialog"`, labelled input, local value,
Cancel/Create buttons, and no submission for a blank trimmed name.

Implement `WorkspaceLauncher` with:

- Header and native-menu hint.
- Loading and recoverable error states.
- Empty-state New/Open actions.
- ProjectRail for non-empty records.
- Controlled NewProjectDialog.

- [ ] **Step 4: Run launcher tests and accessibility queries**

Run:

```powershell
pnpm test -- src/features/workspace
pnpm typecheck
pnpm lint
```

Expected: launcher tests and static checks pass.

- [ ] **Step 5: Commit launcher UI**

```powershell
git add src/features/workspace
git commit -m "feat: add recent project launcher"
```

### Task 7: Compose Workspace State and Native File Menu

**Files:**
- Create: `src/app/workspace/WorkspaceProvider.tsx`
- Create: `src/app/workspace/WorkspaceProvider.test.tsx`
- Create: `src/app/workspace/dependencies.ts`
- Create: `src/infrastructure/workspace/browserWorkspace.ts`
- Create: `src-tauri/src/menu.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Write failing provider integration tests**

Test:

```tsx
it("loads the launcher and opens an available project", async () => {
  service.loadProjects.mockResolvedValue([project]);
  render(<WorkspaceProvider dependencies={dependencies} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Open project Editorial" }),
  );
  expect(screen.getByText("Editorial")).toBeVisible();
  expect(screen.getByText("Start your photography plan")).toBeVisible();
});

it("uses the same open flow for a native menu event", async () => {
  directoryPicker.pickDirectory.mockResolvedValue("C:\\shoot");
  service.openProject.mockResolvedValue(project);
  native.onMenuAction.mockImplementation(async (handler) => {
    handler("open-project");
    return vi.fn();
  });
  render(<WorkspaceProvider dependencies={dependencies} />);
  expect(await screen.findByText("Editorial")).toBeVisible();
});

it("keeps the launcher usable after a recoverable error", async () => {
  service.loadProjects.mockRejectedValue(new Error("metadata corrupt"));
  render(<WorkspaceProvider dependencies={dependencies} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("metadata corrupt");
  expect(screen.getByRole("button", { name: "Open project" })).toBeEnabled();
});
```

- [ ] **Step 2: Verify provider tests fail**

Run:

```powershell
pnpm test -- src/app/workspace
```

Expected: FAIL because the provider does not exist.

- [ ] **Step 3: Implement dependency composition**

`dependencies.ts` exports a `WorkspaceDependencies` interface and
`createWorkspaceDependencies()`. It selects `browserWorkspaceDependencies`
only when `import.meta.env.VITE_WORKSPACE_ADAPTER === "memory"`; otherwise it
constructs Tauri Store/Dialog/native adapters, the ISO clock, structured
logger, and `createWorkspaceService`.

`browserWorkspace.ts` implements deterministic E2E-only ports with one seeded
available project named `Editorial Demo`; it does not run in production builds.

- [ ] **Step 4: Implement WorkspaceProvider**

The provider owns:

```ts
type AppView =
  | { kind: "launcher" }
  | { kind: "project"; project: WorkspaceProjectRecord };
```

On mount, load projects and register one menu listener; unlisten on cleanup.
New/Open/Relocate select directories through the picker and call the same
service methods used by UI buttons. Keep recoverable errors in an alert without
throwing to ErrorBoundary. Opening a launcher card updates `lastOpenedAt` by
calling `service.openProject(project.path)` before switching views.

- [ ] **Step 5: Implement native File menu**

Create `src-tauri/src/menu.rs` using `MenuBuilder` and `SubmenuBuilder`:

```rust
pub const MENU_EVENT: &str = "workspace://menu";

pub fn install(app: &tauri::AppHandle) -> tauri::Result<()> {
    let file = tauri::menu::SubmenuBuilder::new(app, "File")
        .text("workspace_new", "New Project")
        .text("workspace_open", "Open Project")
        .separator()
        .text("workspace_new_window", "Open New Window")
        .separator()
        .text("workspace_close", "Close")
        .build()?;
    let menu = tauri::menu::MenuBuilder::new(app).item(&file).build()?;
    app.set_menu(menu)?;
    Ok(())
}
```

Register `app.on_menu_event` in `lib.rs`. For New/Open, emit `"new-project"` or
`"open-project"` to the focused webview window. For Close, close the focused
window. For Open New Window, create a unique `workspace-<uuid>` label with
`WebviewWindowBuilder`, title `Preshot`, 1280x800 size, 960x640 minimum, and the
app index URL.

Initialize:

```rust
.plugin(tauri_plugin_dialog::init())
.plugin(tauri_plugin_store::Builder::default().build())
.setup(|app| {
    menu::install(app.handle())?;
    menu::register_handlers(app.handle().clone());
    Ok(())
})
```

- [ ] **Step 6: Wire App to the provider**

Replace `App` with:

```tsx
import { WorkspaceProvider } from "./workspace/WorkspaceProvider";
import { createWorkspaceDependencies } from "./workspace/dependencies";

const dependencies = createWorkspaceDependencies();

export function App() {
  return <WorkspaceProvider dependencies={dependencies} />;
}
```

Update `App.test.tsx` to inject deterministic dependencies rather than invoking
Tauri APIs.

- [ ] **Step 7: Run provider, frontend, and Rust tests**

Run:

```powershell
pnpm test -- src/app src/features/workspace src/infrastructure/workspace
pnpm typecheck
pnpm lint
cargo test --manifest-path src-tauri\Cargo.toml
```

Expected: all commands pass.

- [ ] **Step 8: Commit application composition**

```powershell
git add src src-tauri
git commit -m "feat: integrate workspace launcher and native menu"
```

### Task 8: Add Browser Flow, Documentation, and Completion Tracking

**Files:**
- Create: `.env.e2e`
- Create: `e2e/workspace.spec.ts`
- Delete: `e2e/app.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/TESTING.md`
- Modify: `docs/RELIABILITY.md`
- Modify: `docs/design_docs/featurelist.json`

- [ ] **Step 1: Select the explicit E2E adapter**

Create `.env.e2e`:

```dotenv
VITE_WORKSPACE_ADAPTER=memory
```

Change Playwright `webServer.command` to:

```ts
command: "pnpm dev --mode e2e --host 127.0.0.1",
```

- [ ] **Step 2: Write the browser flow**

Create `e2e/workspace.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("opens a recent project from the launcher", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Recent projects" }),
  ).toBeVisible();
  await page.getByRole("button", {
    name: "Open project Editorial Demo",
  }).click();
  await expect(page.getByText("Editorial Demo")).toBeVisible();
  await expect(page.getByText("Start your photography plan")).toBeVisible();
});
```

Delete the superseded shell-only `e2e/app.spec.ts`.

- [ ] **Step 3: Update architecture, testing, and reliability docs**

Document:

- AppData `workspace.json` ownership and versioning.
- `.preshot` manifest ownership and project portability.
- Store/Dialog/native command boundaries.
- Native menu event flow.
- Domain, adapter, Rust temporary-directory, component, and E2E coverage.
- Structured workspace logging for registry reads/writes, project
  create/open/relocate/remove, unavailable validation, rollback, commands, and
  menu mutations.

Do not modify unrelated reliability service examples.

- [ ] **Step 4: Run the complete verification matrix**

Run:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:init
pnpm test:e2e
cargo fmt --manifest-path src-tauri\Cargo.toml --check
cargo test --manifest-path src-tauri\Cargo.toml
pnpm build
pnpm tauri:build
```

Expected: every command exits with code 0 and MSI/NSIS bundles are produced.

- [ ] **Step 5: Mark the feature completed**

Only after Step 4 succeeds, change:

```json
"status": "completed"
```

Keep all approved decisions intact.

- [ ] **Step 6: Verify repository hygiene**

Run:

```powershell
git --no-pager diff --check
git status --short
(Get-Content .\AGENTS.md).Count
```

Expected: only intentional feature changes remain and `AGENTS.md` is at most
200 lines.

- [ ] **Step 7: Commit completion**

```powershell
git add .env.e2e e2e playwright.config.ts docs src tests package.json `
  pnpm-lock.yaml src-tauri
git commit -m "docs: complete workspace setup feature"
```
