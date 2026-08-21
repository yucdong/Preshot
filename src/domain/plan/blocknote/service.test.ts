import { describe, expect, it, vi } from "vitest";
import type { ProjectPlanV14 } from "../canvas/blockDocument";
import { createBlockNotePlanService } from "./service";

function referenceImage(id: string) {
  return {
    id,
    file: `references/${id}.png`,
    aspectRatio: 1.5,
    sourceWidth: 900,
    sourceHeight: 600,
    frameWidth: 135,
    frameHeight: 90,
  };
}

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
      imageCropStore: {
        beginImageCrop: vi.fn(),
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

  it("imports a batch at the 240-unit default and grows wrapped group height", async () => {
    let id = 0;
    const saveRawPlan = vi.fn();
    const importImage = vi.fn()
      .mockResolvedValueOnce({
        file: "references/0001.png",
        dataUrl: "data:image/png;base64,one",
      })
      .mockResolvedValueOnce({
        file: "references/0002.png",
        dataUrl: "data:image/png;base64,two",
      });
    const service = createBlockNotePlanService({
      repository: { loadRawPlan: vi.fn(), saveRawPlan },
      imageStore: {
        importImage,
        loadImage: vi.fn(),
        removeImage: vi.fn(),
      },
      imageCropStore: { beginImageCrop: vi.fn() },
      mediaStore: {
        importMedia: vi.fn(),
        loadMedia: vi.fn(),
        removeMedia: vi.fn(),
      },
      createId: () => `image-${++id}`,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });
    const plan: ProjectPlanV14 = {
      schemaVersion: 14,
      title: "Import",
      document: {
        format: "preshot-blocks",
        version: 2,
        blocks: [{
          id: "block",
          type: "imageGroup",
          props: { groupId: "group" },
          content: undefined,
          children: [],
        }],
      },
      imageGroups: [{
        id: "group",
        name: "Group",
        type: "reference",
        x: 0,
        width: 500,
        height: 80,
        description: "",
        images: [],
      }],
    };

    const result = await service.importImages(
      "C:\\project",
      () => plan,
      "group",
      ["C:\\one.png", "C:\\two.png"],
    );

    expect(result.images.map(({ image }) => image)).toMatchObject([
      { id: "image-1", frameWidth: 240, frameHeight: 240 },
      { id: "image-2", frameWidth: 240, frameHeight: 240 },
    ]);
    expect(result.plan.imageGroups[0].height).toBe(505);
    expect(saveRawPlan).toHaveBeenCalledWith("C:\\project", result.plan);
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
        imageCropStore: {
          beginImageCrop: vi.fn(),
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

  it("keeps a committed crop successful when backup cleanup needs a retry", async () => {
    let persisted: ProjectPlanV14 | null = null;
    const commit = vi.fn()
      .mockRejectedValueOnce(new Error("backup locked"))
      .mockResolvedValue(undefined);
    const rollback = vi.fn();
    const warn = vi.fn();
    const saveRawPlan = vi.fn(async (
      _projectPath: string,
      plan: ProjectPlanV14,
    ) => {
      persisted = structuredClone(plan);
    });
    const beginImageCrop = vi.fn().mockResolvedValue({
      image: {
        file: "references/look.png",
        dataUrl: "data:image/png;base64,cropped",
        width: 600,
        height: 400,
      },
      commit,
      rollback,
    });
    const service = createBlockNotePlanService({
      repository: {
        loadRawPlan: vi.fn(async () => persisted),
        saveRawPlan,
      },
      imageStore: {
        importImage: vi.fn(),
        loadImage: vi.fn(),
        removeImage: vi.fn(),
      },
      imageCropStore: { beginImageCrop },
      mediaStore: {
        importMedia: vi.fn(),
        loadMedia: vi.fn(),
        removeMedia: vi.fn(),
      },
      createId: () => "id",
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn,
        error: vi.fn(),
      },
    });
    const image = {
      id: "image",
      file: "references/look.png",
      aspectRatio: 2,
      sourceWidth: 1200,
      sourceHeight: 800,
      frameWidth: 240,
      frameHeight: 120,
      frameOffsetX: -20,
      frameOffsetY: 10,
      crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    };
    const plan = {
      schemaVersion: 14 as const,
      title: "Crop",
      document: {
        format: "preshot-blocks" as const,
        version: 2 as const,
        blocks: [{
          id: "block",
          type: "imageGroup" as const,
          props: { groupId: "group" },
          content: undefined,
          children: [],
        }],
      },
      imageGroups: [{
        id: "group",
        name: "Group",
        type: "reference" as const,
        x: 0,
        width: 400,
        height: 300,
        description: "",
        images: [image, { ...image, id: "alias", frameHeight: 100 }],
      }],
    };

    const result = await service.commitImageCrop(
      "C:\\project",
      () => plan,
      "group",
      "image",
      image.crop,
    );

    expect(beginImageCrop).toHaveBeenCalledWith("C:\\project", {
      file: "references/look.png",
      bounds: { x: 300, y: 200, width: 600, height: 400 },
    });
    expect(result.dataUrl).toBe("data:image/png;base64,cropped");
    expect(result.image).toMatchObject({
      id: "image",
      file: "references/look.png",
      aspectRatio: 1.5,
      sourceWidth: 600,
      sourceHeight: 400,
      frameWidth: 180,
      frameHeight: 120,
      frameOffsetX: 0,
      frameOffsetY: 0,
      crop: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(result.plan.imageGroups[0].images[1]).toMatchObject({
      id: "alias",
      file: "references/look.png",
      frameWidth: 150,
      frameHeight: 100,
      crop: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(saveRawPlan).toHaveBeenCalledWith("C:\\project", result.plan);
    await expect(service.loadPlan("C:\\project", "Crop")).resolves.toEqual({
      status: "loaded",
      plan: result.plan,
    });
    await vi.waitFor(() => {
      expect(commit).toHaveBeenCalledTimes(2);
    });
    expect(rollback).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "BlockNote reference image crop backup cleanup deferred",
      {
        file: "references/look.png",
        error: "backup locked",
      },
    );
  });

  it("serializes crop overwrite with save and detached cleanup", async () => {
    let finishCrop!: () => void;
    const beginImageCrop = vi.fn().mockImplementation(() =>
      new Promise((resolve) => {
        finishCrop = () => resolve({
          image: {
            file: "references/look.png",
            dataUrl: "data:image/png;base64,cropped",
            width: 10,
            height: 10,
          },
          commit: vi.fn(),
          rollback: vi.fn(),
        });
      })
    );
    const saveRawPlan = vi.fn();
    const removeImage = vi.fn();
    const service = createBlockNotePlanService({
      repository: { loadRawPlan: vi.fn(), saveRawPlan },
      imageStore: {
        importImage: vi.fn(),
        loadImage: vi.fn(),
        removeImage,
      },
      imageCropStore: { beginImageCrop },
      mediaStore: {
        importMedia: vi.fn(),
        loadMedia: vi.fn(),
        removeMedia: vi.fn(),
      },
      createId: () => "id",
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });
    const image = {
      id: "image",
      file: "references/look.png",
      aspectRatio: 1,
      sourceWidth: 20,
      sourceHeight: 20,
      frameWidth: 100,
      frameHeight: 100,
    };
    const group = {
      id: "group",
      name: "Group",
      type: "reference" as const,
      x: 0,
      width: 400,
      height: 300,
      description: "",
      images: [image],
    };
    const plan = {
      schemaVersion: 14 as const,
      title: "Queue",
      document: {
        format: "preshot-blocks" as const,
        version: 2 as const,
        blocks: [{
          id: "block",
          type: "imageGroup" as const,
          props: { groupId: "group" },
          content: undefined,
          children: [],
        }],
      },
      imageGroups: [group],
    };

    const cropPromise = service.commitImageCrop(
      "C:\\project",
      () => plan,
      "group",
      "image",
      { x: 0, y: 0, width: 0.5, height: 0.5 },
    );
    const savePromise = service.savePlan("C:\\project", plan);
    const cleanupPromise = service.purgeDetachedGroups(
      "C:\\project",
      { ...plan, imageGroups: [] },
      [group],
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(saveRawPlan).not.toHaveBeenCalled();
    expect(removeImage).not.toHaveBeenCalled();

    finishCrop();
    await Promise.all([cropPromise, savePromise, cleanupPromise]);

    expect(saveRawPlan).toHaveBeenCalledTimes(2);
    expect(removeImage).toHaveBeenCalledWith(
      "C:\\project",
      "references/look.png",
    );
  });

  it("coalesces a stale queued save with crop metadata committed after it queued", async () => {
    let finishCrop!: () => void;
    const persisted: ProjectPlanV14[] = [];
    const beginImageCrop = vi.fn().mockImplementation(() =>
      new Promise((resolve) => {
        finishCrop = () => resolve({
          image: {
            file: "references/look.png",
            dataUrl: "data:image/png;base64,cropped",
            width: 2,
            height: 2,
          },
          commit: vi.fn(),
          rollback: vi.fn(),
        });
      })
    );
    const service = createBlockNotePlanService({
      repository: {
        loadRawPlan: vi.fn(),
        saveRawPlan: vi.fn(async (_projectPath, plan) => {
          persisted.push(structuredClone(plan));
        }),
      },
      imageStore: {
        importImage: vi.fn(),
        loadImage: vi.fn(),
        removeImage: vi.fn(),
      },
      imageCropStore: { beginImageCrop },
      mediaStore: {
        importMedia: vi.fn(),
        loadMedia: vi.fn(),
        removeMedia: vi.fn(),
      },
      createId: () => "id",
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });
    const plan = {
      schemaVersion: 14 as const,
      title: "Before queued save",
      document: {
        format: "preshot-blocks" as const,
        version: 2 as const,
        blocks: [{
          id: "block",
          type: "imageGroup" as const,
          props: { groupId: "group" },
          content: undefined,
          children: [],
        }],
      },
      imageGroups: [{
        id: "group",
        name: "Group",
        type: "reference" as const,
        x: 0,
        width: 400,
        height: 300,
        description: "",
        images: [{
          id: "image",
          file: "references/look.png",
          aspectRatio: 2 / 3,
          sourceWidth: 2,
          sourceHeight: 3,
          frameWidth: 80,
          frameHeight: 120,
          crop: { x: 0, y: 1 / 6, width: 1, height: 2 / 3 },
        }],
      }],
    };
    const staleSave = {
      ...plan,
      title: "Queued document edit",
    };

    const cropPromise = service.commitImageCrop(
      "C:\\project",
      () => plan,
      "group",
      "image",
      plan.imageGroups[0].images[0].crop,
    );
    const savePromise = service.savePlan("C:\\project", staleSave);
    await Promise.resolve();
    await Promise.resolve();

    finishCrop();
    const cropResult = await cropPromise;
    await savePromise;

    expect(persisted).toHaveLength(2);
    expect(persisted.at(-1)).toMatchObject({
      title: "Queued document edit",
      imageGroups: [{
        images: [{
          aspectRatio: 1,
          sourceWidth: 2,
          sourceHeight: 2,
          frameWidth: 120,
          frameHeight: 120,
          crop: { x: 0, y: 0, width: 1, height: 1 },
        }],
      }],
    });
    expect(persisted.at(-1)?.imageGroups[0].images[0]).toEqual(
      cropResult.plan.imageGroups[0].images[0],
    );
  });

  it("restores original project image bytes when crop metadata persistence fails", async () => {
    let storedBytes = "original";
    const rollback = vi.fn(async () => {
      storedBytes = "original";
    });
    const commit = vi.fn();
    const service = createBlockNotePlanService({
      repository: {
        loadRawPlan: vi.fn(),
        saveRawPlan: vi.fn().mockRejectedValue(new Error("manifest locked")),
      },
      imageStore: {
        importImage: vi.fn(),
        loadImage: vi.fn(),
        removeImage: vi.fn(),
      },
      imageCropStore: {
        beginImageCrop: vi.fn(async () => {
          storedBytes = "cropped";
          return {
            image: {
              file: "references/look.png",
              dataUrl: "data:image/png;base64,cropped",
              width: 2,
              height: 2,
            },
            commit,
            rollback,
          };
        }),
      },
      mediaStore: {
        importMedia: vi.fn(),
        loadMedia: vi.fn(),
        removeMedia: vi.fn(),
      },
      createId: () => "id",
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });
    const plan = {
      schemaVersion: 14 as const,
      title: "Rollback",
      document: {
        format: "preshot-blocks" as const,
        version: 2 as const,
        blocks: [],
      },
      imageGroups: [{
        id: "group",
        name: "Group",
        type: "reference" as const,
        x: 0,
        width: 400,
        height: 300,
        description: "",
        images: [{
          id: "image",
          file: "references/look.png",
          aspectRatio: 2 / 3,
          sourceWidth: 2,
          sourceHeight: 3,
          frameWidth: 80,
          frameHeight: 120,
        }],
      }],
    };

    await expect(service.commitImageCrop(
      "C:\\project",
      () => plan,
      "group",
      "image",
      { x: 0, y: 1 / 6, width: 1, height: 2 / 3 },
    )).rejects.toThrow(/metadata could not be saved: manifest locked/);

    expect(storedBytes).toBe("original");
    expect(rollback).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();

    const failedRollbackService = createBlockNotePlanService({
      repository: {
        loadRawPlan: vi.fn(),
        saveRawPlan: vi.fn().mockRejectedValue(new Error("manifest locked")),
      },
      imageStore: {
        importImage: vi.fn(),
        loadImage: vi.fn(),
        removeImage: vi.fn(),
      },
      imageCropStore: {
        beginImageCrop: vi.fn().mockResolvedValue({
          image: {
            file: "references/look.png",
            dataUrl: "data:image/png;base64,cropped",
            width: 2,
            height: 2,
          },
          commit: vi.fn(),
          rollback: vi.fn().mockRejectedValue(new Error("restore denied")),
        }),
      },
      mediaStore: {
        importMedia: vi.fn(),
        loadMedia: vi.fn(),
        removeMedia: vi.fn(),
      },
      createId: () => "id",
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    await expect(failedRollbackService.commitImageCrop(
      "C:\\project",
      () => plan,
      "group",
      "image",
      { x: 0, y: 1 / 6, width: 1, height: 2 / 3 },
    )).rejects.toThrow(
      /crop metadata could not be saved: manifest locked; rollback also failed: restore denied/,
    );
  });

  it("rounds paired crop edges consistently for small preset crops", async () => {
    const beginImageCrop = vi.fn().mockResolvedValue({
      image: {
        file: "references/look.png",
        dataUrl: "data:image/png;base64,cropped",
        width: 2,
        height: 2,
      },
      commit: vi.fn(),
      rollback: vi.fn(),
    });
    const service = createBlockNotePlanService({
      repository: { loadRawPlan: vi.fn(), saveRawPlan: vi.fn() },
      imageStore: {
        importImage: vi.fn(),
        loadImage: vi.fn(),
        removeImage: vi.fn(),
      },
      imageCropStore: { beginImageCrop },
      mediaStore: {
        importMedia: vi.fn(),
        loadMedia: vi.fn(),
        removeMedia: vi.fn(),
      },
      createId: () => "id",
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });
    const plan = {
      schemaVersion: 14 as const,
      title: "Small",
      document: {
        format: "preshot-blocks" as const,
        version: 2 as const,
        blocks: [],
      },
      imageGroups: [{
        id: "group",
        name: "Group",
        type: "reference" as const,
        x: 0,
        width: 400,
        height: 300,
        description: "",
        images: [{
          id: "image",
          file: "references/look.png",
          aspectRatio: 2 / 3,
          sourceWidth: 2,
          sourceHeight: 3,
          frameWidth: 80,
          frameHeight: 120,
        }],
      }],
    };

    await service.commitImageCrop(
      "C:\\project",
      () => plan,
      "group",
      "image",
      { x: 0, y: 1 / 6, width: 1, height: 2 / 3 },
    );

    expect(beginImageCrop).toHaveBeenCalledWith("C:\\project", {
      file: "references/look.png",
      bounds: { x: 0, y: 1, width: 2, height: 2 },
    });

    await service.commitImageCrop(
      "C:\\project",
      () => plan,
      "group",
      "image",
      { x: 0.1, y: 0.1, width: 0.01, height: 0.01 },
    );

    expect(beginImageCrop).toHaveBeenNthCalledWith(2, "C:\\project", {
      file: "references/look.png",
      bounds: { x: 0, y: 0, width: 1, height: 1 },
    });
  });

  it("rejects invalid normalized crop bounds before touching storage", async () => {
    const beginImageCrop = vi.fn();
    const service = createBlockNotePlanService({
      repository: { loadRawPlan: vi.fn(), saveRawPlan: vi.fn() },
      imageStore: {
        importImage: vi.fn(),
        loadImage: vi.fn(),
        removeImage: vi.fn(),
      },
      imageCropStore: { beginImageCrop },
      mediaStore: {
        importMedia: vi.fn(),
        loadMedia: vi.fn(),
        removeMedia: vi.fn(),
      },
      createId: () => "id",
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });
    const plan = {
      schemaVersion: 14 as const,
      title: "Bounds",
      document: {
        format: "preshot-blocks" as const,
        version: 2 as const,
        blocks: [{
          id: "block",
          type: "imageGroup" as const,
          props: { groupId: "group" },
          content: undefined,
          children: [],
        }],
      },
      imageGroups: [{
        id: "group",
        name: "Group",
        type: "reference" as const,
        x: 0,
        width: 400,
        height: 300,
        description: "",
        images: [{
          id: "image",
          file: "references/look.png",
          aspectRatio: 1,
          sourceWidth: 20,
          sourceHeight: 20,
          frameWidth: 100,
          frameHeight: 100,
        }],
      }],
    };

    await expect(service.commitImageCrop(
      "C:\\project",
      () => plan,
      "group",
      "image",
      { x: 0.75, y: 0, width: 0.5, height: 1 },
    )).rejects.toThrow(/crop bounds are invalid/);
    expect(beginImageCrop).not.toHaveBeenCalled();
  });

  it("rebases imported images onto the latest group order before persistence", async () => {
    let releaseImport!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseImport = resolve;
    });
    const saveRawPlan = vi.fn();
    const service = createBlockNotePlanService({
      repository: { loadRawPlan: vi.fn(), saveRawPlan },
      imageStore: {
        importImage: vi.fn(async () => {
          await gate;
          return {
            file: "references/imported.png",
            dataUrl: "data:image/png;base64,imported",
          };
        }),
        loadImage: vi.fn(),
        removeImage: vi.fn(),
      },
      imageCropStore: { beginImageCrop: vi.fn() },
      mediaStore: {
        importMedia: vi.fn(),
        loadMedia: vi.fn(),
        removeMedia: vi.fn(),
      },
      createId: () => "imported",
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });
    const original: ProjectPlanV14 = {
      schemaVersion: 14,
      title: "Latest",
      document: {
        format: "preshot-blocks",
        version: 2,
        blocks: [],
      },
      imageGroups: [{
        id: "group",
        name: "Group",
        type: "reference",
        x: 0,
        width: 500,
        height: 300,
        description: "",
        images: [referenceImage("first"), referenceImage("second")],
      }],
    };
    let latest = original;
    const operation = service.importImages(
      "C:\\project",
      () => latest,
      "group",
      ["C:\\source.png"],
    );
    latest = {
      ...original,
      imageGroups: [{
        ...original.imageGroups[0]!,
        images: [
          original.imageGroups[0]!.images[1]!,
          original.imageGroups[0]!.images[0]!,
        ],
      }],
    };

    releaseImport();
    const result = await operation;

    expect(result.plan.imageGroups[0]!.images.map(({ id }) => id)).toEqual([
      "second",
      "first",
      "imported",
    ]);
    expect(saveRawPlan).toHaveBeenCalledWith("C:\\project", result.plan);
  });

  it("rolls back every copied image when a later import fails", async () => {
    const removeImage = vi.fn().mockResolvedValue(undefined);
    const saveRawPlan = vi.fn();
    const service = createBlockNotePlanService({
      repository: { loadRawPlan: vi.fn(), saveRawPlan },
      imageStore: {
        importImage: vi.fn()
          .mockResolvedValueOnce({
            file: "references/first.png",
            dataUrl: "data:image/png;base64,first",
          })
          .mockRejectedValueOnce(new Error("second copy failed")),
        loadImage: vi.fn(),
        removeImage,
      },
      imageCropStore: { beginImageCrop: vi.fn() },
      mediaStore: {
        importMedia: vi.fn(),
        loadMedia: vi.fn(),
        removeMedia: vi.fn(),
      },
      createId: () => "imported",
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });
    const plan: ProjectPlanV14 = {
      schemaVersion: 14,
      title: "Rollback",
      document: {
        format: "preshot-blocks",
        version: 2,
        blocks: [],
      },
      imageGroups: [{
        id: "group",
        name: "Group",
        type: "reference",
        x: 0,
        width: 500,
        height: 300,
        description: "",
        images: [],
      }],
    };

    await expect(service.importImages(
      "C:\\project",
      () => plan,
      "group",
      ["C:\\first.png", "C:\\second.png"],
    )).rejects.toThrow("Unable to import reference images: second copy failed");

    expect(removeImage).toHaveBeenCalledOnce();
    expect(removeImage).toHaveBeenCalledWith(
      "C:\\project",
      "references/first.png",
    );
    expect(saveRawPlan).not.toHaveBeenCalled();
  });
});
