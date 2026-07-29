# Basic Plan Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Plan section to opened projects with a fully working Reference Images gallery (grouped, per-row square thumbnails, `+` import, click-to-expand) and a placeholder Photography Plan tab.

**Architecture:** Reuse the Workspace layering — pure TypeScript domain (`src/domain/plan`), Tauri + in-memory adapters (`src/infrastructure/plan`), feature UI (`src/features/plan`), and narrow Rust commands. Plan data persists inside the versioned `.preshot` manifest; reference image files live under a `references/` subfolder, moved in and renumbered.

**Tech Stack:** React 19 + TypeScript, Vitest + Testing Library, Tailwind, Tauri 2 (Rust), Playwright.

## Global Constraints

- Use pnpm; never add npm/Yarn lock files.
- TDD: write a failing test, watch it fail, implement minimally, watch it pass, commit.
- `domain` must not import React, Tauri, or browser APIs. `@tauri-apps/api` only in `src/infrastructure`.
- Co-locate Vitest files as `*.test.ts(x)`; Rust unit tests beside native logic.
- Manifest stays `schemaVersion: 1`; `plan` is an optional field (like `coverImage`).
- Reference images: only `jpg`/`jpeg`/`png`, single file ≤ 16 MB (`MAX_COVER_BYTES`).
- Imported files are **moved** (source removed): same-volume rename, cross-volume copy+delete.
- Reference files are stored as `references/NNNN.ext` (4-digit zero-padded, next = max existing numeric stem + 1).
- `columnsPerRow` is an integer clamped to `1..=6`; new groups default to `3`.
- Structured logs mirror workspace: JSON via `createLogger("plan-service")`.
- Windows paths use backslashes. Rust env for cargo: add `%USERPROFILE%\.cargo\bin` to PATH and `call` VS 18 `vcvars64.bat` in the same cmd.
- Verification matrix before completion: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:init`, `pnpm test:e2e`, `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo test --manifest-path src-tauri\Cargo.toml`, `pnpm build`, `pnpm tauri:build`.

## File Structure

- `src/domain/plan/models.ts` — `ProjectPlan`, `ReferenceGroup`, `ReferenceImage`, `ImportedImage`, `EMPTY_PLAN`, `MIN_COLUMNS`/`MAX_COLUMNS`/`DEFAULT_COLUMNS`.
- `src/domain/plan/plan.ts` — pure reducers: `createGroup`, `addGroup`, `renameGroup`, `deleteGroup`, `setColumns`, `addImage`, `removeImage`, `clampColumns`, `findGroup`.
- `src/domain/plan/ports.ts` — `PlanRepository`, `ReferenceImageStore`, `PlanImagePicker`.
- `src/domain/plan/service.ts` — `createPlanService` (serialized use cases).
- `src/shared/logging/logger.ts` — refactor to `createLogger(service)`; export `workspaceLogger` + `planLogger`.
- `src-tauri/src/workspace.rs` — extend `ProjectManifest` with `plan`; add plan structs; `read_manifest`/`write_manifest_atomically` become `pub(crate)`; small path helpers `pub(crate)`.
- `src-tauri/src/plan.rs` — commands `save_project_plan`, `read_project_plan`, `import_reference_image`, `load_reference_image`, `remove_reference_image` + tests.
- `src-tauri/src/lib.rs` — register the new commands and `mod plan`.
- `src/infrastructure/plan/tauriPlan.ts` — `createTauriPlan` implementing `PlanRepository` + `ReferenceImageStore`.
- `src/infrastructure/plan/planDialog.ts` — `PlanImagePicker` (Tauri Dialog file picker, jpg/png filter).
- `src/infrastructure/plan/browserPlan.ts` — in-memory adapter for E2E.
- `src/features/plan/ReferenceImageLightbox.tsx` — full-image modal.
- `src/features/plan/ReferenceImagesTab.tsx` — groups, grid, `+` import, remove, columns.
- `src/features/plan/PhotographyPlanTab.tsx` — placeholder.
- `src/features/plan/PlanPanel.tsx` — tab switcher.
- `src/features/plan/ProjectPlanProvider.tsx` — state + orchestration for one opened project.
- `src/app/plan/planDependencies.ts` — production vs memory dependency composition (fail closed in PROD).
- `src/app/layout/Workspace.tsx` — render Plan as the primary section.
- `src/app/layout/AppShell.tsx` — mark Plan the active nav item.
- `e2e/plan.spec.ts` — browser smoke for the gallery + lightbox.

---

### Task 1: Plan domain models and pure reducers

**Files:**
- Create: `src/domain/plan/models.ts`
- Create: `src/domain/plan/plan.ts`
- Test: `src/domain/plan/plan.test.ts`

**Interfaces:**
- Produces: `ProjectPlan { referenceGroups: ReferenceGroup[] }`, `ReferenceGroup { id: string; title: string; columnsPerRow: number; images: ReferenceImage[] }`, `ReferenceImage { id: string; file: string }`, `ImportedImage { file: string; dataUrl: string }`, `EMPTY_PLAN`, `MIN_COLUMNS=1`, `MAX_COLUMNS=6`, `DEFAULT_COLUMNS=3`. Pure fns `clampColumns`, `createGroup`, `findGroup`, `addGroup`, `renameGroup`, `deleteGroup`, `setColumns`, `addImage`, `removeImage` (all return new `ProjectPlan`, never mutate).

- [ ] **Step 1: Write `models.ts`**

```ts
export interface ReferenceImage {
  id: string;
  file: string;
}

export interface ReferenceGroup {
  id: string;
  title: string;
  columnsPerRow: number;
  images: ReferenceImage[];
}

export interface ProjectPlan {
  referenceGroups: ReferenceGroup[];
}

export interface ImportedImage {
  file: string;
  dataUrl: string;
}

export const MIN_COLUMNS = 1;
export const MAX_COLUMNS = 6;
export const DEFAULT_COLUMNS = 3;

export const EMPTY_PLAN: ProjectPlan = {
  referenceGroups: [],
};
```

- [ ] **Step 2: Write the failing test `plan.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { EMPTY_PLAN, MAX_COLUMNS, MIN_COLUMNS } from "./models";
import {
  addGroup,
  addImage,
  clampColumns,
  createGroup,
  deleteGroup,
  removeImage,
  renameGroup,
  setColumns,
} from "./plan";

