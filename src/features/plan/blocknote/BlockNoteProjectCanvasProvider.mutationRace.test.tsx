// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../../app/theme/ThemeProvider";
import type { BlockNotePlanService } from "../../../domain/plan/blocknote/service";
import type { ProjectPlanV14 } from "../../../domain/plan/canvas/blockDocument";
import type { ReferenceImage } from "../../../domain/plan/canvas/models";
import type { SettingsRepository } from "../../../domain/settings/ports";
import type { ImageGroupBlockController } from "./ImageGroupBlockContext";
import { useImageDragPreview } from "./ImageDragPreviewContext";

vi.mock("./imageHydration", () => ({
  applyMeasuredImages: (plan: ProjectPlanV14) => Promise.resolve(plan),
}));

vi.mock("./BlockNoteDocumentEditor", () => ({
  BlockNoteDocumentEditor: ({
    imageGroupController,
  }: {
    imageGroupController: ImageGroupBlockController;
  }) => {
    const drag = useImageDragPreview();
    const source = imageGroupController.getGroup("source");
    const target = imageGroupController.getGroup("target");
    const moving = [...(source?.images ?? []), ...(target?.images ?? [])]
      .find((image) => image.id === "moving");
    return (
      <div aria-label="方案正文" role="group">
        <output data-testid="source-order">
          {source?.images.map((image) => image.id).join(",")}
        </output>
        <output data-testid="target-order">
          {target?.images.map((image) => image.id).join(",")}
        </output>
        <output data-testid="moving-ratio">{moving?.aspectRatio}</output>
        <output data-testid="drag-status">{drag.state.status}</output>
        <button onClick={() => imageGroupController.addImages("source")}>
          导入测试图片
        </button>
        <button onClick={() => imageGroupController.captureImage?.("source")}>
          截图测试图片
        </button>
        <button
          onClick={() => imageGroupController.removeImage("source", "remove")}
        >
          删除测试图片
        </button>
        <button
          onClick={() =>
            imageGroupController.moveImage("source", "moving", "target", 0)}
        >
          完成重新排序
        </button>
        <button
          onClick={() => {
            if (moving) {
              imageGroupController.openImage(
                moving.id === "moving" &&
                    source?.images.some((image) => image.id === moving.id)
                  ? "source"
                  : "target",
                moving.id,
                moving.file,
              );
            }
          }}
        >
          打开裁剪
        </button>
        <button
          onClick={() =>
            drag.start({
              activeImageId: "moving",
              sourceGroupId: "source",
              sourceIndex: 0,
            })}
        >
          开始排序预览
        </button>
        <button
          onClick={() => drag.project({ groupId: "target", index: 0 })}
        >
          设置排序预览
        </button>
      </div>
    );
  },
}));

import { BlockNoteProjectCanvasProvider } from "./BlockNoteProjectCanvasProvider";

