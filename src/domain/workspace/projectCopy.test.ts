import { describe, expect, it, vi } from "vitest";
import { createWorkspaceService } from "./service";
import type { NativeWorkspace, WorkspaceRegistry } from "./ports";

describe("workspace project copying", () => {
  it("keeps a completed copy when registration fails and retries the same operation", async () => {
    const input = { operationId: "operation", sourcePath: "C:\\shoots\\original", sourceProjectId: "original", parentPath: "D:\\shoots", name: "副本" };
    const source = { projectId: "original", path: input.sourcePath, name: "原项目", coverImage: null, status: "available" as const,
      createdAt: "2026-01-01", updatedAt: "2026-01-01", lastOpenedAt: "2026-01-01" };
    const project = { path: "D:\\shoots\\副本", manifest: { schemaVersion: 1 as const, id: "new-id", name: "副本", createdAt: "2026-09-30", updatedAt: "2026-09-30" }, resolvedCoverImage: null, coverDataUrl: null };
    const native = { copyProject: vi.fn().mockResolvedValue({ operationId: "operation", phase: "completed", copiedBytes: 123, totalBytes: 123, project, error: null }),
      projectCopyStatus: vi.fn().mockResolvedValue(null), acknowledgeProjectCopy: vi.fn().mockResolvedValue(undefined), rollbackCreatedProject: vi.fn() } as unknown as NativeWorkspace;
    const registry: WorkspaceRegistry = { load: vi.fn().mockResolvedValue({ schemaVersion: 1, projects: [source] }), save: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(undefined) };
    const service = createWorkspaceService({ native, registry, clock: { now: () => "2026-09-30" }, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    await expect(service.copyProject!(input)).rejects.toThrow(/副本.*保存|copied.*register/i);
    expect(native.rollbackCreatedProject).not.toHaveBeenCalled();
    expect(native.acknowledgeProjectCopy).not.toHaveBeenCalled();
    await expect(service.copyProject!(input)).resolves.toMatchObject({ projectId: "new-id", path: project.path });
    expect(native.copyProject).toHaveBeenNthCalledWith(2, input);
    expect(native.acknowledgeProjectCopy).toHaveBeenCalledWith("operation");
    expect(registry.save).toHaveBeenLastCalledWith(expect.objectContaining({ projects: expect.arrayContaining([expect.objectContaining({ projectId: "original" }), expect.objectContaining({ projectId: "new-id" })]) }));
  });
});
