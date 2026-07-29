import { describe, expect, it } from "vitest";
import { EMPTY_WORKSPACE } from "./models";
import {
  inspectedToProject,
  markProjectUnavailable,
  relocateProject,
  sortProjects,
  sortProjectsByRecentEdit,
  upsertProject,
} from "./registry";
import type {
  InspectedProject,
  WorkspaceMetadata,
  WorkspaceProjectRecord,
  WorkspaceProjectView,
} from "./models";

const project = (
  projectId: string,
  lastOpenedAt: string,
): WorkspaceProjectRecord => ({
  projectId,
  path: `C:\\shoots\\${projectId}`,
  name: projectId,
  coverImage: "cover.png",
  status: "available",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  lastOpenedAt,
});

const viewedProject = (
  projectId: string,
  lastOpenedAt: string,
): WorkspaceProjectView => ({
  ...project(projectId, lastOpenedAt),
  coverDataUrl: "data:image/png;base64,cover",
});

const persistedProject = {
  projectId: "persisted",
  path: "C:\\shoots\\persisted",
  name: "Persisted",
  coverImage: null,
  status: "available",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  lastOpenedAt: "2026-07-02T00:00:00.000Z",
} satisfies WorkspaceProjectRecord;

const workspaceMetadata = {
  schemaVersion: 1,
  projects: [persistedProject],
} satisfies WorkspaceMetadata;

const inspectedProject = (
  overrides: Partial<InspectedProject> = {},
): InspectedProject => ({
  path: "C:\\shoots\\project-a",
  manifest: {
    schemaVersion: 1,
    id: "project-a",
    name: "Project A",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
    coverImage: "manifest-cover.png",
  },
  resolvedCoverImage: "resolved-cover.png",
  coverDataUrl: "data:image/png;base64,resolved-cover",
  ...overrides,
});

describe("workspace registry", () => {
  it("forbids persisting preview data at the record boundary", () => {
    const expectRecord = (_record: WorkspaceProjectRecord) => _record;

    // @ts-expect-error WorkspaceProjectView must not be assignable to WorkspaceProjectRecord.
    expectRecord(viewedProject("preview", "2026-07-01T00:00:00.000Z"));
  });

  it("exports an empty workspace", () => {
    expect(EMPTY_WORKSPACE).toEqual({ schemaVersion: 1, projects: [] });
    expect(workspaceMetadata).toEqual({
      schemaVersion: 1,
      projects: [persistedProject],
    });
  });

  it("sorts projects by most recently opened and preserves ties", () => {
    const input = [
      viewedProject("older", "2026-07-01T00:00:00.000Z"),
      viewedProject("same-a", "2026-07-02T00:00:00.000Z"),
      viewedProject("same-b", "2026-07-02T00:00:00.000Z"),
    ];

    const result = sortProjects(input);

    expect(result).not.toBe(input);
    expect(result.map(({ projectId }) => projectId)).toEqual([
      "same-a",
      "same-b",
      "older",
    ]);
    expect(input.map(({ projectId }) => projectId)).toEqual([
      "older",
      "same-a",
      "same-b",
    ]);
  });

  it("sorts projects by most recent edit (updatedAt) and preserves ties without mutating", () => {
    const input = [
      { ...viewedProject("stale", "2026-07-09T00:00:00.000Z"), updatedAt: "2026-07-01T00:00:00.000Z" },
      { ...viewedProject("fresh-a", "2026-07-02T00:00:00.000Z"), updatedAt: "2026-07-05T00:00:00.000Z" },
      { ...viewedProject("fresh-b", "2026-07-03T00:00:00.000Z"), updatedAt: "2026-07-05T00:00:00.000Z" },
    ];

    const result = sortProjectsByRecentEdit(input);

    expect(result).not.toBe(input);
    expect(result.map(({ projectId }) => projectId)).toEqual([
      "fresh-a",
      "fresh-b",
      "stale",
    ]);
    expect(input.map(({ projectId }) => projectId)).toEqual([
      "stale",
      "fresh-a",
      "fresh-b",
    ]);
  });

  it("upserts by project ID without mutating the input", () => {
    const existing = [
      viewedProject("same-id", "2026-07-01T00:00:00.000Z"),
      viewedProject("other", "2026-07-03T00:00:00.000Z"),
    ];
    const moved = {
      ...existing[0],
      path: "D:\\shoots\\same-id",
      lastOpenedAt: "2026-07-04T00:00:00.000Z",
    };

    const result = upsertProject(existing, moved);

    expect(result).not.toBe(existing);
    expect(result).toEqual([
      moved,
      existing[1],
    ]);
    expect(existing).toEqual([
      viewedProject("same-id", "2026-07-01T00:00:00.000Z"),
      viewedProject("other", "2026-07-03T00:00:00.000Z"),
    ]);
  });

  it("collapses duplicate project IDs into one replacement", () => {
    const existing = [
      viewedProject("same-id", "2026-07-01T00:00:00.000Z"),
      {
        ...viewedProject("same-id", "2026-07-02T00:00:00.000Z"),
        path: "D:\\shoots\\same-id-copy",
      },
      viewedProject("other", "2026-07-03T00:00:00.000Z"),
    ];
    const replacement = {
      ...existing[0],
      path: "E:\\shoots\\same-id",
      lastOpenedAt: "2026-07-04T00:00:00.000Z",
    };

    const result = upsertProject(existing, replacement);

    expect(result).toEqual([replacement, existing[2]]);
    expect(result).toHaveLength(2);
    expect(existing).toHaveLength(3);
  });

  it("retains known metadata when a project becomes unavailable", () => {
    const existing = project("missing", "2026-07-01T00:00:00.000Z");

    expect(markProjectUnavailable(existing)).toEqual({
      ...existing,
      status: "unavailable",
      coverDataUrl: null,
    });
  });

  it("maps inspected projects into available records", () => {
    expect(
      inspectedToProject(inspectedProject(), "2026-07-05T00:00:00.000Z"),
    ).toEqual({
      projectId: "project-a",
      path: "C:\\shoots\\project-a",
      name: "Project A",
      coverImage: "resolved-cover.png",
      coverDataUrl: "data:image/png;base64,resolved-cover",
      status: "available",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
      lastOpenedAt: "2026-07-05T00:00:00.000Z",
    });
  });

  it("allows relocation when project IDs match", () => {
    const current = markProjectUnavailable(
      viewedProject("expected", "2026-07-01T00:00:00.000Z"),
    );
    const replacement: WorkspaceProjectView = {
      ...current,
      path: "D:\\shoots\\expected",
      status: "available",
      coverDataUrl: "data:image/png;base64,recovered",
    };

    expect(relocateProject(current, replacement)).toBe(replacement);
  });

  it("rejects relocation to a different project ID", () => {
    const existing = markProjectUnavailable(
      project("expected", "2026-07-01T00:00:00.000Z"),
    );

    expect(() =>
      relocateProject(existing, viewedProject("different", existing.lastOpenedAt)),
    ).toThrow("Selected folder belongs to a different Preshot project");
  });
});