describe("plan reducers", () => {
  it("clamps columns to the 1..6 range and rounds", () => {
    expect(clampColumns(0)).toBe(MIN_COLUMNS);
    expect(clampColumns(99)).toBe(MAX_COLUMNS);
    expect(clampColumns(2.6)).toBe(3);
    expect(clampColumns(Number.NaN)).toBe(MIN_COLUMNS);
  });

  it("creates a clamped, empty group and appends without mutating", () => {
    const group = createGroup("g1", "Lookbook", 3);
    const next = addGroup(EMPTY_PLAN, group);

    expect(group.images).toEqual([]);
    expect(next.referenceGroups).toEqual([group]);
    expect(EMPTY_PLAN.referenceGroups).toEqual([]);
  });

  it("renames, sets clamped columns, and deletes a group", () => {
    const base = addGroup(EMPTY_PLAN, createGroup("g1", "Old", 3));

    expect(renameGroup(base, "g1", "New").referenceGroups[0].title).toBe("New");
    expect(setColumns(base, "g1", 42).referenceGroups[0].columnsPerRow).toBe(MAX_COLUMNS);
    expect(deleteGroup(base, "g1").referenceGroups).toEqual([]);
  });

  it("adds and removes images within a group", () => {
    const base = addGroup(EMPTY_PLAN, createGroup("g1", "Lookbook", 3));
    const withImage = addImage(base, "g1", { id: "i1", file: "references/0001.jpg" });

    expect(withImage.referenceGroups[0].images).toEqual([
      { id: "i1", file: "references/0001.jpg" },
    ]);
    expect(removeImage(withImage, "g1", "i1").referenceGroups[0].images).toEqual([]);
    expect(base.referenceGroups[0].images).toEqual([]);
  });
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `pnpm exec vitest run src/domain/plan/plan.test.ts`
Expected: FAIL (module `./plan` not found).

- [ ] **Step 4: Write `plan.ts`**

```ts
import {
  DEFAULT_COLUMNS,
  MAX_COLUMNS,
  MIN_COLUMNS,
  type ProjectPlan,
  type ReferenceGroup,
  type ReferenceImage,
} from "./models";

export function clampColumns(columns: number): number {
  if (!Number.isFinite(columns)) {
    return MIN_COLUMNS;
  }
  return Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, Math.round(columns)));
}

export function createGroup(
  id: string,
  title: string,
  columnsPerRow: number = DEFAULT_COLUMNS,
): ReferenceGroup {
  return { id, title, columnsPerRow: clampColumns(columnsPerRow), images: [] };
}

export function findGroup(
  plan: ProjectPlan,
  groupId: string,
): ReferenceGroup | undefined {
  return plan.referenceGroups.find((group) => group.id === groupId);
}

export function addGroup(plan: ProjectPlan, group: ReferenceGroup): ProjectPlan {
  return {
    referenceGroups: [
      ...plan.referenceGroups,
      { ...group, columnsPerRow: clampColumns(group.columnsPerRow) },
    ],
  };
}

export function renameGroup(
  plan: ProjectPlan,
  groupId: string,
  title: string,
): ProjectPlan {
  return {
    referenceGroups: plan.referenceGroups.map((group) =>
      group.id === groupId ? { ...group, title } : group,
    ),
  };
}

export function deleteGroup(plan: ProjectPlan, groupId: string): ProjectPlan {
  return {
    referenceGroups: plan.referenceGroups.filter((group) => group.id !== groupId),
  };
}

export function setColumns(
  plan: ProjectPlan,
  groupId: string,
  columns: number,
): ProjectPlan {
  return {
    referenceGroups: plan.referenceGroups.map((group) =>
      group.id === groupId
        ? { ...group, columnsPerRow: clampColumns(columns) }
        : group,
    ),
  };
}

export function addImage(
  plan: ProjectPlan,
  groupId: string,
  image: ReferenceImage,
): ProjectPlan {
  return {
    referenceGroups: plan.referenceGroups.map((group) =>
      group.id === groupId
        ? { ...group, images: [...group.images, image] }
        : group,
    ),
  };
}

export function removeImage(
  plan: ProjectPlan,
  groupId: string,
  imageId: string,
): ProjectPlan {
  return {
    referenceGroups: plan.referenceGroups.map((group) =>
      group.id === groupId
        ? { ...group, images: group.images.filter((image) => image.id !== imageId) }
        : group,
    ),
  };
}
```

- [ ] **Step 5: Run and watch it pass**

Run: `pnpm exec vitest run src/domain/plan/plan.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```powershell
git add src/domain/plan/models.ts src/domain/plan/plan.ts src/domain/plan/plan.test.ts
git commit -m "feat: add plan domain models and reducers"
```

### Task 2: Plan ports and serialized PlanService

**Files:**
- Create: `src/domain/plan/ports.ts`
- Create: `src/domain/plan/service.ts`
- Test: `src/domain/plan/service.test.ts`

**Interfaces:**
- Consumes: reducers from Task 1; `WorkspaceLogger` from `src/domain/workspace/ports`.
- Produces: `PlanRepository { loadPlan(projectPath): Promise<ProjectPlan>; savePlan(projectPath, plan): Promise<void> }`, `ReferenceImageStore { importImage(projectPath, sourcePath): Promise<ImportedImage>; loadImage(projectPath, file): Promise<string>; removeImage(projectPath, file): Promise<void> }`, `PlanImagePicker { pickImageFile(title): Promise<string | null> }`. `createPlanService({ repository, imageStore, createId, logger })` returning `PlanService` with `loadPlan`, `loadImage`, `addGroup`, `renameGroup`, `deleteGroup`, `setColumns`, `importImage` (→ `{ plan, image, dataUrl }`), `removeImage`. Mutations are serialized through an internal queue and persist through `savePlan`.

- [ ] **Step 1: Write `ports.ts`**

```ts
import type { ImportedImage, ProjectPlan } from "./models";

export interface PlanRepository {
  loadPlan(projectPath: string): Promise<ProjectPlan>;
  savePlan(projectPath: string, plan: ProjectPlan): Promise<void>;
}

export interface ReferenceImageStore {
  importImage(projectPath: string, sourcePath: string): Promise<ImportedImage>;
  loadImage(projectPath: string, file: string): Promise<string>;
  removeImage(projectPath: string, file: string): Promise<void>;
}

export interface PlanImagePicker {
  pickImageFile(title: string): Promise<string | null>;
}
```

- [ ] **Step 2: Write the failing test `service.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceLogger } from "../workspace/ports";
import { EMPTY_PLAN } from "./models";
import { addGroup, createGroup } from "./plan";
import type { PlanRepository, ReferenceImageStore } from "./ports";
import { createPlanService } from "./service";

function logger(): WorkspaceLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function deps() {
  const repository: PlanRepository = {
    loadPlan: vi.fn().mockResolvedValue(EMPTY_PLAN),
    savePlan: vi.fn().mockResolvedValue(undefined),
  };
  const imageStore: ReferenceImageStore = {
    importImage: vi.fn().mockResolvedValue({ file: "references/0001.jpg", dataUrl: "data:image/jpeg;base64,AA" }),
    loadImage: vi.fn().mockResolvedValue("data:image/png;base64,BB"),
    removeImage: vi.fn().mockResolvedValue(undefined),
  };
  let counter = 0;
  const createId = () => `id-${(counter += 1)}`;
  return { repository, imageStore, createId, logger: logger() };
}

describe("createPlanService", () => {
  it("adds a group, persists it, and returns the next plan", async () => {
    const d = deps();
    const service = createPlanService(d);

    const next = await service.addGroup("C:\\p", EMPTY_PLAN, "Lookbook");

    expect(next.referenceGroups).toHaveLength(1);
    expect(next.referenceGroups[0]).toMatchObject({ id: "id-1", title: "Lookbook", columnsPerRow: 3 });
    expect(d.repository.savePlan).toHaveBeenCalledWith("C:\\p", next);
  });

  it("imports an image into a group, persists, and returns its data URL", async () => {
    const d = deps();
    const service = createPlanService(d);
    const base = addGroup(EMPTY_PLAN, createGroup("g1", "Lookbook", 3));

    const result = await service.importImage("C:\\p", base, "g1", "C:\\src\\a.jpg");

    expect(d.imageStore.importImage).toHaveBeenCalledWith("C:\\p", "C:\\src\\a.jpg");
    expect(result.image).toEqual({ id: "id-1", file: "references/0001.jpg" });
    expect(result.dataUrl).toBe("data:image/jpeg;base64,AA");
    expect(result.plan.referenceGroups[0].images).toEqual([{ id: "id-1", file: "references/0001.jpg" }]);
    expect(d.repository.savePlan).toHaveBeenCalledWith("C:\\p", result.plan);
  });

  it("removes an image: persists the new plan before deleting the file", async () => {
    const d = deps();
    const order: string[] = [];
    vi.mocked(d.repository.savePlan).mockImplementation(async () => { order.push("save"); });
    vi.mocked(d.imageStore.removeImage).mockImplementation(async () => { order.push("delete"); });
    const service = createPlanService(d);
    const base = { referenceGroups: [{ id: "g1", title: "L", columnsPerRow: 3, images: [{ id: "i1", file: "references/0001.jpg" }] }] };

    const next = await service.removeImage("C:\\p", base, "g1", "i1");

    expect(next.referenceGroups[0].images).toEqual([]);
    expect(d.imageStore.removeImage).toHaveBeenCalledWith("C:\\p", "references/0001.jpg");
    expect(order).toEqual(["save", "delete"]);
  });

  it("wraps repository failures with operation context", async () => {
    const d = deps();
    vi.mocked(d.repository.savePlan).mockRejectedValueOnce(new Error("disk full"));
    const service = createPlanService(d);

    await expect(service.addGroup("C:\\p", EMPTY_PLAN, "L")).rejects.toThrow(
      /Unable to save the project plan: disk full/,
    );
  });
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `pnpm exec vitest run src/domain/plan/service.test.ts`
Expected: FAIL (module `./service` not found).

- [ ] **Step 4: Write `service.ts`**

```ts
import { DEFAULT_COLUMNS, type ProjectPlan, type ReferenceImage } from "./models";
import {
  addGroup as addGroupToPlan,
  addImage as addImageToPlan,
  createGroup,
  deleteGroup as deleteGroupFromPlan,
  findGroup,
  removeImage as removeImageFromPlan,
  renameGroup as renameGroupInPlan,
  setColumns as setColumnsInPlan,
} from "./plan";
import type { PlanRepository, ReferenceImageStore } from "./ports";
import type { WorkspaceLogger } from "../workspace/ports";

interface Dependencies {
  repository: PlanRepository;
  imageStore: ReferenceImageStore;
  createId: () => string;
  logger: WorkspaceLogger;
}

export interface ImportImageResult {
  plan: ProjectPlan;
  image: ReferenceImage;
  dataUrl: string;
}

export interface PlanService {
  loadPlan(projectPath: string): Promise<ProjectPlan>;
  loadImage(projectPath: string, file: string): Promise<string>;
  addGroup(projectPath: string, plan: ProjectPlan, title: string): Promise<ProjectPlan>;
  renameGroup(projectPath: string, plan: ProjectPlan, groupId: string, title: string): Promise<ProjectPlan>;
  deleteGroup(projectPath: string, plan: ProjectPlan, groupId: string): Promise<ProjectPlan>;
  setColumns(projectPath: string, plan: ProjectPlan, groupId: string, columns: number): Promise<ProjectPlan>;
  importImage(projectPath: string, plan: ProjectPlan, groupId: string, sourcePath: string): Promise<ImportImageResult>;
  removeImage(projectPath: string, plan: ProjectPlan, groupId: string, imageId: string): Promise<ProjectPlan>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function contextualError(context: string, error: unknown): Error {
  return new Error(`${context}: ${message(error)}`, { cause: error });
}

export function createPlanService({
  repository,
  imageStore,
  createId,
  logger,
}: Dependencies): PlanService {
  let queue: Promise<void> = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = queue.then(operation, operation);
    queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async function persist(projectPath: string, plan: ProjectPlan): Promise<void> {
    try {
      await repository.savePlan(projectPath, plan);
    } catch (error) {
      throw contextualError("Unable to save the project plan", error);
    }
  }

  return {
    loadPlan(projectPath) {
      return enqueue(async () => {
        try {
          return await repository.loadPlan(projectPath);
        } catch (error) {
          throw contextualError("Unable to load the project plan", error);
        }
      });
    },
    async loadImage(projectPath, file) {
      try {
        return await imageStore.loadImage(projectPath, file);
      } catch (error) {
        throw contextualError("Unable to load a reference image", error);
      }
    },
    addGroup(projectPath, plan, title) {
      return enqueue(async () => {
        const next = addGroupToPlan(plan, createGroup(createId(), title, DEFAULT_COLUMNS));
        await persist(projectPath, next);
        logger.info("Reference group added", { groups: next.referenceGroups.length });
        return next;
      });
    },
    renameGroup(projectPath, plan, groupId, title) {
      return enqueue(async () => {
        const next = renameGroupInPlan(plan, groupId, title);
        await persist(projectPath, next);
        return next;
      });
    },
    deleteGroup(projectPath, plan, groupId) {
      return enqueue(async () => {
        const group = findGroup(plan, groupId);
        const next = deleteGroupFromPlan(plan, groupId);
        await persist(projectPath, next);
        for (const image of group?.images ?? []) {
          try {
            await imageStore.removeImage(projectPath, image.file);
          } catch (error) {
            logger.warn("Unable to delete a reference image file", { file: image.file, reason: message(error) });
          }
        }
        logger.info("Reference group deleted", { groupId });
        return next;
      });
    },
    setColumns(projectPath, plan, groupId, columns) {
      return enqueue(async () => {
        const next = setColumnsInPlan(plan, groupId, columns);
        await persist(projectPath, next);
        return next;
      });
    },
    importImage(projectPath, plan, groupId, sourcePath) {
      return enqueue(async () => {
        let imported;
        try {
          imported = await imageStore.importImage(projectPath, sourcePath);
        } catch (error) {
          throw contextualError("Unable to import the reference image", error);
        }
        const image: ReferenceImage = { id: createId(), file: imported.file };
        const next = addImageToPlan(plan, groupId, image);
        await persist(projectPath, next);
        logger.info("Reference image imported", { groupId, file: image.file });
        return { plan: next, image, dataUrl: imported.dataUrl };
      });
    },
    removeImage(projectPath, plan, groupId, imageId) {
      return enqueue(async () => {
        const target = findGroup(plan, groupId)?.images.find((image) => image.id === imageId);
        const next = removeImageFromPlan(plan, groupId, imageId);
        await persist(projectPath, next);
        if (target) {
          try {
            await imageStore.removeImage(projectPath, target.file);
          } catch (error) {
            logger.warn("Unable to delete a reference image file", { file: target.file, reason: message(error) });
          }
        }
        logger.info("Reference image removed", { groupId, imageId });
        return next;
      });
    },
  };
}
```

- [ ] **Step 5: Run and watch it pass**

Run: `pnpm exec vitest run src/domain/plan/service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```powershell
git add src/domain/plan/ports.ts src/domain/plan/service.ts src/domain/plan/service.test.ts
git commit -m "feat: add serialized plan service"
```

### Task 3: Parameterize the structured logger

**Files:**
- Modify: `src/shared/logging/logger.ts`
- Test: `src/shared/logging/logger.test.ts` (add one case)

**Interfaces:**
- Produces: `createLogger(service: string): WorkspaceLogger`, plus existing `workspaceLogger` and new `planLogger` (service name `"plan-service"`).

- [ ] **Step 1: Add a failing test to `logger.test.ts`** (append inside the file, after the existing `describe`)

```ts
import { planLogger } from "./logger";

describe("planLogger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T10:00:00.000Z"));
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("tags entries with the plan-service name", () => {
    planLogger.info("Plan event", { groupId: "g1" });
    const [entry] = (console.info as ReturnType<typeof vi.spyOn>).mock.calls[0] ?? [];
    expect(JSON.parse(String(entry))).toMatchObject({
      service: "plan-service",
      message: "Plan event",
      data: { groupId: "g1" },
    });
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm exec vitest run src/shared/logging/logger.test.ts`
Expected: FAIL (`planLogger` is not exported).

- [ ] **Step 3: Refactor `logger.ts`** — change `write` to take `service`, and replace the export block

Replace the `function write(level: LogLevel, ...)` signature and body's `service` line, then the final `export const workspaceLogger` block:

```ts
function write(
  service: string,
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>,
) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service,
    message,
    data: sanitizeData(data),
  });

  switch (level) {
    case "DEBUG":
      console.debug(entry);
      break;
    case "INFO":
      console.info(entry);
      break;
    case "WARN":
      console.warn(entry);
      break;
    case "ERROR":
      console.error(entry);
      break;
  }
}

export function createLogger(service: string): WorkspaceLogger {
  return {
    debug(message, data) {
      write(service, "DEBUG", message, data);
    },
    info(message, data) {
      write(service, "INFO", message, data);
    },
    warn(message, data) {
      write(service, "WARN", message, data);
    },
    error(message, data) {
      write(service, "ERROR", message, data);
    },
  };
}

export const workspaceLogger: WorkspaceLogger = createLogger("workspace-service");

export const planLogger: WorkspaceLogger = createLogger("plan-service");
```

- [ ] **Step 4: Run and watch both suites pass**

Run: `pnpm exec vitest run src/shared/logging/logger.test.ts`
Expected: PASS (existing workspace cases + new plan case).

- [ ] **Step 5: Commit**

```powershell
git add src/shared/logging/logger.ts src/shared/logging/logger.test.ts
git commit -m "refactor: parameterize logger service name and add plan logger"
```

### Task 4: Extend the Rust manifest with plan data

**Files:**
- Modify: `src-tauri/src/workspace.rs`
- Test: `src-tauri/src/workspace.rs` (new `#[test]` in the existing `mod tests`)

**Interfaces:**
- Produces (Rust, `pub` in `workspace`): `ProjectPlan { reference_groups: Vec<ReferenceGroup> }`, `ReferenceGroup { id, title, columns_per_row: u32, images: Vec<ReferenceImage> }`, `ReferenceImage { id, file }`, all `serde(rename_all = "camelCase")`. `ProjectManifest` gains `plan: Option<ProjectPlan>` (`#[serde(default, skip_serializing_if = "Option::is_none")]`). `read_manifest(project_path: &Path) -> Result<ProjectManifest, CommandError>` and `write_manifest_atomically` become `pub(crate)`.

- [ ] **Step 1: Add the plan structs** (in `workspace.rs`, after the `ProjectManifest` struct)

```rust
#[derive(Debug, Clone, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceImage {
    pub id: String,
    pub file: String,
}

#[derive(Debug, Clone, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceGroup {
    pub id: String,
    pub title: String,
    pub columns_per_row: u32,
    #[serde(default)]
    pub images: Vec<ReferenceImage>,
}

#[derive(Debug, Clone, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPlan {
    #[serde(default)]
    pub reference_groups: Vec<ReferenceGroup>,
}
```

- [ ] **Step 2: Add `plan` to `ProjectManifest`** — inside the struct, after `cover_image`:

```rust
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<ProjectPlan>,
```

- [ ] **Step 3: Set `plan: None` in the manifest literal** in `create_project_in_with_manifest_writer` (the `let manifest = ProjectManifest { ... }` block):

```rust
        cover_image: None,
        plan: None,
    };
```

- [ ] **Step 4: Extract `read_manifest` and make writer `pub(crate)`** — in `inspect_project_directory`, replace the inline manifest read with a call to a new `pub(crate) fn read_manifest`, and change `fn write_manifest_atomically` to `pub(crate) fn write_manifest_atomically`. Add:

```rust
pub(crate) fn read_manifest(project_path: &Path) -> Result<ProjectManifest, CommandError> {
    let manifest_path = project_path.join(MANIFEST_FILE_NAME);
    let manifest_metadata = fs::metadata(&manifest_path).map_err(|error| match error.kind() {
        ErrorKind::NotFound => {
            CommandError::new("manifest_missing", "Preshot projects must contain a .preshot manifest")
        }
        _ => CommandError::new(
            "manifest_read_failed",
            format!("Unable to access the project manifest: {error}"),
        ),
    })?;
    if !manifest_metadata.is_file() {
        return Err(CommandError::new(
            "manifest_not_file",
            "The .preshot manifest must be a regular file",
        ));
    }
    let manifest_bytes = fs::read(&manifest_path).map_err(|error| {
        CommandError::new(
            "manifest_read_failed",
            format!("Unable to read the project manifest: {error}"),
        )
    })?;
    let manifest: ProjectManifest = serde_json::from_slice(&manifest_bytes).map_err(|error| {
        CommandError::new(
            "manifest_decode_failed",
            format!("Unable to decode the project manifest: {error}"),
        )
    })?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}
```

Then in `inspect_project_directory`, replace its manifest-reading lines with `let manifest = read_manifest(&project_path)?;` (keep the subsequent cover resolution using `&manifest`).

- [ ] **Step 5: Write the failing test** (in `mod tests`)

```rust
    #[test]
    fn inspect_reads_a_plan_from_the_manifest() {
        let project = tempfile::tempdir().unwrap();
        let manifest = concat!(
            "{\"schemaVersion\":1,\"id\":\"3f8d1c2e-0000-4000-8000-000000000001\",",
            "\"name\":\"Planned\",\"createdAt\":\"2026-07-29T00:00:00.000Z\",",
            "\"updatedAt\":\"2026-07-29T00:00:00.000Z\",",
            "\"plan\":{\"referenceGroups\":[{\"id\":\"g1\",\"title\":\"Lookbook\",",
            "\"columnsPerRow\":3,\"images\":[{\"id\":\"i1\",\"file\":\"references/0001.jpg\"}]}]}}"
        );
        fs::write(project.path().join(".preshot"), manifest).unwrap();

        let inspected = inspect_project_directory(project.path()).unwrap();
        let plan = inspected.manifest.plan.unwrap();

        assert_eq!(plan.reference_groups.len(), 1);
        assert_eq!(plan.reference_groups[0].images[0].file, "references/0001.jpg");
    }
```

- [ ] **Step 6: Run and watch it fail, then pass** (set up Rust env once per session)

Run: `& $env:ComSpec /c 'call "C:\Program Files\Microsoft Visual Studio\18\Enterprise\VC\Auxiliary\Build\vcvars64.bat" >nul && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && cd /d C:\projects\Preshot && cargo test --manifest-path src-tauri\Cargo.toml inspect_reads_a_plan'`
Expected: first FAIL (no `plan` field), then PASS after Steps 1-4.

- [ ] **Step 7: Commit**

```powershell
git add src-tauri/src/workspace.rs
git commit -m "feat: add optional plan data to the project manifest"
```

### Task 5: Rust plan commands (save/read plan, import/load/remove reference image)

**Files:**
- Create: `src-tauri/src/plan.rs`
- Modify: `src-tauri/src/workspace.rs` (make `canonicalize_directory` `pub(crate)`)
- Modify: `src-tauri/src/lib.rs` (`mod plan;` + register commands)
- Test: `src-tauri/src/plan.rs` (`mod tests`)

**Interfaces:**
- Consumes: `workspace::{canonicalize_directory, read_manifest, write_manifest_atomically, ProjectManifest, ProjectPlan}`.
- Produces (Tauri commands): `import_reference_image(projectPath, sourcePath) -> ImportedImage { file, dataUrl }`, `load_reference_image(projectPath, file) -> String`, `remove_reference_image(projectPath, file) -> ()`, `save_project_plan(projectPath, plan) -> ProjectManifest`, `read_project_plan(projectPath) -> ProjectPlan`. Stored files are `references/NNNN.ext` (forward slash), jpg/jpeg normalized to `jpg`.

- [ ] **Step 1: Make `canonicalize_directory` reusable** — in `workspace.rs` change `fn canonicalize_directory(` to `pub(crate) fn canonicalize_directory(`.

- [ ] **Step 2: Write `plan.rs`**

```rust
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::{SecondsFormat, Utc};

use crate::error::CommandError;
use crate::workspace::{
    canonicalize_directory, read_manifest, write_manifest_atomically, ProjectManifest, ProjectPlan,
};

const REFERENCES_DIR: &str = "references";
const MAX_REFERENCE_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedImage {
    pub file: String,
    pub data_url: String,
}

fn reference_extension(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => Some("jpg"),
        "png" => Some("png"),
        _ => None,
    }
}

fn mime_for_reference(file_name: &str) -> &'static str {
    if file_name.to_ascii_lowercase().ends_with(".png") {
        "image/png"
    } else {
        "image/jpeg"
    }
}

fn reference_path_error() -> CommandError {
    CommandError::new("reference_invalid_path", "Reference path is not inside references/")
}

fn next_reference_number(references_dir: &Path) -> u32 {
    let mut max = 0u32;
    if let Ok(entries) = fs::read_dir(references_dir) {
        for entry in entries.flatten() {
            if let Some(stem) = entry.path().file_stem().and_then(|stem| stem.to_str()) {
                if let Ok(number) = stem.parse::<u32>() {
                    max = max.max(number);
                }
            }
        }
    }
    max + 1
}

fn resolve_reference_path(project_path: &Path, file: &str) -> Result<PathBuf, CommandError> {
    let relative = Path::new(file);
    if relative.is_absolute() {
        return Err(reference_path_error());
    }
    let mut components = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(segment) => {
                components.push(segment.to_str().ok_or_else(reference_path_error)?.to_string())
            }
            _ => return Err(reference_path_error()),
        }
    }
    if components.len() != 2 || components[0] != REFERENCES_DIR {
        return Err(reference_path_error());
    }
    let absolute = project_path.join(&components[0]).join(&components[1]);
    let canonical = absolute.canonicalize().map_err(|error| {
        CommandError::new("reference_missing", format!("Unable to access the reference image: {error}"))
    })?;
    if !canonical.starts_with(project_path) {
        return Err(reference_path_error());
    }
    Ok(canonical)
}

fn move_file(source: &Path, destination: &Path) -> Result<(), CommandError> {
    if fs::rename(source, destination).is_ok() {
        return Ok(());
    }
    fs::copy(source, destination).map_err(|error| {
        CommandError::new("reference_move_failed", format!("Unable to move the image: {error}"))
    })?;
    let _ = fs::remove_file(source);
    Ok(())
}

pub fn import_reference_image_into(
    project_path: &Path,
    source_path: &Path,
) -> Result<ImportedImage, CommandError> {
    let project_path =
        canonicalize_directory(project_path, "project_not_found", "project_not_directory")?;
    let extension = reference_extension(source_path).ok_or_else(|| {
        CommandError::new("reference_unsupported_type", "Only JPG and PNG images are supported")
    })?;
    let source = source_path.canonicalize().map_err(|error| {
        CommandError::new("reference_source_missing", format!("Unable to access the selected image: {error}"))
    })?;
    let metadata = fs::metadata(&source).map_err(|error| {
        CommandError::new("reference_source_missing", format!("Unable to read the selected image: {error}"))
    })?;
    if !metadata.is_file() {
        return Err(CommandError::new("reference_source_not_file", "The selected path is not a file"));
    }
    if metadata.len() > MAX_REFERENCE_BYTES {
        return Err(CommandError::new("reference_too_large", "The selected image exceeds the 16 MiB limit"));
    }

    let references_dir = project_path.join(REFERENCES_DIR);
    fs::create_dir_all(&references_dir).map_err(|error| {
        CommandError::new("references_dir_failed", format!("Unable to create the references directory: {error}"))
    })?;

    let file_name = format!("{:04}.{extension}", next_reference_number(&references_dir));
    let destination = references_dir.join(&file_name);
    move_file(&source, &destination)?;

    let bytes = fs::read(&destination).map_err(|error| {
        CommandError::new("reference_read_failed", format!("Unable to read the imported image: {error}"))
    })?;
    Ok(ImportedImage {
        file: format!("{REFERENCES_DIR}/{file_name}"),
        data_url: format!("data:{};base64,{}", mime_for_reference(&file_name), STANDARD.encode(bytes)),
    })
}

pub fn load_reference_image_from(project_path: &Path, file: &str) -> Result<String, CommandError> {
    let project_path =
        canonicalize_directory(project_path, "project_not_found", "project_not_directory")?;
    let absolute = resolve_reference_path(&project_path, file)?;
    let metadata = fs::metadata(&absolute).map_err(|error| {
        CommandError::new("reference_missing", format!("Unable to read the reference image: {error}"))
    })?;
    if metadata.len() > MAX_REFERENCE_BYTES {
        return Err(CommandError::new("reference_too_large", "The reference image exceeds the 16 MiB limit"));
    }
    let bytes = fs::read(&absolute).map_err(|error| {
        CommandError::new("reference_read_failed", format!("Unable to read the reference image: {error}"))
    })?;
    let name = absolute.file_name().and_then(|name| name.to_str()).unwrap_or_default();
    Ok(format!("data:{};base64,{}", mime_for_reference(name), STANDARD.encode(bytes)))
}

pub fn remove_reference_image_from(project_path: &Path, file: &str) -> Result<(), CommandError> {
    let project_path =
        canonicalize_directory(project_path, "project_not_found", "project_not_directory")?;
    let absolute = resolve_reference_path(&project_path, file)?;
    fs::remove_file(&absolute).map_err(|error| {
        CommandError::new("reference_remove_failed", format!("Unable to remove the reference image: {error}"))
    })
}

pub fn save_project_plan_in(
    project_path: &Path,
    plan: ProjectPlan,
) -> Result<ProjectManifest, CommandError> {
    let project_path =
        canonicalize_directory(project_path, "project_not_found", "project_not_directory")?;
    let mut manifest = read_manifest(&project_path)?;
    manifest.plan = Some(plan);
    manifest.updated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    write_manifest_atomically(&project_path, &manifest)?;
    Ok(manifest)
}

pub fn read_project_plan_in(project_path: &Path) -> Result<ProjectPlan, CommandError> {
    let project_path =
        canonicalize_directory(project_path, "project_not_found", "project_not_directory")?;
    Ok(read_manifest(&project_path)?
        .plan
        .unwrap_or(ProjectPlan { reference_groups: Vec::new() }))
}

#[tauri::command]
pub fn import_reference_image(
    project_path: String,
    source_path: String,
) -> Result<ImportedImage, CommandError> {
    import_reference_image_into(Path::new(&project_path), Path::new(&source_path))
}

#[tauri::command]
pub fn load_reference_image(project_path: String, file: String) -> Result<String, CommandError> {
    load_reference_image_from(Path::new(&project_path), &file)
}

#[tauri::command]
pub fn remove_reference_image(project_path: String, file: String) -> Result<(), CommandError> {
    remove_reference_image_from(Path::new(&project_path), &file)
}

#[tauri::command]
pub fn save_project_plan(
    project_path: String,
    plan: ProjectPlan,
) -> Result<ProjectManifest, CommandError> {
    save_project_plan_in(Path::new(&project_path), plan)
}

#[tauri::command]
pub fn read_project_plan(project_path: String) -> Result<ProjectPlan, CommandError> {
    read_project_plan_in(Path::new(&project_path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::{ReferenceGroup, ReferenceImage};

    fn project() -> tempfile::TempDir {
        let parent = tempfile::tempdir().unwrap();
        crate::workspace::create_project_in(parent.path(), "Shoot").unwrap();
        parent
    }

    fn write_source(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn import_moves_renumbers_and_returns_a_data_url() {
        let parent = project();
        let project_path = parent.path().join("Shoot");
        let src_dir = tempfile::tempdir().unwrap();
        let source = write_source(src_dir.path(), "photo.PNG", b"png-bytes");

        let imported = import_reference_image_into(&project_path, &source).unwrap();

        assert_eq!(imported.file, "references/0001.png");
        assert!(imported.data_url.starts_with("data:image/png;base64,"));
        assert!(!source.exists(), "source should be moved");
        assert!(project_path.join("references").join("0001.png").exists());
    }

    #[test]
    fn import_rejects_unsupported_types() {
        let parent = project();
        let src_dir = tempfile::tempdir().unwrap();
        let source = write_source(src_dir.path(), "clip.gif", b"gif");

        let error = import_reference_image_into(&parent.path().join("Shoot"), &source).unwrap_err();
        assert_eq!(error.code, "reference_unsupported_type");
    }

    #[test]
    fn load_rejects_paths_outside_references() {
        let parent = project();
        let project_path = parent.path().join("Shoot");
        for bad in ["../.preshot", "references/../.preshot", "C:\\evil.png", "other/0001.png"] {
            assert_eq!(
                load_reference_image_from(&project_path, bad).unwrap_err().code,
                "reference_invalid_path",
                "expected rejection for {bad}"
            );
        }
    }

    #[test]
    fn save_then_read_round_trips_plan_and_bumps_updated_at() {
        let parent = project();
        let project_path = parent.path().join("Shoot");
        let before = read_manifest(&project_path).unwrap().updated_at;
        std::thread::sleep(std::time::Duration::from_millis(2));
        let plan = ProjectPlan {
            reference_groups: vec![ReferenceGroup {
                id: "g1".into(),
                title: "Lookbook".into(),
                columns_per_row: 3,
                images: vec![ReferenceImage { id: "i1".into(), file: "references/0001.png".into() }],
            }],
        };

        let manifest = save_project_plan_in(&project_path, plan.clone()).unwrap();
        assert_eq!(manifest.plan.as_ref().unwrap().reference_groups.len(), 1);
        assert_ne!(manifest.updated_at, before);
        assert_eq!(read_project_plan_in(&project_path).unwrap(), plan);
    }

    #[test]
    fn read_plan_defaults_to_empty_groups() {
        let parent = project();
        assert!(read_project_plan_in(&parent.path().join("Shoot")).unwrap().reference_groups.is_empty());
    }
}
```

- [ ] **Step 3: Register the module and commands in `lib.rs`** — add `mod plan;` after `mod menu;` and extend `invoke_handler`:

```rust
        .invoke_handler(tauri::generate_handler![
            platform_info,
            workspace::create_project,
            workspace::inspect_project,
            workspace::rollback_created_project,
            workspace::forget_created_project,
            plan::save_project_plan,
            plan::read_project_plan,
            plan::import_reference_image,
            plan::load_reference_image,
            plan::remove_reference_image,
        ])
```

- [ ] **Step 4: Run the plan tests, then the whole Rust suite**

Run (VS env): `& $env:ComSpec /c 'call "C:\Program Files\Microsoft Visual Studio\18\Enterprise\VC\Auxiliary\Build\vcvars64.bat" >nul && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && cd /d C:\projects\Preshot && cargo test --manifest-path src-tauri\Cargo.toml'`
Expected: all Rust tests PASS (previous 22 + 5 new plan tests).

- [ ] **Step 5: Format check and commit**

Run: `& $env:ComSpec /c 'set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && cd /d C:\projects\Preshot && cargo fmt --manifest-path src-tauri\Cargo.toml'`

```powershell
git add src-tauri/src/plan.rs src-tauri/src/workspace.rs src-tauri/src/lib.rs
git commit -m "feat: add rust plan and reference image commands"
```

> Note: the `project()` fixture returns the parent `TempDir`, which keeps the whole tree (including `Shoot/`) alive for the test body; always derive the project path with `parent.path().join("Shoot")`.

### Task 6: Tauri plan adapters (repository, image store, image picker)

**Files:**
- Create: `src/infrastructure/plan/tauriPlan.ts`
- Create: `src/infrastructure/plan/planDialog.ts`
- Test: `src/infrastructure/plan/tauriPlan.test.ts`
- Test: `src/infrastructure/plan/planDialog.test.ts`

**Interfaces:**
- Produces: `createTauriPlan({ invokeCommand? })` implementing `PlanRepository & ReferenceImageStore`; `tauriPlan` singleton. `createPlanImagePicker({ openDialog? })` implementing `PlanImagePicker`; `planImagePicker` singleton.

- [ ] **Step 1: Write `tauriPlan.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";
import type { ImportedImage, ProjectPlan, ReferenceGroup } from "../../domain/plan/models";
import type { PlanRepository, ReferenceImageStore } from "../../domain/plan/ports";

type InvokeCommand = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

interface Dependencies {
  invokeCommand?: InvokeCommand;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function detail(error: unknown): string {
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function requireString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Malformed native response");
  }
  return value;
}

function validateGroup(value: unknown): ReferenceGroup {
  if (!isRecord(value) || !Array.isArray(value.images) || typeof value.columnsPerRow !== "number") {
    throw new Error("Malformed native response");
  }
  return {
    id: requireString(value.id),
    title: typeof value.title === "string" ? value.title : "",
    columnsPerRow: value.columnsPerRow,
    images: value.images.map((image) => {
      if (!isRecord(image)) {
        throw new Error("Malformed native response");
      }
      return { id: requireString(image.id), file: requireString(image.file) };
    }),
  };
}

function validatePlan(value: unknown): ProjectPlan {
  if (!isRecord(value) || !Array.isArray(value.referenceGroups)) {
    throw new Error("Malformed native response");
  }
  return { referenceGroups: value.referenceGroups.map(validateGroup) };
}

function validateImported(value: unknown): ImportedImage {
  if (!isRecord(value)) {
    throw new Error("Malformed native response");
  }
  return { file: requireString(value.file), dataUrl: requireString(value.dataUrl) };
}

export function createTauriPlan({ invokeCommand = invoke }: Dependencies = {}): PlanRepository &
  ReferenceImageStore {
  return {
    async loadPlan(projectPath) {
      try {
        return validatePlan(await invokeCommand("read_project_plan", { projectPath }));
      } catch (error) {
        throw new Error(`Unable to read the project plan: ${detail(error)}`, { cause: error });
      }
    },
    async savePlan(projectPath, plan) {
      try {
        await invokeCommand("save_project_plan", { projectPath, plan });
      } catch (error) {
        throw new Error(`Unable to save the project plan: ${detail(error)}`, { cause: error });
      }
    },
    async importImage(projectPath, sourcePath) {
      try {
        return validateImported(
          await invokeCommand("import_reference_image", { projectPath, sourcePath }),
        );
      } catch (error) {
        throw new Error(`Unable to import the reference image: ${detail(error)}`, { cause: error });
      }
    },
    async loadImage(projectPath, file) {
      try {
        return requireString(await invokeCommand("load_reference_image", { projectPath, file }));
      } catch (error) {
        throw new Error(`Unable to load the reference image: ${detail(error)}`, { cause: error });
      }
    },
    async removeImage(projectPath, file) {
      try {
        await invokeCommand("remove_reference_image", { projectPath, file });
      } catch (error) {
        throw new Error(`Unable to remove the reference image: ${detail(error)}`, { cause: error });
      }
    },
  };
}

export const tauriPlan = createTauriPlan();
```

- [ ] **Step 2: Write `planDialog.ts`**

```ts
import { open } from "@tauri-apps/plugin-dialog";
import type { PlanImagePicker } from "../../domain/plan/ports";

type OpenDialog = (options: {
  title: string;
  directory: false;
  multiple: false;
  filters: { name: string; extensions: string[] }[];
}) => Promise<string | string[] | null>;

interface Dependencies {
  openDialog?: OpenDialog;
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createPlanImagePicker({ openDialog = open }: Dependencies = {}): PlanImagePicker {
  return {
    async pickImageFile(title) {
      let selected: string | string[] | null;
      try {
        selected = await openDialog({
          title,
          directory: false,
          multiple: false,
          filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png"] }],
        });
      } catch (error) {
        throw new Error(`Unable to select an image: ${detail(error)}`, { cause: error });
      }
      if (typeof selected === "string") {
        return selected;
      }
      if (selected === null) {
        return null;
      }
      throw new Error("Unable to select an image: Unexpected dialog response");
    },
  };
}

export const planImagePicker = createPlanImagePicker();
```

- [ ] **Step 3: Write failing tests `tauriPlan.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";
import { createTauriPlan } from "./tauriPlan";

describe("createTauriPlan", () => {
  it("imports an image and validates the response", async () => {
    const invokeCommand = vi.fn().mockResolvedValue({ file: "references/0001.jpg", dataUrl: "data:image/jpeg;base64,AA" });
    const plan = createTauriPlan({ invokeCommand });

    const result = await plan.importImage("C:\\p", "C:\\src\\a.jpg");

    expect(invokeCommand).toHaveBeenCalledWith("import_reference_image", { projectPath: "C:\\p", sourcePath: "C:\\src\\a.jpg" });
    expect(result).toEqual({ file: "references/0001.jpg", dataUrl: "data:image/jpeg;base64,AA" });
  });

  it("wraps native failures with operation context", async () => {
    const invokeCommand = vi.fn().mockRejectedValue({ message: "boom" });
    const plan = createTauriPlan({ invokeCommand });

    await expect(plan.savePlan("C:\\p", { referenceGroups: [] })).rejects.toThrow(
      /Unable to save the project plan: boom/,
    );
  });

  it("reads and validates a plan", async () => {
    const invokeCommand = vi.fn().mockResolvedValue({
      referenceGroups: [{ id: "g1", title: "L", columnsPerRow: 3, images: [{ id: "i1", file: "references/0001.jpg" }] }],
    });
    const plan = createTauriPlan({ invokeCommand });

    await expect(plan.loadPlan("C:\\p")).resolves.toEqual({
      referenceGroups: [{ id: "g1", title: "L", columnsPerRow: 3, images: [{ id: "i1", file: "references/0001.jpg" }] }],
    });
  });
});
```

- [ ] **Step 4: Write failing test `planDialog.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";
import { createPlanImagePicker } from "./planDialog";

describe("createPlanImagePicker", () => {
  it("requests a single jpg/png file and returns the path", async () => {
    const openDialog = vi.fn().mockResolvedValue("C:\\src\\a.png");
    const picker = createPlanImagePicker({ openDialog });

    const path = await picker.pickImageFile("Pick");

    expect(openDialog).toHaveBeenCalledWith({
      title: "Pick",
      directory: false,
      multiple: false,
      filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png"] }],
    });
    expect(path).toBe("C:\\src\\a.png");
  });

  it("returns null when cancelled", async () => {
    const picker = createPlanImagePicker({ openDialog: vi.fn().mockResolvedValue(null) });
    await expect(picker.pickImageFile("Pick")).resolves.toBeNull();
  });
});
```

- [ ] **Step 5: Run both suites**

Run: `pnpm exec vitest run src/infrastructure/plan`
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/infrastructure/plan/tauriPlan.ts src/infrastructure/plan/planDialog.ts src/infrastructure/plan/tauriPlan.test.ts src/infrastructure/plan/planDialog.test.ts
git commit -m "feat: add tauri plan adapters"
```

### Task 7: In-memory plan adapter for E2E

**Files:**
- Create: `src/infrastructure/plan/browserPlan.ts`
- Test: `src/infrastructure/plan/browserPlan.test.ts`

**Interfaces:**
- Consumes: `PlanService` from Task 2, `createPlanImagePicker` shape from Task 6.
- Produces: `browserPlanDependencies` = `{ service, picker }` where `service` is a real `createPlanService` wired to an in-memory repository/image store seeded with one group of two tiny data-URL images; `picker` returns a canned source path. Used only when `VITE_WORKSPACE_ADAPTER === "memory"`.

- [ ] **Step 1: Write `browserPlan.ts`**

```ts
import { createPlanService, type PlanService } from "../../domain/plan/service";
import type { ProjectPlan } from "../../domain/plan/models";
import type { PlanImagePicker, PlanRepository, ReferenceImageStore } from "../../domain/plan/ports";
import { planLogger } from "../../shared/logging/logger";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const SEEDED_PLAN: ProjectPlan = {
  referenceGroups: [
    {
      id: "seed-group",
      title: "Lookbook",
      columnsPerRow: 3,
      images: [
        { id: "seed-1", file: "references/0001.png" },
        { id: "seed-2", file: "references/0002.png" },
      ],
    },
  ],
};

function createMemoryStores(): { repository: PlanRepository; imageStore: ReferenceImageStore } {
  let plan: ProjectPlan = structuredClone(SEEDED_PLAN);
  let counter = 2;
  return {
    repository: {
      async loadPlan() {
        return structuredClone(plan);
      },
      async savePlan(_projectPath, nextPlan) {
        plan = structuredClone(nextPlan);
      },
    },
    imageStore: {
      async importImage() {
        counter += 1;
        return { file: `references/${String(counter).padStart(4, "0")}.png`, dataUrl: TINY_PNG };
      },
      async loadImage() {
        return TINY_PNG;
      },
      async removeImage() {
        return undefined;
      },
    },
  };
}

const memoryPicker: PlanImagePicker = {
  async pickImageFile() {
    return "C:\\memory\\import.png";
  },
};

export function createBrowserPlanDependencies(): { service: PlanService; picker: PlanImagePicker } {
  const { repository, imageStore } = createMemoryStores();
  let counter = 0;
  return {
    service: createPlanService({
      repository,
      imageStore,
      createId: () => `memory-${(counter += 1)}`,
      logger: planLogger,
    }),
    picker: memoryPicker,
  };
}

export const browserPlanDependencies = createBrowserPlanDependencies();
```

- [ ] **Step 2: Write failing test `browserPlan.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { createBrowserPlanDependencies } from "./browserPlan";

describe("createBrowserPlanDependencies", () => {
  it("seeds one group of two images and imports deterministically", async () => {
    const { service, picker } = createBrowserPlanDependencies();

    const plan = await service.loadPlan("C:\\demo");
    expect(plan.referenceGroups[0].images).toHaveLength(2);
    expect(await picker.pickImageFile("Pick")).toBe("C:\\memory\\import.png");

    const result = await service.importImage("C:\\demo", plan, "seed-group", "C:\\memory\\import.png");
    expect(result.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(result.plan.referenceGroups[0].images).toHaveLength(3);
  });
});
```

- [ ] **Step 3: Run, then commit**

Run: `pnpm exec vitest run src/infrastructure/plan/browserPlan.test.ts`
Expected: PASS.

```powershell
git add src/infrastructure/plan/browserPlan.ts src/infrastructure/plan/browserPlan.test.ts
git commit -m "feat: add in-memory plan adapter for e2e"
```

### Task 8: Reference image lightbox

**Files:**
- Create: `src/features/plan/ReferenceImageLightbox.tsx`
- Test: `src/features/plan/ReferenceImageLightbox.test.tsx`

**Interfaces:**
- Produces: `ReferenceImageLightbox({ src: string; alt: string; onClose(): void })` — a modal `role="dialog"` closing on Escape, backdrop click, or the Close button.

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReferenceImageLightbox } from "./ReferenceImageLightbox";

describe("ReferenceImageLightbox", () => {
  it("shows the image and closes via button and Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ReferenceImageLightbox src="data:image/png;base64,AA" alt="Reference image 1" onClose={onClose} />);

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("img", { name: "Reference image 1" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Close image" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run and watch it fail** — `pnpm exec vitest run src/features/plan/ReferenceImageLightbox.test.tsx` → FAIL.

- [ ] **Step 3: Write `ReferenceImageLightbox.tsx`**

```tsx
import { useEffect, useRef } from "react";

interface ReferenceImageLightboxProps {
  src: string;
  alt: string;
  onClose(): void;
}

export function ReferenceImageLightbox({ src, alt, onClose }: ReferenceImageLightboxProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6"
      onClick={onClose}
    >
      <div
        aria-label={alt}
        aria-modal="true"
        className="relative"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <img alt={alt} className="max-h-[85vh] max-w-[90vw] object-contain" src={src} />
        <button
          aria-label="Close image"
          className="absolute right-3 top-3 rounded-full bg-black/60 px-3 py-1 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          onClick={onClose}
          ref={closeRef}
          type="button"
        >
          Close
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run and watch it pass; commit**

```powershell
git add src/features/plan/ReferenceImageLightbox.tsx src/features/plan/ReferenceImageLightbox.test.tsx
git commit -m "feat: add reference image lightbox"
```

### Task 9: Reference images tab (groups, grid, import, remove, columns)

**Files:**
- Create: `src/features/plan/ReferenceImagesTab.tsx`
- Test: `src/features/plan/ReferenceImagesTab.test.tsx`

**Interfaces:**
- Consumes: `ReferenceGroup` from `src/domain/plan/models`.
- Produces: `ReferenceImagesTabProps` and `ReferenceImagesTab`. Accessible names within each `role="group"` (named `Reference group: <title>`): buttons `Add reference image`, `Open reference image N`, `Remove reference image N`, `Delete group`; controls `Group title` (textbox), `Images per row` (combobox 1–6). Top-level button `Add reference group`.

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReferenceImagesTab } from "./ReferenceImagesTab";

function handlers() {
  return {
    onAddGroup: vi.fn(),
    onRenameGroup: vi.fn(),
    onDeleteGroup: vi.fn(),
    onSetColumns: vi.fn(),
    onAddImage: vi.fn(),
    onRemoveImage: vi.fn(),
    onOpenImage: vi.fn(),
  };
}

const groups = [
  { id: "g1", title: "Lookbook", columnsPerRow: 3, images: [{ id: "i1", file: "references/0001.png" }] },
];

describe("ReferenceImagesTab", () => {
  it("renders a group with its image and fires import/open callbacks", async () => {
    const user = userEvent.setup();
    const h = handlers();
    render(
      <ReferenceImagesTab
        groups={groups}
        imageSrc={(file) => (file === "references/0001.png" ? "data:image/png;base64,AA" : undefined)}
        {...h}
      />,
    );

    const group = screen.getByRole("group", { name: "Reference group: Lookbook" });
    expect(within(group).getByRole("img", { name: "Reference image 1" })).toBeVisible();

    await user.click(within(group).getByRole("button", { name: "Add reference image" }));
    expect(h.onAddImage).toHaveBeenCalledWith("g1");

    await user.click(within(group).getByRole("button", { name: "Open reference image 1" }));
    expect(h.onOpenImage).toHaveBeenCalledWith("references/0001.png");

    await user.selectOptions(within(group).getByRole("combobox", { name: "Images per row" }), "4");
    expect(h.onSetColumns).toHaveBeenCalledWith("g1", 4);

    await user.click(screen.getByRole("button", { name: "Add reference group" }));
    expect(h.onAddGroup).toHaveBeenCalled();
  });
}
);
```

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Write `ReferenceImagesTab.tsx`**

```tsx
import { MAX_COLUMNS, MIN_COLUMNS, type ReferenceGroup } from "../../domain/plan/models";

export interface ReferenceImagesTabProps {
  groups: ReferenceGroup[];
  imageSrc(file: string): string | undefined;
  onAddGroup(): void;
  onRenameGroup(groupId: string, title: string): void;
  onDeleteGroup(groupId: string): void;
  onSetColumns(groupId: string, columns: number): void;
  onAddImage(groupId: string): void;
  onRemoveImage(groupId: string, imageId: string): void;
  onOpenImage(file: string): void;
}

const columnOptions = Array.from(
  { length: MAX_COLUMNS - MIN_COLUMNS + 1 },
  (_unused, index) => MIN_COLUMNS + index,
);

const squareButton =
  "group relative block aspect-square w-full overflow-hidden rounded-xl border border-black/10 bg-stone-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500";

export function ReferenceImagesTab({
  groups,
  imageSrc,
  onAddGroup,
  onRenameGroup,
  onDeleteGroup,
  onSetColumns,
  onAddImage,
  onRemoveImage,
  onOpenImage,
}: ReferenceImagesTabProps) {
  return (
    <div className="space-y-8 p-6">
      <div className="flex justify-end">
        <button
          className="rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
          onClick={onAddGroup}
          type="button"
        >
          Add reference group
        </button>
      </div>

      {groups.map((group) => (
        <section
          aria-label={`Reference group: ${group.title || "Untitled"}`}
          className="rounded-2xl border border-black/10 bg-white p-5"
          key={group.id}
          role="group"
        >
          <div className="flex flex-wrap items-center gap-3">
            <input
              aria-label="Group title"
              className="flex-1 rounded-lg border border-black/10 px-3 py-2 text-lg font-medium"
              onChange={(event) => onRenameGroup(group.id, event.target.value)}
              value={group.title}
            />
            <label className="flex items-center gap-2 text-sm text-stone-600">
              Images per row
              <select
                aria-label="Images per row"
                className="rounded-lg border border-black/10 px-2 py-1"
                onChange={(event) => onSetColumns(group.id, Number(event.target.value))}
                value={group.columnsPerRow}
              >
                {columnOptions.map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
            <button
              aria-label="Delete group"
              className="rounded-lg border border-black/10 px-3 py-2 text-sm text-stone-600 hover:bg-stone-100"
              onClick={() => onDeleteGroup(group.id)}
              type="button"
            >
              Delete group
            </button>
          </div>

          <div
            className="mt-4 grid gap-3"
            style={{ gridTemplateColumns: `repeat(${group.columnsPerRow}, minmax(0, 1fr))` }}
          >
            {group.images.map((image, index) => {
              const src = imageSrc(image.file);
              return (
                <div className="relative" key={image.id}>
                  <button
                    aria-label={`Open reference image ${index + 1}`}
                    className={squareButton}
                    onClick={() => onOpenImage(image.file)}
                    type="button"
                  >
                    {src ? (
                      <img
                        alt={`Reference image ${index + 1}`}
                        className="h-full w-full object-cover"
                        src={src}
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-xs text-stone-400">
                        Loading…
                      </span>
                    )}
                  </button>
                  <button
                    aria-label={`Remove reference image ${index + 1}`}
                    className="absolute right-1 top-1 rounded-full bg-black/60 px-2 text-xs text-white"
                    onClick={() => onRemoveImage(group.id, image.id)}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              );
            })}

            <button
              aria-label="Add reference image"
              className="flex aspect-square w-full items-center justify-center rounded-xl border-2 border-dashed border-stone-300 text-3xl text-stone-400 hover:border-amber-500 hover:text-amber-600"
              onClick={() => onAddImage(group.id)}
              type="button"
            >
              +
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run and watch it pass; commit**

```powershell
git add src/features/plan/ReferenceImagesTab.tsx src/features/plan/ReferenceImagesTab.test.tsx
git commit -m "feat: add reference images tab"
```

### Task 10: Plan panel and photography placeholder

**Files:**
- Create: `src/features/plan/PhotographyPlanTab.tsx`
- Create: `src/features/plan/PlanPanel.tsx`
- Test: `src/features/plan/PlanPanel.test.tsx`

**Interfaces:**
- Consumes: `ReferenceImagesTabProps` from Task 9.
- Produces: `PlanPanel(props: ReferenceImagesTabProps & { error?: string | null })` with a `role="tablist"` (`Plan tabs`) of `Photography Plan` and `Reference Images` tabs, defaulting to Reference Images. `PhotographyPlanTab()` placeholder.

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlanPanel } from "./PlanPanel";

const noop = {
  onAddGroup: vi.fn(),
  onRenameGroup: vi.fn(),
  onDeleteGroup: vi.fn(),
  onSetColumns: vi.fn(),
  onAddImage: vi.fn(),
  onRemoveImage: vi.fn(),
  onOpenImage: vi.fn(),
};

describe("PlanPanel", () => {
  it("defaults to Reference Images and switches to the Photography placeholder", async () => {
    const user = userEvent.setup();
    render(<PlanPanel groups={[]} imageSrc={() => undefined} {...noop} />);

    expect(screen.getByRole("button", { name: "Add reference group" })).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Photography Plan" }));
    expect(screen.getByText(/coming soon/i)).toBeVisible();
  });
});
```

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Write `PhotographyPlanTab.tsx`**

```tsx
export function PhotographyPlanTab() {
  return (
    <section className="p-10 text-center text-stone-600">
      <p className="text-xs uppercase tracking-[0.24em] text-amber-700">Photography Plan</p>
      <h3 className="mt-3 text-2xl font-semibold text-stone-900">Coming soon</h3>
      <p className="mt-3">Shot lists, schedule, and notes will live here.</p>
    </section>
  );
}
```

- [ ] **Step 4: Write `PlanPanel.tsx`**

```tsx
import { useState } from "react";
import { PhotographyPlanTab } from "./PhotographyPlanTab";
import { ReferenceImagesTab, type ReferenceImagesTabProps } from "./ReferenceImagesTab";

type PlanTab = "photography" | "references";

interface PlanPanelProps extends ReferenceImagesTabProps {
  error?: string | null;
}

const tabButton =
  "px-4 py-2 text-sm font-medium border-b-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500";

export function PlanPanel({ error, ...referenceProps }: PlanPanelProps) {
  const [tab, setTab] = useState<PlanTab>("references");

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div aria-label="Plan tabs" className="flex gap-2 border-b border-black/10 px-6 pt-4" role="tablist">
        <button
          aria-selected={tab === "photography"}
          className={`${tabButton} ${tab === "photography" ? "border-amber-500 text-stone-900" : "border-transparent text-stone-500"}`}
          onClick={() => setTab("photography")}
          role="tab"
          type="button"
        >
          Photography Plan
        </button>
        <button
          aria-selected={tab === "references"}
          className={`${tabButton} ${tab === "references" ? "border-amber-500 text-stone-900" : "border-transparent text-stone-500"}`}
          onClick={() => setTab("references")}
          role="tab"
          type="button"
        >
          Reference Images
        </button>
      </div>

      {error ? (
        <div className="mx-6 mt-4 rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-700" role="alert">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "photography" ? <PhotographyPlanTab /> : <ReferenceImagesTab {...referenceProps} />}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run and watch it pass; commit**

```powershell
git add src/features/plan/PhotographyPlanTab.tsx src/features/plan/PlanPanel.tsx src/features/plan/PlanPanel.test.tsx
git commit -m "feat: add plan panel with tabs"
```

### Task 11: Project plan provider (state + orchestration)

**Files:**
- Create: `src/features/plan/ProjectPlanProvider.tsx`
- Test: `src/features/plan/ProjectPlanProvider.test.tsx`

**Interfaces:**
- Consumes: `PlanService` (Task 2), `PlanImagePicker` (Task 2), `WorkspaceLogger`, `PlanPanel` (Task 10), `ReferenceImageLightbox` (Task 8).
- Produces: `PlanDependencies { service: PlanService; picker: PlanImagePicker; logger: WorkspaceLogger }` and `ProjectPlanProvider({ projectPath: string; dependencies: PlanDependencies })`. Loads the plan and each image on mount, guards concurrent actions with a busy ref, and opens the lightbox on image click.

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PlanService } from "../../domain/plan/service";
import { ProjectPlanProvider, type PlanDependencies } from "./ProjectPlanProvider";

function deps(): { dependencies: PlanDependencies; service: PlanService; pick: ReturnType<typeof vi.fn> } {
  const plan = { referenceGroups: [{ id: "g1", title: "Lookbook", columnsPerRow: 3, images: [{ id: "i1", file: "references/0001.png" }] }] };
  const service: PlanService = {
    loadPlan: vi.fn().mockResolvedValue(plan),
    loadImage: vi.fn().mockResolvedValue("data:image/png;base64,AA"),
    addGroup: vi.fn(),
    renameGroup: vi.fn(),
    deleteGroup: vi.fn(),
    setColumns: vi.fn(),
    importImage: vi.fn().mockResolvedValue({
      plan: { referenceGroups: [{ id: "g1", title: "Lookbook", columnsPerRow: 3, images: [{ id: "i1", file: "references/0001.png" }, { id: "i2", file: "references/0002.png" }] }] },
      image: { id: "i2", file: "references/0002.png" },
      dataUrl: "data:image/png;base64,BB",
    }),
    removeImage: vi.fn(),
  };
  const pick = vi.fn().mockResolvedValue("C:\\src\\b.png");
  return {
    service,
    pick,
    dependencies: { service, picker: { pickImageFile: pick }, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
  };
}

describe("ProjectPlanProvider", () => {
  it("loads the plan and images, then imports and opens the lightbox", async () => {
    const user = userEvent.setup();
    const { dependencies, service } = deps();

    render(<ProjectPlanProvider projectPath="C:\\demo" dependencies={dependencies} />);

    const group = await screen.findByRole("group", { name: "Reference group: Lookbook" });
    expect(service.loadImage).toHaveBeenCalledWith("C:\\demo", "references/0001.png");
    expect(await screen.findByRole("img", { name: "Reference image 1" })).toBeVisible();

    await user.click(within(group).getByRole("button", { name: "Add reference image" }));
    await waitFor(() => expect(service.importImage).toHaveBeenCalledWith("C:\\demo", expect.anything(), "g1", "C:\\src\\b.png"));
    expect(await screen.findByRole("img", { name: "Reference image 2" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Open reference image 1" }));
    expect(await screen.findByRole("dialog")).toBeVisible();
  });
});
```

(Add `import { within } from "@testing-library/react";` to the test imports.)

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Write `ProjectPlanProvider.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { EMPTY_PLAN, type ProjectPlan } from "../../domain/plan/models";
import type { PlanImagePicker } from "../../domain/plan/ports";
import type { PlanService } from "../../domain/plan/service";
import type { WorkspaceLogger } from "../../domain/workspace/ports";
import { PlanPanel } from "./PlanPanel";
import { ReferenceImageLightbox } from "./ReferenceImageLightbox";

export interface PlanDependencies {
  service: PlanService;
  picker: PlanImagePicker;
  logger: WorkspaceLogger;
}

interface ProjectPlanProviderProps {
  projectPath: string;
  dependencies: PlanDependencies;
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ProjectPlanProvider({ projectPath, dependencies }: ProjectPlanProviderProps) {
  const { service, picker, logger } = dependencies;
  const [plan, setPlan] = useState<ProjectPlan>(EMPTY_PLAN);
  const [imageSrc, setImageSrc] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const busyRef = useRef(false);
  const planRef = useRef(plan);

  useEffect(() => {
    planRef.current = plan;
  }, [plan]);

  const report = useCallback(
    (message: string, err: unknown) => {
      logger.error(message, { error: err });
      if (mountedRef.current) {
        setError(detail(err));
      }
    },
    [logger],
  );

  const guard = useCallback(
    async (message: string, action: () => Promise<void>) => {
      if (busyRef.current || !mountedRef.current) {
        return;
      }
      busyRef.current = true;
      try {
        await action();
      } catch (err) {
        report(message, err);
      } finally {
        busyRef.current = false;
      }
    },
    [report],
  );

  useEffect(() => {
    mountedRef.current = true;
    async function load() {
      try {
        const loaded = await service.loadPlan(projectPath);
        if (!mountedRef.current) return;
        setPlan(loaded);
        setError(null);
        for (const group of loaded.referenceGroups) {
          for (const image of group.images) {
            try {
              const src = await service.loadImage(projectPath, image.file);
              if (!mountedRef.current) return;
              setImageSrc((current) => ({ ...current, [image.file]: src }));
            } catch (err) {
              report("Unable to load a reference image", err);
            }
          }
        }
      } catch (err) {
        report("Unable to load the project plan", err);
      }
    }
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [projectPath, service, report]);

  const addGroup = useCallback(() => {
    void guard("Unable to add a reference group", async () => {
      const next = await service.addGroup(projectPath, planRef.current, "New group");
      if (mountedRef.current) {
        setPlan(next);
        setError(null);
      }
    });
  }, [guard, projectPath, service]);

  const renameGroup = useCallback(
    (groupId: string, title: string) => {
      void guard("Unable to rename the reference group", async () => {
        const next = await service.renameGroup(projectPath, planRef.current, groupId, title);
        if (mountedRef.current) setPlan(next);
      });
    },
    [guard, projectPath, service],
  );

  const deleteGroup = useCallback(
    (groupId: string) => {
      void guard("Unable to delete the reference group", async () => {
        const next = await service.deleteGroup(projectPath, planRef.current, groupId);
        if (mountedRef.current) setPlan(next);
      });
    },
    [guard, projectPath, service],
  );

  const setColumns = useCallback(
    (groupId: string, columns: number) => {
      void guard("Unable to change the layout", async () => {
        const next = await service.setColumns(projectPath, planRef.current, groupId, columns);
        if (mountedRef.current) setPlan(next);
      });
    },
    [guard, projectPath, service],
  );

  const addImage = useCallback(
    (groupId: string) => {
      void guard("Unable to import the reference image", async () => {
        const sourcePath = await picker.pickImageFile("Select a JPG or PNG reference image");
        if (sourcePath === null) return;
        const result = await service.importImage(projectPath, planRef.current, groupId, sourcePath);
        if (!mountedRef.current) return;
        setImageSrc((current) => ({ ...current, [result.image.file]: result.dataUrl }));
        setPlan(result.plan);
        setError(null);
      });
    },
    [guard, picker, projectPath, service],
  );

  const removeImage = useCallback(
    (groupId: string, imageId: string) => {
      void guard("Unable to remove the reference image", async () => {
        const next = await service.removeImage(projectPath, planRef.current, groupId, imageId);
        if (mountedRef.current) setPlan(next);
      });
    },
    [guard, projectPath, service],
  );

  return (
    <>
      <PlanPanel
        error={error}
        groups={plan.referenceGroups}
        imageSrc={(file) => imageSrc[file]}
        onAddGroup={addGroup}
        onAddImage={addImage}
        onDeleteGroup={deleteGroup}
        onOpenImage={(file) => setLightbox(file)}
        onRemoveImage={removeImage}
        onRenameGroup={renameGroup}
        onSetColumns={setColumns}
      />
      {lightbox && imageSrc[lightbox] ? (
        <ReferenceImageLightbox
          alt="Reference image"
          onClose={() => setLightbox(null)}
          src={imageSrc[lightbox]}
        />
      ) : null}
    </>
  );
}
```

- [ ] **Step 4: Run and watch it pass; commit**

```powershell
git add src/features/plan/ProjectPlanProvider.tsx src/features/plan/ProjectPlanProvider.test.tsx
git commit -m "feat: add project plan provider"
```

### Task 12: Compose plan dependencies and wire the opened project

**Files:**
- Create: `src/app/plan/planDependencies.ts`
- Test: `src/app/plan/planDependencies.test.ts`
- Modify: `src/app/layout/Workspace.tsx`
- Modify: `src/app/layout/AppShell.tsx`
- Modify: `src/app/workspace/WorkspaceProvider.tsx`
- Modify: `src/app/workspace/WorkspaceProvider.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`

**Interfaces:**
- Produces: `createPlanDependencies(): PlanDependencies` (production Tauri, or memory in E2E, fails closed in PROD). `Workspace({ projectPath, dependencies })`. `WorkspaceProvider` and `App` gain an optional `planDependencies` prop (default `createPlanDependencies()`).

- [ ] **Step 1: Write `planDependencies.ts`**

```ts
import { createPlanService } from "../../domain/plan/service";
import type { PlanDependencies } from "../../features/plan/ProjectPlanProvider";
import { browserPlanDependencies } from "../../infrastructure/plan/browserPlan";
import { planImagePicker } from "../../infrastructure/plan/planDialog";
import { tauriPlan } from "../../infrastructure/plan/tauriPlan";
import { planLogger } from "../../shared/logging/logger";

function createProductionPlanDependencies(): PlanDependencies {
  return {
    service: createPlanService({
      repository: tauriPlan,
      imageStore: tauriPlan,
      createId: () => crypto.randomUUID(),
      logger: planLogger,
    }),
    picker: planImagePicker,
    logger: planLogger,
  };
}

export function createPlanDependencies(): PlanDependencies {
  if (import.meta.env.VITE_WORKSPACE_ADAPTER === "memory") {
    if (import.meta.env.PROD) {
      throw new Error(
        "The in-memory plan adapter is only available in end-to-end mode and must never run in a production build.",
      );
    }
    return { ...browserPlanDependencies, logger: planLogger };
  }
  return createProductionPlanDependencies();
}
```

- [ ] **Step 2: Write `planDependencies.test.ts`** (mirror `workspace/dependencies.test.ts`)

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserPlanDependencies } from "../../infrastructure/plan/browserPlan";
import { createPlanDependencies } from "./planDependencies";

afterEach(() => vi.unstubAllEnvs());

describe("createPlanDependencies", () => {
  it("uses the in-memory service outside production", () => {
    vi.stubEnv("VITE_WORKSPACE_ADAPTER", "memory");
    vi.stubEnv("PROD", false);
    expect(createPlanDependencies().service).toBe(browserPlanDependencies.service);
  });

  it("fails closed for the memory adapter in production", () => {
    vi.stubEnv("VITE_WORKSPACE_ADAPTER", "memory");
    vi.stubEnv("PROD", true);
    expect(() => createPlanDependencies()).toThrowError(/in-memory plan adapter/i);
  });

  it("builds production dependencies by default", () => {
    vi.stubEnv("VITE_WORKSPACE_ADAPTER", "");
    const dependencies = createPlanDependencies();
    expect(dependencies.service).not.toBe(browserPlanDependencies.service);
    expect(dependencies.picker).toBeDefined();
  });
});
```

- [ ] **Step 3: Rewrite `Workspace.tsx`**

```tsx
import { ProjectPlanProvider, type PlanDependencies } from "../../features/plan/ProjectPlanProvider";

interface WorkspaceProps {
  projectPath: string;
  dependencies: PlanDependencies;
}

export function Workspace({ projectPath, dependencies }: WorkspaceProps) {
  return (
    <main className="flex min-w-0 flex-1 flex-col bg-stone-100">
      <ProjectPlanProvider dependencies={dependencies} projectPath={projectPath} />
    </main>
  );
}
```

- [ ] **Step 4: Make Plan the active tool in `AppShell.tsx`** — replace the `tools` constant and the `<li>` rendering:

```tsx
const tools = [
  { label: "Plan", active: true },
  { label: "Canvas", active: false },
  { label: "Assets", active: false },
  { label: "Copywriting", active: false },
  { label: "Export", active: false },
];
```

```tsx
            {tools.map((tool) => (
              <li
                aria-current={tool.active ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-sm ${tool.active ? "bg-white/10 text-white" : "text-stone-500"}`}
                key={tool.label}
              >
                {tool.label}
              </li>
            ))}
```

- [ ] **Step 5: Thread plan dependencies through `WorkspaceProvider.tsx`** — add the prop and pass it to `Workspace`:

Add to imports: `import { createPlanDependencies } from "../plan/planDependencies";` and `import type { PlanDependencies } from "../../features/plan/ProjectPlanProvider";`

Change the props type and default:

```tsx
interface WorkspaceProviderProps {
  dependencies: WorkspaceDependencies;
  planDependencies?: PlanDependencies;
}

const defaultPlanDependencies = createPlanDependencies();

export function WorkspaceProvider({
  dependencies,
  planDependencies = defaultPlanDependencies,
}: WorkspaceProviderProps) {
```

Change the project render branch:

```tsx
  if (view.kind === "project") {
    return (
      <AppShell projectName={view.project.name}>
        <Workspace dependencies={planDependencies} projectPath={view.project.path} />
      </AppShell>
    );
  }
```

- [ ] **Step 6: Thread through `App.tsx`**

```tsx
import { WorkspaceProvider } from "./workspace/WorkspaceProvider";
import { createWorkspaceDependencies, type WorkspaceDependencies } from "./workspace/dependencies";
import { createPlanDependencies } from "./plan/planDependencies";
import type { PlanDependencies } from "../features/plan/ProjectPlanProvider";

const defaultWorkspaceDependencies = createWorkspaceDependencies();
const defaultPlanDependencies = createPlanDependencies();

interface AppProps {
  dependencies?: WorkspaceDependencies;
  planDependencies?: PlanDependencies;
}

export function App({
  dependencies = defaultWorkspaceDependencies,
  planDependencies = defaultPlanDependencies,
}: AppProps) {
  return <WorkspaceProvider dependencies={dependencies} planDependencies={planDependencies} />;
}
```

- [ ] **Step 7: Update existing tests that opened the old placeholder**

In `WorkspaceProvider.test.tsx` add a fake plan-dependencies helper and pass it to every `render(<WorkspaceProvider .../>)`; replace assertions on `"Start your photography plan"` with the Plan UI. Add near the top:

```tsx
import type { PlanDependencies } from "../../features/plan/ProjectPlanProvider";

function planDeps(): PlanDependencies {
  return {
    service: {
      loadPlan: vi.fn().mockResolvedValue({ referenceGroups: [] }),
      loadImage: vi.fn().mockResolvedValue(""),
      addGroup: vi.fn(),
      renameGroup: vi.fn(),
      deleteGroup: vi.fn(),
      setColumns: vi.fn(),
      importImage: vi.fn(),
      removeImage: vi.fn(),
    },
    picker: { pickImageFile: vi.fn().mockResolvedValue(null) },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}
```

Render with `<WorkspaceProvider dependencies={dependencies} planDependencies={planDeps()} />` in every case. Where a test asserted `screen.getByText("Start your photography plan")`, replace with `await screen.findByRole("button", { name: "Add reference group" })`. Where it asserted the `"Editorial"` project name is visible, keep that (it comes from `AppShell`). Do the same substitution in `App.test.tsx`: pass `planDependencies={planDeps()}`, and replace `expect(screen.getByText("Start your photography plan")).toBeVisible();` with `expect(await screen.findByRole("button", { name: "Add reference group" })).toBeVisible();`. Keep the existing `AppShell` nav assertions (they still pass because "Canvas"/"Assets"/… remain).

- [ ] **Step 8: Run the affected suites**

Run: `pnpm exec vitest run src/app`
Expected: PASS (updated WorkspaceProvider, App, and new planDependencies suites).

- [ ] **Step 9: Commit**

```powershell
git add src/app/plan src/app/layout/Workspace.tsx src/app/layout/AppShell.tsx src/app/workspace/WorkspaceProvider.tsx src/app/workspace/WorkspaceProvider.test.tsx src/app/App.tsx src/app/App.test.tsx
git commit -m "feat: wire the plan panel into the opened project"
```

### Task 13: E2E flow, docs, verification, and completion

**Files:**
- Create: `e2e/plan.spec.ts`
- Modify: `docs/ARCHITECTURE.md`, `docs/TESTING.md`
- Modify: `docs/design_docs/featurelist.json`

- [ ] **Step 1: Write `e2e/plan.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

test("opens a project and browses reference images", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open project Editorial Demo" }).click();

  const group = page.getByRole("group", { name: "Reference group: Lookbook" });
  await expect(group.getByRole("img", { name: "Reference image 1" })).toBeVisible();

  await group.getByRole("button", { name: "Open reference image 1" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close image" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});
```

- [ ] **Step 2: Run E2E**

Run: `pnpm test:e2e`
Expected: both `workspace.spec.ts` and `plan.spec.ts` PASS.

- [ ] **Step 3: Document the feature** — add a "Basic Plan Editing" section to `docs/ARCHITECTURE.md` (plan lives in the `.preshot` manifest; `references/` holds moved+renumbered jpg/png; commands `save_project_plan`/`read_project_plan`/`import_reference_image`/`load_reference_image`/`remove_reference_image`; on-demand base64 data URLs). Add a "Plan Coverage" bullet list to `docs/TESTING.md` (domain reducers/service, tauri + browser adapters, Rust tempdir import/load/remove/save tests, component + provider tests, and the `plan.spec.ts` browser flow). Commit.

```powershell
git add docs/ARCHITECTURE.md docs/TESTING.md
git commit -m "docs: document basic plan editing"
```

- [ ] **Step 4: Run the full verification matrix**

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:init
pnpm test:e2e
```
Rust (VS env): `& $env:ComSpec /c 'call "C:\Program Files\Microsoft Visual Studio\18\Enterprise\VC\Auxiliary\Build\vcvars64.bat" >nul && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && cd /d C:\projects\Preshot && cargo fmt --manifest-path src-tauri\Cargo.toml --check && cargo test --manifest-path src-tauri\Cargo.toml'`
Then: `pnpm build` and `pnpm tauri:build`.
Expected: every command exits 0; MSI + NSIS bundles produced.

- [ ] **Step 5: Mark the feature completed** — in `docs/design_docs/featurelist.json`, set the `基础方案编辑` feature `status` to `"completed"`, move `progress.remaining` items into `progress.completed`, set `remaining` to `[]`, and add a `lastVerified` array with the matrix results. Keep `decisions` intact.

- [ ] **Step 6: Repository hygiene and commit**

```powershell
git --no-pager diff --check
git status --short
git add docs/design_docs/featurelist.json
git commit -m "docs: complete basic plan editing feature"
```

## Self-Review

- **Spec coverage:** Plan as primary section (Task 12) ✓; two tabs (Task 10) ✓; Photography placeholder (Task 10) ✓; groups add/rename/delete/columns (Tasks 9, 11) ✓; import moves+renumbers jpg/png (Task 5) ✓; 1:1 squares + lightbox (Tasks 8, 9) ✓; plan in `.preshot` manifest (Tasks 4, 5) ✓; `references/` subfolder (Task 5) ✓; on-demand data URLs (Tasks 5, 6, 11) ✓; fail-closed memory adapter (Task 12) ✓; structured `plan-service` logs (Task 3) ✓.
- **Type consistency:** `ProjectPlan`/`ReferenceGroup`/`ReferenceImage` identical across domain (Task 1), Rust `camelCase` (Task 4), and adapter validators (Task 6). `ImportedImage { file, dataUrl }` consistent (Tasks 1, 5, 6). Commands named identically in Rust (Task 5) and adapters (Task 6).
- **Placeholder scan:** none — every step ships real code or an exact command.
