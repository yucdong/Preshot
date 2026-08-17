import { describe, expect, it, vi } from "vitest";
import { createBlockNotePlanService } from "./service";

describe("BlockNote plan service", () => {
  it("creates schema v13 for missing plans and blocks older schemas", async () => {
    const repository = {
      loadRawPlan: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ schemaVersion: 12 }),
      saveRawPlan: vi.fn(),
    };
    const service = createBlockNotePlanService({
      repository,
      imageStore: {
        importImage: vi.fn(),
        loadImage: vi.fn(),
        removeImage: vi.fn(),
      },
      createId: () => "block-1",
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    await expect(service.loadPlan("C:\\new", "New")).resolves.toMatchObject({
      status: "missing",
      plan: { schemaVersion: 13, title: "New" },
    });
    await expect(service.loadPlan("C:\\old", "Old")).resolves.toEqual({
      status: "incompatible",
      foundSchemaVersion: 12,
      requiredSchemaVersion: 13,
    });
  });
});
