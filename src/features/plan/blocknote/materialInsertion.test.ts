import { describe, expect, it, vi } from "vitest";
import { createEmptyProjectPlanV15 } from "../../../domain/plan/canvas/blockDocument";
import type { MaterialLibraryRepository } from "../../../domain/library/ports";
import { unavailableMaterialLibrary } from "../../../infrastructure/library/unavailableMaterialLibrary";
import { insertLibraryMaterial, MaterialInsertionRecoveryError } from "./materialInsertion";

const payload = {
  format: "preshot-material" as const,
  version: 1 as const,
  kind: "prop" as const,
  component: { kind: "prop" as const, title: "玻璃", source: "侧光", gallery: { images: [] } },
};

function setup() {
  const events: string[] = [];
  const repository: MaterialLibraryRepository = {
    ...unavailableMaterialLibrary,
    availability: "test",
    prepareInsert: vi.fn(async (input) => {
      events.push("prepare");
      return { operationId: input.operationId, materialId: input.materialId, revision: 1, payload, images: [] };
    }),
    commitInsert: vi.fn(async () => { events.push("commit"); }),
    abortInsert: vi.fn(async () => { events.push("abort"); }),
    getInsertStatus: vi.fn<MaterialLibraryRepository["getInsertStatus"]>(async () => "prepared"),
  };
  let id = 0;
  const plan = createEmptyProjectPlanV15("目标", { makeId: () => `initial-${++id}` });
  return {
    events, repository,
    input: {
      operationId: "op",
      materialId: "material",
      revision: 1,
      projectId: "project",
      projectPath: "C:\\projects\\target",
      expectedPlan: plan,
    },
    makeId: () => `new-${++id}`,
    isCurrent: vi.fn(() => true),
    publish: vi.fn(() => { events.push("publish"); }),
  };
}

describe("coordinated material insertion", () => {
  it("publishes one validated full plan only after native durable commit", async () => {
    const context = setup();
    await insertLibraryMaterial({ ...context, afterBlockId: null });
    expect(context.events).toEqual(["prepare", "commit", "publish"]);
    const call = vi.mocked(context.repository.commitInsert).mock.calls[0][0];
    expect(call.nextPlan.artifacts).toHaveLength(1);
    expect(call.nextPlan.document.blocks[0].props.artifactId).toBe(call.nextPlan.artifacts[0].id);
  });

  it("aborts only owned copies when the provider changes while preparing", async () => {
    const context = setup();
    context.isCurrent.mockReturnValueOnce(true).mockReturnValue(false);
    await expect(insertLibraryMaterial({ ...context, afterBlockId: null })).rejects.toThrow("方案");
    expect(context.events).toEqual(["prepare", "abort"]);
  });

  it("cleans up a lost prepare response using the same operation receipt", async () => {
    const context = setup();
    vi.mocked(context.repository.prepareInsert).mockRejectedValue(new Error("lost response"));
    await expect(insertLibraryMaterial({ ...context, afterBlockId: null })).rejects.toThrow("lost response");
    expect(context.repository.abortInsert).toHaveBeenCalledWith(context.input.projectPath, context.input.operationId);
    expect(context.repository.commitInsert).not.toHaveBeenCalled();
    expect(context.publish).not.toHaveBeenCalled();
  });

  it("loads copied images before committing and aborts an unreadable copy", async () => {
    const context = setup();
    await expect(insertLibraryMaterial({
      ...context,
      afterBlockId: null,
      preparePublication: async () => { throw new Error("image unavailable"); },
    })).rejects.toThrow("image unavailable");
    expect(context.events).toEqual(["prepare", "abort"]);
    expect(context.publish).not.toHaveBeenCalled();
  });

  it("revalidates the target after preparing the editor's image sources", async () => {
    const context = setup();
    await expect(insertLibraryMaterial({
      ...context,
      afterBlockId: null,
      preparePublication: async () => { context.isCurrent.mockReturnValue(false); },
    })).rejects.toThrow("方案");
    expect(context.events).toEqual(["prepare", "abort"]);
    expect(context.publish).not.toHaveBeenCalled();
  });

  it("resolves a lost commit response without duplicating or deleting committed data", async () => {
    const context = setup();
    vi.mocked(context.repository.commitInsert).mockRejectedValue(new Error("lost response"));
    vi.mocked(context.repository.getInsertStatus).mockResolvedValue("committed");
    await insertLibraryMaterial({ ...context, afterBlockId: null });
    expect(context.publish).toHaveBeenCalledOnce();
    expect(context.repository.abortInsert).not.toHaveBeenCalled();
  });

  it("retains uncertain operations instead of returning a false success or deleting files", async () => {
    const context = setup();
    vi.mocked(context.repository.commitInsert).mockRejectedValue(new Error("lost response"));
    vi.mocked(context.repository.getInsertStatus).mockRejectedValue(new Error("offline"));
    await expect(insertLibraryMaterial({ ...context, afterBlockId: null })).rejects.toBeInstanceOf(MaterialInsertionRecoveryError);
    expect(context.publish).not.toHaveBeenCalled();
    expect(context.repository.abortInsert).not.toHaveBeenCalled();
  });

  it("never rolls back a durable manifest when editor publication fails", async () => {
    const context = setup();
    context.publish.mockImplementation(() => { throw new Error("editor unavailable"); });
    await expect(insertLibraryMaterial({ ...context, afterBlockId: null })).rejects.toBeInstanceOf(MaterialInsertionRecoveryError);
    expect(context.repository.abortInsert).not.toHaveBeenCalled();
  });
});
