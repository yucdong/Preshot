import { describe, expect, it, vi } from "vitest";
import { createNativeProjectCopy } from "./tauriProjectCopy";
import type { InspectedProject } from "../../domain/workspace/models";

const input = { operationId: "op", sourcePath: "C:\\source", sourceProjectId: "source", parentPath: "C:\\copies", name: "copy" };
const project: InspectedProject = { path: "C:\\copies\\copy", manifest: { schemaVersion: 1, id: "copy", name: "copy", createdAt: "now", updatedAt: "now" }, resolvedCoverImage: null, coverDataUrl: null };
const completed = { operationId: "op", phase: "completed", copiedBytes: 500, totalBytes: 500, project, error: null };
const inspect = (value: unknown) => value as InspectedProject;

describe("native project copy adapter", () => {
  it("recovers a lost response from the exact operation without launching another copy", async () => {
    const invoke = vi.fn().mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce(completed);
    expect(await createNativeProjectCopy(invoke, inspect).copyProject(input)).toEqual(completed);
    expect(invoke.mock.calls).toEqual([["copy_project", { input }], ["project_copy_status", { operationId: "op" }]]);
  });
  it("rejects an unrelated result and uncertain status", async () => {
    const invoke = vi.fn().mockResolvedValue({ ...completed, operationId: "another" });
    await expect(createNativeProjectCopy(invoke, inspect).copyProject(input)).rejects.toThrow("another operation");
  });
  it("recovers cancellation and validates pending receipt identity", async () => {
    const cancelled = { ...completed, phase: "cancelled", project: null };
    const invoke = vi.fn().mockRejectedValueOnce(new Error("lost")).mockResolvedValueOnce(cancelled);
    expect(await createNativeProjectCopy(invoke, inspect).copyProject(input)).toEqual(cancelled);
    invoke.mockResolvedValue([{ request: input, status: { ...completed, operationId: "wrong" } }]);
    await expect(createNativeProjectCopy(invoke, inspect).pendingProjectCopies()).rejects.toThrow("Mismatched");
  });
});
