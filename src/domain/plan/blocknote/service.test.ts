import { describe, expect, it, vi } from "vitest";
import { createBlockNotePlanService } from "./service";

describe("BlockNote plan service", () => {
  it("creates schema v14, migrates v13, and blocks older schemas", async () => {
    const repository = {
      loadRawPlan: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          schemaVersion: 13,
          title: "Current",
          document: {
            format: "preshot-blocks",
            version: 1,
            blocks: [{
              id: "block-1",
              type: "paragraph",
              props: {},
              content: [],
              children: [],
            }],
          },
          imageGroups: [],
        })
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
      mediaStore: {
        importMedia: vi.fn(),
        loadMedia: vi.fn(),
        removeMedia: vi.fn(),
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
      plan: { schemaVersion: 14, title: "New" },
    });
    await expect(service.loadPlan("C:\\current", "Current")).resolves
      .toMatchObject({
        status: "migrated",
        plan: {
          schemaVersion: 14,
          document: { version: 2 },
        },
      });
    expect(repository.saveRawPlan).toHaveBeenCalledWith(
      "C:\\current",
      expect.objectContaining({ schemaVersion: 14 }),
    );
    await expect(service.loadPlan("C:\\old", "Old")).resolves.toEqual({
      status: "incompatible",
      foundSchemaVersion: 12,
      requiredSchemaVersion: 14,
    });
  });

  it("purges only detached project media files", async () => {
      const removeMedia = vi.fn();
      const service = createBlockNotePlanService({
        repository: {
          loadRawPlan: vi.fn(),
          saveRawPlan: vi.fn(),
        },
        imageStore: {
          importImage: vi.fn(),
          loadImage: vi.fn(),
          removeImage: vi.fn(),
        },
        mediaStore: {
          importMedia: vi.fn(),
          loadMedia: vi.fn(),
          removeMedia,
        },
        createId: () => "id",
        logger: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      });
      const activePlan = {
        schemaVersion: 14 as const,
        title: "Media",
        document: {
          format: "preshot-blocks" as const,
          version: 2 as const,
          blocks: [{
            id: "audio",
            type: "audio" as const,
            props: {
              name: "keep.mp3",
              url: "media/keep.mp3",
              caption: "",
              showPreview: true,
            },
            content: undefined,
            children: [],
          }],
        },
        imageGroups: [],
      };

      await service.purgeDetachedMedia("C:\\project", activePlan, [
        "media/keep.mp3",
        "media/remove.mp4",
        "media/remove.mp4",
      ]);

      expect(removeMedia).toHaveBeenCalledTimes(1);
      expect(removeMedia).toHaveBeenCalledWith(
        "C:\\project",
        "media/remove.mp4",
      );
  });
});