const settings: SettingsRepository = {
  read: vi.fn().mockResolvedValue({ theme: "light" }),
  write: vi.fn().mockResolvedValue(undefined),
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function image(id: string, aspectRatio = 1.5): ReferenceImage {
  return {
    id,
    file: `references/${id}.png`,
    aspectRatio,
    sourceWidth: 900,
    sourceHeight: 600,
    frameWidth: 135,
    frameHeight: 90,
    crop: { x: 0, y: 0, width: 1, height: 1 },
  };
}

function initialPlan(): ProjectPlanV14 {
  return {
    schemaVersion: 14,
    title: "Race",
    document: {
      format: "preshot-blocks",
      version: 2,
      blocks: [
        {
          id: "source-block",
          type: "imageGroup",
          props: { groupId: "source" },
          content: undefined,
          children: [],
        },
        {
          id: "target-block",
          type: "imageGroup",
          props: { groupId: "target" },
          content: undefined,
          children: [],
        },
      ],
    },
    imageGroups: [
      {
        id: "source",
        name: "Source",
        type: "reference",
        x: 0,
        width: 400,
        height: 200,
        description: "",
        images: [image("moving"), image("remove")],
      },
      {
        id: "target",
        name: "Target",
        type: "reference",
        x: 0,
        width: 400,
        height: 200,
        description: "",
        images: [image("after")],
      },
    ],
  };
}

function replaceGroup(
  plan: ProjectPlanV14,
  groupId: string,
  update: (
    group: ProjectPlanV14["imageGroups"][number],
  ) => ProjectPlanV14["imageGroups"][number],
): ProjectPlanV14 {
  return {
    ...plan,
    imageGroups: plan.imageGroups.map((group) =>
      group.id === groupId ? update(group) : group
    ),
  };
}

function serviceWith(
  overrides: Partial<BlockNotePlanService>,
  saved: ProjectPlanV14[] = [],
): BlockNotePlanService {
  return {
    loadPlan: vi.fn().mockResolvedValue({
      status: "loaded",
      plan: initialPlan(),
    }),
    savePlan: vi.fn(async (_projectPath, plan) => {
      saved.push(structuredClone(plan));
    }),
    loadImage: vi.fn().mockResolvedValue("data:image/png;base64,AA"),
    importMedia: vi.fn(),
    loadMedia: vi.fn(),
    importImages: vi.fn(),
    commitImageCrop: vi.fn(),
    removeImage: vi.fn(),
    removeGroup: vi.fn(),
    purgeDetachedGroups: vi.fn().mockResolvedValue(undefined),
    purgeDetachedMedia: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderProvider(
  service: BlockNotePlanService,
  options: {
    projectPath?: string;
    screenCapture?: {
      start(): Promise<string>;
      poll(token: string): Promise<
        { status: "pending" } | { status: "captured"; path: string }
      >;
      cancel(token: string): Promise<void>;
      discard(path: string): Promise<void>;
    };
  } = {},
) {
  const projectPath = options.projectPath ?? "C:\\Race";
  return render(
    <ThemeProvider repository={settings}>
      <BlockNoteProjectCanvasProvider
        docxExporter={{ implementation: "blocknote-docx", export: vi.fn() }}
        docxSaver={{ save: vi.fn() }}
        exporter={{ implementation: "react-pdf", export: vi.fn() }}
        key={projectPath}
        logger={{
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        }}
        longImageExporter={{ export: vi.fn() }}
        longImageSaver={{ save: vi.fn() }}
        picker={{
          pickImageFile: vi.fn().mockResolvedValue(null),
          pickImageFiles: vi.fn().mockResolvedValue(["C:\\picked.png"]),
        }}
        projectDirectoryRevealer={{
          revealProjectDirectory: vi.fn().mockResolvedValue(undefined),
        }}
        projectName="Race"
        projectPath={projectPath}
        saver={{ save: vi.fn() }}
        screenCapture={options.screenCapture}
        service={service}
      />
    </ThemeProvider>,
  );
}

async function expectReorderedWith(sourceOrder: string) {
  await waitFor(() =>
    expect(screen.getByTestId("source-order")).toHaveTextContent(sourceOrder)
  );
  expect(screen.getByTestId("target-order")).toHaveTextContent(
    "moving,after",
  );
}

describe("BlockNote image mutation serialization", () => {
  it("keeps a completed reorder when an older import resolves", async () => {
    const gate = deferred<void>();
    const imported = image("imported");
    const saved: ProjectPlanV14[] = [];
    const importImages = vi.fn(async (
      _projectPath: string,
      getLatestPlan: () => ProjectPlanV14,
    ) => {
      await gate.promise;
      const plan = replaceGroup(getLatestPlan(), "source", (group) => ({
        ...group,
        images: [...group.images, imported],
      }));
      saved.push(structuredClone(plan));
      return {
        plan,
        images: [{ image: imported, dataUrl: "data:image/png;base64,new" }],
      };
    });
    const service = serviceWith({ importImages }, saved);
    renderProvider(service);
    await screen.findByRole("button", { name: "导入测试图片" });

    fireEvent.click(screen.getByRole("button", { name: "导入测试图片" }));
    await waitFor(() => expect(importImages).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "完成重新排序" }));
    gate.resolve();

    await expectReorderedWith("remove,imported");
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(saved.at(-1)?.imageGroups.map((group) =>
      group.images.map(({ id }) => id)
    )).toEqual([["remove", "imported"], ["moving", "after"]]);
  });

  it("keeps capture import, reorder, discard, and persistence atomic", async () => {
    const gate = deferred<void>();
    const captured = image("captured");
    const saved: ProjectPlanV14[] = [];
    const discard = vi.fn().mockResolvedValue(undefined);
    const importImages = vi.fn(async (
      _projectPath: string,
      getLatestPlan: () => ProjectPlanV14,
    ) => {
      await gate.promise;
      const plan = replaceGroup(getLatestPlan(), "source", (group) => ({
        ...group,
        images: [...group.images, captured],
      }));
      saved.push(structuredClone(plan));
      return {
        plan,
        images: [{ image: captured, dataUrl: "data:image/png;base64,capture" }],
      };
    });
    renderProvider(serviceWith({ importImages }, saved), {
      screenCapture: {
        start: vi.fn().mockResolvedValue("capture-token"),
        poll: vi.fn().mockResolvedValue({
          status: "captured",
          path: "C:\\capture.png",
        }),
        cancel: vi.fn().mockResolvedValue(undefined),
        discard,
      },
    });
    await screen.findByRole("button", { name: "截图测试图片" });

    fireEvent.click(screen.getByRole("button", { name: "截图测试图片" }));
    await waitFor(() => expect(importImages).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "完成重新排序" }));
    gate.resolve();

    await expectReorderedWith("remove,captured");
    await waitFor(() =>
      expect(discard).toHaveBeenCalledWith("C:\\capture.png")
    );
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(saved.at(-1)?.imageGroups[1].images.map(({ id }) => id)).toEqual(
      ["moving", "after"],
    );
  });

  it("keeps a reorder while a deferred removal commits exactly once", async () => {
    const gate = deferred<void>();
    const saved: ProjectPlanV14[] = [];
    const removeImage = vi.fn(async (
      _projectPath: string,
      getLatestPlan: () => ProjectPlanV14,
    ) => {
      await gate.promise;
      const plan = replaceGroup(getLatestPlan(), "source", (group) => ({
        ...group,
        images: group.images.filter(({ id }) => id !== "remove"),
      }));
      saved.push(structuredClone(plan));
      return plan;
    });
    renderProvider(serviceWith({ removeImage }, saved));
    await screen.findByRole("button", { name: "删除测试图片" });

    fireEvent.click(screen.getByRole("button", { name: "删除测试图片" }));
    await waitFor(() => expect(removeImage).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "完成重新排序" }));
    gate.resolve();

    await expectReorderedWith("");
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(saved).toHaveLength(2));
    const ids = saved.at(-1)?.imageGroups.flatMap((group) =>
      group.images.map(({ id }) => id)
    );
    expect(ids).toEqual(["moving", "after"]);
    expect(new Set(ids).size).toBe(ids?.length);
  });

  it("rebases a deferred crop onto the latest reorder", async () => {
    const user = userEvent.setup();
    const gate = deferred<void>();
    const saved: ProjectPlanV14[] = [];
    const commitImageCrop = vi.fn(async (
      _projectPath: string,
      getLatestPlan: () => ProjectPlanV14,
    ) => {
      await gate.promise;
      const plan = {
        ...getLatestPlan(),
        imageGroups: getLatestPlan().imageGroups.map((group) => ({
          ...group,
          images: group.images.map((entry) =>
            entry.id === "moving"
              ? {
                  ...entry,
                  aspectRatio: 1,
                  sourceWidth: 600,
                  sourceHeight: 600,
                  frameWidth: 90,
                  crop: { x: 0, y: 0, width: 1, height: 1 },
                }
              : entry
          ),
        })),
      };
      const cropped = plan.imageGroups[0]!.images[0]!;
      saved.push(structuredClone(plan));
      return {
        plan,
        image: cropped,
        dataUrl: "data:image/png;base64,cropped",
      };
    });
    renderProvider(serviceWith({ commitImageCrop }, saved));
    await screen.findByRole("button", { name: "打开裁剪" });

    await user.click(screen.getByRole("button", { name: "打开裁剪" }));
    await user.click(await screen.findByRole("button", { name: "裁剪" }));
    await user.click(screen.getByRole("button", { name: "1:1" }));
    await user.click(screen.getByRole("button", { name: "确认裁剪" }));
    await waitFor(() => expect(commitImageCrop).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "完成重新排序" }));
    gate.resolve();

    await expectReorderedWith("remove");
    expect(screen.getByTestId("moving-ratio")).toHaveTextContent("1");
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(saved.at(-1)?.imageGroups[1].images[0]).toMatchObject({
      id: "moving",
      aspectRatio: 1,
    });
  });

  it("cancels a reorder preview when an operation changes the revision", async () => {
    const imported = image("imported");
    const service = serviceWith({
      importImages: vi.fn(async (_projectPath, getLatestPlan) => {
        const plan = replaceGroup(getLatestPlan(), "source", (group) => ({
          ...group,
          images: [...group.images, imported],
        }));
        return {
          plan,
          images: [{ image: imported, dataUrl: "data:image/png;base64,new" }],
        };
      }),
    });
    renderProvider(service);
    await screen.findByRole("button", { name: "开始排序预览" });

    fireEvent.click(screen.getByRole("button", { name: "开始排序预览" }));
    fireEvent.click(screen.getByRole("button", { name: "设置排序预览" }));
    await waitFor(() =>
      expect(screen.getByTestId("drag-status")).toHaveTextContent("dragging")
    );
    fireEvent.click(screen.getByRole("button", { name: "导入测试图片" }));

    await waitFor(() =>
      expect(screen.getByTestId("drag-status")).toHaveTextContent("idle")
    );
    expect(screen.getByTestId("source-order")).toHaveTextContent(
      "moving,remove,imported",
    );
  });

  it("retires only after queued mutation and reorder commits finish", async () => {
    const gate = deferred<void>();
    const imported = image("imported");
    const saved: ProjectPlanV14[] = [];
    const service = serviceWith({
      importImages: vi.fn(async (_projectPath, getLatestPlan) => {
        await gate.promise;
        const plan = replaceGroup(getLatestPlan(), "source", (group) => ({
          ...group,
          images: [...group.images, imported],
        }));
        saved.push(structuredClone(plan));
        return {
          plan,
          images: [{ image: imported, dataUrl: "data:image/png;base64,new" }],
        };
      }),
    }, saved);
    const view = renderProvider(service);
    await screen.findByRole("button", { name: "导入测试图片" });

    fireEvent.click(screen.getByRole("button", { name: "导入测试图片" }));
    await waitFor(() => expect(service.importImages).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "完成重新排序" }));
    view.unmount();
    expect(saved).toHaveLength(0);

    gate.resolve();
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(saved.at(-1)?.imageGroups.map((group) =>
      group.images.map(({ id }) => id)
    )).toEqual([["remove", "imported"], ["moving", "after"]]);
  });
});
