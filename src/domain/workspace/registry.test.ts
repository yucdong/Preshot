import { describe, expect, it } from "vitest";
import { EMPTY_WORKSPACE } from "./models";
import {
  inspectedToRecord,
  markProjectUnavailable,
  relocateProject,
  sortProjects,
  upsertProject,
} from "./registry";
import type { InspectedProject, WorkspaceProjectRecord } from "./models";

const project = (
  projectId: string,
  lastOpenedAt: string,
): WorkspaceProjectRecord => ({
  projectId,
  path: `C:\\shoots\\${projectId}`,
  name: projectId,
  coverImage: "cover.png",
  coverDataUrl: "data:image/png;base64,cover",
  status: "available",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  lastOpenedAt,
});

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
  it("exports an empty workspace", () => {
    expect(EMPTY_WORKSPACE).toEqual({ schemaVersion: 1, projects: [] });
  });

  it("sorts projects by most recently opened and preserves ties", () => {
    const input = [
      project("older", "2026-07-01T00:00:00.000Z"),
      project("same-a", "2026-07-02T00:00:00.000Z"),
      project("same-b", "2026-07-02T00:00:00.000Z"),
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

  it("upserts by project ID without mutating the input", () => {
    const existing = [
      project("same-id", "2026-07-01T00:00:00.000Z"),
      project("other", "2026-07-03T00:00:00.000Z"),
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
      project("same-id", "2026-07-01T00:00:00.000Z"),
      project("other", "2026-07-03T00:00:00.000Z"),
    ]);
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
      inspectedToRecord(inspectedProject(), "2026-07-05T00:00:00.000Z"),
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
      project("expected", "2026-07-01T00:00:00.000Z"),
    );
    const replacement: WorkspaceProjectRecord = {
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
      relocateProject(existing, project("different", existing.lastOpenedAt)),
    ).toThrow("Selected folder belongs to a different Preshot project");
  });
});
