import { describe, expect, it, vi } from "vitest";
import { createCanvasPlanService } from "./service";
import { EMPTY_PLAN, type ProjectPlan, type ReferenceComponent } from "./models";

function referencePlan(): ProjectPlan {
  return {
    schemaVersion: 10,
    title: "Project",
    components: [{
      id: "r",
      name: "Reference",
      type: "reference",
      x: 0,
      width: 320,
      height: 240,
      description: "",
      images: [{
        id: "i1",
        file: "references/0001.png",
        aspectRatio: 1,
        frameWidth: 120,
        frameHeight: 120,
      }],
    }],
  };
}

function fakes(initialRaw: unknown) {
  let raw = initialRaw;
  const repository = {
    loadRawPlan: vi.fn(async () => raw),
    saveRawPlan: vi.fn(async (_path: string, plan: ProjectPlan) => {
      raw = plan;
    }),
  };
  const removed: string[] = [];
  const imageStore = {
    importImage: vi.fn(async () => ({
      file: "references/0009.png",
      dataUrl: "data:image/png;base64,AA",
    })),
    loadImage: vi.fn(async () => "data:image/png;base64,AA"),
    removeImage: vi.fn(async (_path: string, file: string) => {
      removed.push(file);
    }),
  };
  return { repository, imageStore, removed };
}

function serviceFor(initialRaw: unknown) {
  const fakesForService = fakes(initialRaw);
  return {
    ...fakesForService,
    service: createCanvasPlanService({
      ...fakesForService,
      createId: () => "i2",
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    }),
  };
}

describe("canvas plan service", () => {
  it("migrates legacy raw data and treats an empty v10 plan as stored", async () => {
    const legacy = serviceFor({ photographyPlan: "<p>x</p>", referenceGroups: [] });
    await expect(legacy.service.loadPlan("C:/p", "Project")).resolves.toMatchObject({
      status: "loaded",
      plan: { schemaVersion: 10, components: [expect.objectContaining({ type: "plan" })] },
    });

    const current = serviceFor(EMPTY_PLAN);
    await expect(current.service.loadPlan("C:/p", "Project")).resolves.toEqual({
      status: "loaded",
      plan: EMPTY_PLAN,
    });
  });

  it("imports an image with persistent v8 frame dimensions", async () => {
    const plan = referencePlan();
    const { service, repository } = serviceFor(plan);
    const result = await service.importImage("C:/p", plan, "r", "C:/source.png");
    const imported = (result.plan.components[0] as ReferenceComponent).images[1];

    expect(imported).toMatchObject({
      id: "i2",
      frameWidth: 135,
      frameHeight: 135,
      aspectRatio: 1,
    });
    expect(repository.saveRawPlan).toHaveBeenCalledWith("C:/p", result.plan);
  });

  it("removes unshared files and retains shared files across cards", async () => {
    const plan = referencePlan();
    const { service, removed } = serviceFor(plan);
    await service.removeImage("C:/p", plan, "r", "i1");
    expect(removed).toEqual(["references/0001.png"]);

    const shared: ProjectPlan = {
      ...plan,
      components: [
        plan.components[0],
        (() => {
          const original = plan.components[0] as ReferenceComponent;
          return {
            ...original,
            id: "r2",
            y: 324,
            images: [{ ...original.images[0], id: "i2" }],
          };
        })(),
      ],
    };
    const sharedFiles = serviceFor(shared);
    await sharedFiles.service.removeComponent("C:/p", shared, "r");
    expect(sharedFiles.removed).toEqual([]);
  });
});
