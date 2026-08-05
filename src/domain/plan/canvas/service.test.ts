import { describe, expect, it, vi } from "vitest";
import { createCanvasPlanService } from "./service";
import { EMPTY_PLAN, type ProjectPlan, type ReferenceComponent } from "./models";

function fakes(initialRaw: unknown) {
  let raw = initialRaw;
  const repository = {
    loadRawPlan: vi.fn(async () => raw),
    saveRawPlan: vi.fn(async (_p: string, plan: ProjectPlan) => {
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
    removeImage: vi.fn(async (_p: string, file: string) => {
      removed.push(file);
    }),
  };
  return { repository, imageStore, removed };
}

const refPlan: ProjectPlan = {
  schemaVersion: 4,
  components: [
    {
      id: "r",
      type: "reference",
      width: 1,
      title: "T",
      description: "",
      showCaptions: false, imageHeight: 180, images: [{ id: "i1", file: "references/0001.png", aspectRatio: 1 }],
    },
  ],
};

describe("canvas plan service", () => {
  it("migrates a v1 raw plan on load", async () => {
    const { repository, imageStore } = fakes({
      photographyPlan: "<p>x</p>",
      referenceGroups: [],
    });
    const service = createCanvasPlanService({
      repository,
      imageStore,
      createId: () => "id",
      logger: silentLogger(),
    });
    const result = await service.loadPlan("C:/p");
    expect(result).toMatchObject({
      status: "loaded",
      plan: {
        schemaVersion: 4,
        components: [{ type: "plan" }],
      },
    });
  });

  it("distinguishes a missing repository plan from a stored plan", async () => {
    const { repository, imageStore } = fakes(null);
    const service = createCanvasPlanService({
      repository,
      imageStore,
      createId: () => "id",
      logger: silentLogger(),
    });
    expect(await service.loadPlan("C:/p")).toEqual({ status: "missing" });

    repository.loadRawPlan.mockResolvedValue(EMPTY_PLAN);
    expect(await service.loadPlan("C:/p")).toEqual({
      status: "loaded",
      plan: EMPTY_PLAN,
    });
  });

  it("adds load context when non-null stored data is malformed", async () => {
    const { repository, imageStore } = fakes({ schemaVersion: 5, components: [] });
    const service = createCanvasPlanService({
      repository,
      imageStore,
      createId: () => "id",
      logger: silentLogger(),
    });

    await expect(service.loadPlan("C:/p")).rejects.toThrow(
      /Unable to load the project plan: Unsupported stored plan schema version 5/,
    );
  });

  it("imports an image into a reference component and persists", async () => {
    const { repository, imageStore } = fakes(refPlan);
    const service = createCanvasPlanService({
      repository,
      imageStore,
      createId: () => "i2",
      logger: silentLogger(),
    });
    const { plan } = await service.importImage("C:/p", refPlan, "r", "C:/src.png");
    expect((plan.components[0] as ReferenceComponent).images).toHaveLength(2);
    expect(repository.saveRawPlan).toHaveBeenCalled();
  });

  it("removes an image and deletes its file", async () => {
    const { repository, imageStore, removed } = fakes(refPlan);
    const service = createCanvasPlanService({
      repository,
      imageStore,
      createId: () => "x",
      logger: silentLogger(),
    });
    await service.removeImage("C:/p", refPlan, "r", "i1");
    expect(removed).toContain("references/0001.png");
    expect(repository.saveRawPlan).toHaveBeenCalled();
  });

  it("imports multiple images in batch via importImages", async () => {
    const { repository, imageStore } = fakes(refPlan);
    let counter = 0;
    imageStore.importImage.mockImplementation(async () => {
      counter += 1;
      return {
        file: `references/${String(counter).padStart(4, "0")}.png`,
        dataUrl: `data:image/png;base64,AA${counter}`,
      };
    });
    const service = createCanvasPlanService({
      repository,
      imageStore,
      createId: () => `i${counter + 1}`,
      logger: silentLogger(),
    });
    const result = await service.importImages("C:/p", refPlan, "r", ["C:/src1.png", "C:/src2.png"]);
    expect(result.images).toHaveLength(2);
    expect(result.images[0].image.id).toBe("i2");
    expect(result.images[0].dataUrl).toBe("data:image/png;base64,AA1");
    expect(result.images[1].image.id).toBe("i3");
    expect(result.images[1].dataUrl).toBe("data:image/png;base64,AA2");
    expect((result.plan.components[0] as ReferenceComponent).images).toHaveLength(3);
    expect(repository.saveRawPlan).toHaveBeenCalledTimes(1);
  });
});

function silentLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}
