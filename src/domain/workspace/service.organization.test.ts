import { describe, expect, it, vi } from "vitest";
import { createWorkspaceService } from "./service";
import { emptyOrganization } from "./organization";
import type { NativeWorkspace } from "./ports";
import type { WorkspaceMetadata } from "./models";

function fixture() {
  const record = { projectId: "p", path: "C:/p", name: "南京大桥", status: "available" as const, coverImage: null, createdAt: "a", updatedAt: "b", lastOpenedAt: "c" };
  let disk: WorkspaceMetadata = { schemaVersion: 1, projects: [record] };
  const registry = { load: vi.fn(async () => structuredClone(disk)), save: vi.fn(async (next: WorkspaceMetadata) => { disk = structuredClone(next); }) };
  const native: NativeWorkspace = {
    ensureUserDataRoots: vi.fn(async () => ({ userRoot: "C:/user", projectsRoot: "C:/projects" })),
    bootstrapUserData: vi.fn(async () => ({ roots: { userRoot: "C:/user", projectsRoot: "C:/projects" }, project: null, rollbackToken: null })),
    inspectProject: vi.fn(async (path) => ({ path, manifest: { schemaVersion: 1 as const, id: "p", name: "新名称", createdAt: "a", updatedAt: "d" }, resolvedCoverImage: null, coverDataUrl: null })),
    createProject: vi.fn(), deleteProject: vi.fn(), rollbackCreatedProject: vi.fn(), forgetCreatedProject: vi.fn(), onMenuAction: vi.fn(),
  };
  const makeService = () => createWorkspaceService({ registry, native, clock: { now: () => "e" }, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
  return { service: makeService(), makeService, native, registry, record, disk: () => disk };
}

describe("workspace organization persistence", () => {
  it("migrates v1, preserves grouping through reopen/relocation and reloads persisted state", async () => {
    const f = fixture();
    await f.service.loadProjects();
    expect(f.disk()).toMatchObject({ schemaVersion: 2, ...emptyOrganization() });
    await f.service.updateProjectOrganization({ type: "create", groupId: "g", name: "人像" });
    await f.service.updateProjectOrganization({ type: "move", projectId: "p", groupId: "g" });
    await f.service.updateProjectOrganization({ type: "collapse", groupId: "g", collapsed: true });
    await f.service.openProject("C:/p");
    await f.service.relocateProject(f.record, "D:/p");
    const restarted = f.makeService();
    await restarted.loadProjects();
    expect(await restarted.loadProjectOrganization()).toMatchObject({ groups: [{ id: "default" }, { id: "g", collapsed: true }], projectGroupIds: { p: "g" } });
    await restarted.removeRecord("p");
    expect(await restarted.loadProjectOrganization()).toMatchObject({ projectGroupIds: {} });
  });

  it("publishes only after save, preserves failed intent for retry and serializes group operations", async () => {
    const f = fixture();
    await f.service.loadProjects();
    f.registry.save.mockRejectedValueOnce(new Error("disk full"));
    await expect(f.service.updateProjectOrganization({ type: "create", groupId: "g", name: "人像" })).rejects.toThrow("disk full");
    expect(await f.service.loadProjectOrganization()).toEqual(emptyOrganization());
    await Promise.all([
      f.service.updateProjectOrganization({ type: "create", groupId: "g", name: "人像" }),
      f.service.updateProjectOrganization({ type: "move", projectId: "p", groupId: "g" }),
    ]);
    f.registry.save.mockClear();
    await f.service.updateProjectOrganization({ type: "delete", groupId: "g" });
    expect(f.registry.save).toHaveBeenCalledOnce();
    expect(f.disk()).toMatchObject({ projects: [expect.objectContaining({ projectId: "p" })], ...emptyOrganization() });
  });

  it("places created, first-opened and copied projects in default without changing the source group", async () => {
    const f = fixture();
    await f.service.loadProjects();
    await f.service.updateProjectOrganization({ type: "create", groupId: "g", name: "人像" });
    await f.service.updateProjectOrganization({ type: "move", projectId: "p", groupId: "g" });
    const inspected = (id: string) => ({ path: `D:/${id}`, manifest: { schemaVersion: 1 as const, id, name: id, createdAt: "a", updatedAt: "b" }, resolvedCoverImage: null, coverDataUrl: null });
    vi.mocked(f.native.createProject).mockResolvedValueOnce({ project: inspected("created"), rollbackToken: "token" });
    await f.service.createProject("D:/", "created");
    vi.mocked(f.native.inspectProject).mockResolvedValueOnce(inspected("opened"));
    await f.service.openProject("D:/opened");
    f.native.copyProject = vi.fn(async () => ({ operationId: "op", phase: "completed" as const, copiedBytes: 1, totalBytes: 1, project: inspected("copied"), error: null }));
    await f.service.copyProject!({ operationId: "op", sourcePath: "C:/p", sourceProjectId: "p", parentPath: "D:/", name: "copied" });
    expect(f.disk().projects.map(project => project.projectId)).toEqual(expect.arrayContaining(["p", "created", "opened", "copied"]));
    expect((await f.service.loadProjectOrganization()).projectGroupIds).toEqual({ p: "g" });
  });
});
