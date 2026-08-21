// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../../app/theme/ThemeProvider";
import type { BlockNotePlanService } from "../../../domain/plan/blocknote/service";
import type { LongImageExportResult } from "../../../domain/plan/blocknote/longImageExportContract";
import type { ProjectPlanV14 } from "../../../domain/plan/canvas/blockDocument";
import type { SettingsRepository } from "../../../domain/settings/ports";
import type { BlockNoteLongImageExporter } from "../../../infrastructure/longImage/BlockNoteLongImageExporter";
import type { ImageGroupBlockController } from "./ImageGroupBlockContext";
import {
  useImageDragPreview,
} from "./ImageDragPreviewContext";

vi.mock("./BlockNoteDocumentEditor", () => ({
  BlockNoteDocumentEditor({
    imageGroupController,
  }: {
    imageGroupController: ImageGroupBlockController;
  }) {
    const drag = useImageDragPreview();
    const source = imageGroupController.getGroup("source");
    const target = imageGroupController.getGroup("target");
    return (
      <div aria-label="方案正文" role="group">
        <output data-testid="drag-status">{drag.state.status}</output>
        <output data-testid="drag-target">
          {drag.state.target
            ? `${drag.state.target.groupId}:${drag.state.target.index}`
            : "none"}
        </output>
        <output data-testid="drag-group-order">
          {drag.state.transaction?.snapshot.groupOrder.join(",") ?? "none"}
        </output>
        <output data-testid="source-images">
          {source?.images.map((image) => image.id).join(",")}
        </output>
        <output data-testid="target-images">
          {target?.images.map((image) => image.id).join(",")}
        </output>
        <button
          onClick={() => drag.start({
            activeImageId: "moving",
            sourceGroupId: "source",
            sourceIndex: 1,
          })}
          type="button"
        >
          开始图片拖动
        </button>
        <button
          onClick={() => drag.project({ groupId: "target", index: 0 })}
          type="button"
        >
          预览目标
        </button>
        <button onClick={() => drag.commit()} type="button">
          提交图片拖动
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

const plan: ProjectPlanV14 = {
  schemaVersion: 14,
  title: "Editorial",
  document: {
    format: "preshot-blocks",
    version: 2,
    blocks: [{
      id: "columns",
      type: "columnList",
      props: {},
      content: undefined,
      children: [
        {
          id: "target-column",
          type: "column",
          props: { width: 1 },
          content: undefined,
          children: [{
            id: "target-block",
            type: "imageGroup",
            props: { groupId: "target" },
            content: undefined,
            children: [],
          }],
        },
        {
          id: "source-column",
          type: "column",
          props: { width: 1 },
          content: undefined,
          children: [{
            id: "source-block",
            type: "imageGroup",
            props: { groupId: "source" },
            content: undefined,
            children: [],
          }],
        },
      ],
    }],
  },
  imageGroups: [
    {
      id: "source",
      name: "Source",
      type: "reference",
      x: 0,
      width: 300,
      height: 120,
      description: "",
      images: [
        {
          id: "before",
          file: "references/before.png",
          aspectRatio: 1.5,
          sourceWidth: 900,
          sourceHeight: 600,
          frameWidth: 135,
          frameHeight: 90,
        },
        {
          id: "moving",
          file: "references/moving.png",
          aspectRatio: 1.5,
          sourceWidth: 900,
          sourceHeight: 600,
          frameWidth: 135,
          frameHeight: 90,
          crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
        },
      ],
    },
    {
      id: "target",
      name: "Target",
      type: "reference",
      x: 0,
      width: 300,
      height: 120,
      description: "",
      images: [{
        id: "after",
        file: "references/after.png",
        aspectRatio: 1.5,
        sourceWidth: 900,
        sourceHeight: 600,
        frameWidth: 135,
        frameHeight: 90,
      }],
    },
  ],
};

function serviceWithSave(savePlan: BlockNotePlanService["savePlan"]) {
  return {
    loadPlan: vi.fn().mockResolvedValue({
      status: "loaded" as const,
      plan: structuredClone(plan),
    }),
    savePlan,
    loadImage: vi.fn().mockResolvedValue("data:image/png;base64,AA"),
    importMedia: vi.fn(),
    loadMedia: vi.fn(),
    importImages: vi.fn(),
    commitImageCrop: vi.fn(),
    removeImage: vi.fn(),
    removeGroup: vi.fn(),
    purgeDetachedGroups: vi.fn(),
    purgeDetachedMedia: vi.fn(),
  } satisfies BlockNotePlanService;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BlockNoteProjectCanvasProvider image drag transaction", () => {
  it("does not save previews and becomes dirty only after one committed move", async () => {
    class MeasuredImage {
      naturalWidth = 900;
      naturalHeight = 600;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }

      decode() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal("Image", MeasuredImage);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) =>
        window.setTimeout(() => callback(0), 0)),
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((id: number) => window.clearTimeout(id)),
    );
    const savePlan = vi.fn().mockResolvedValue(undefined);
    const service = serviceWithSave(savePlan);
    const pdfExport = vi.fn().mockResolvedValue(Uint8Array.of(1));
    const docxExport = vi.fn().mockResolvedValue(Uint8Array.of(2));
    const longImageExport = vi.fn<BlockNoteLongImageExporter["export"]>(
      (_request) =>
        new Promise<LongImageExportResult>(() => undefined),
    );

    render(
      <ThemeProvider repository={settings}>
        <BlockNoteProjectCanvasProvider
          docxExporter={{
            implementation: "blocknote-docx",
            export: docxExport,
          }}
          docxSaver={{ save: vi.fn().mockResolvedValue(null) }}
          exporter={{ implementation: "react-pdf", export: pdfExport }}
          logger={{
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
          }}
          longImageExporter={{ export: longImageExport }}
          longImageSaver={{ save: vi.fn() }}
          picker={{
            pickImageFile: vi.fn().mockResolvedValue(null),
            pickImageFiles: vi.fn().mockResolvedValue(null),
          }}
          projectDirectoryRevealer={{
            revealProjectDirectory: vi.fn().mockResolvedValue(undefined),
          }}
          projectName="Editorial"
          projectPath={"C:\\Editorial"}
          saver={{ save: vi.fn().mockResolvedValue(null) }}
          service={service}
        />
      </ThemeProvider>,
    );

    expect(
      await screen.findByRole("button", { name: "开始图片拖动" }),
    ).toBeVisible();
    await waitFor(() =>
      expect(screen.getByTestId("save-status")).toHaveTextContent("已保存"));

    fireEvent.click(screen.getByRole("button", { name: "开始图片拖动" }));
    expect(screen.getByTestId("drag-group-order")).toHaveTextContent(
      "target,source",
    );
    expect(screen.getByTestId("image-drag-announcement")).toHaveTextContent(
      "第 2 个图片组“Source”",
    );
    fireEvent.click(screen.getByRole("button", { name: "预览目标" }));
    await waitFor(() =>
      expect(screen.getByTestId("drag-target")).toHaveTextContent("target:0"));

    expect(savePlan).not.toHaveBeenCalled();
    expect(screen.getByTestId("source-images")).toHaveTextContent(
      "before,moving",
    );
    expect(screen.getByTestId("target-images")).toHaveTextContent("after");
    expect(screen.getByTestId("save-status")).toHaveTextContent("已保存");

    fireEvent.click(screen.getByRole("button", { name: "提交图片拖动" }));

    await waitFor(() =>
      expect(screen.getByTestId("source-images")).toHaveTextContent("before"));
    expect(screen.getByTestId("target-images")).toHaveTextContent(
      "moving,after",
    );
    expect(screen.getByTestId("save-status")).toHaveTextContent("未保存");
    expect(savePlan).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { ctrlKey: true, key: "z" });
    await waitFor(() =>
      expect(screen.getByTestId("source-images")).toHaveTextContent(
        "before,moving",
      ));
    expect(screen.getByTestId("target-images")).toHaveTextContent("after");
    expect(screen.getByTestId("save-status")).toHaveTextContent("未保存");
    expect(savePlan).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "开始图片拖动" }));
    fireEvent.click(screen.getByRole("button", { name: "预览目标" }));
    await waitFor(() =>
      expect(screen.getByTestId("drag-target")).toHaveTextContent("target:0"));
    fireEvent.click(screen.getByRole("button", { name: "提交图片拖动" }));
    await waitFor(() =>
      expect(screen.getByTestId("target-images")).toHaveTextContent(
        "moving,after",
      ));

    fireEvent.keyDown(window, { ctrlKey: true, key: "s" });
    await waitFor(() => expect(savePlan).toHaveBeenCalledTimes(1));
    expect(savePlan).toHaveBeenCalledWith(
      "C:\\Editorial",
      expect.objectContaining({
        imageGroups: expect.arrayContaining([
          expect.objectContaining({
            id: "target",
            images: expect.arrayContaining([
              expect.objectContaining({ id: "moving" }),
            ]),
          }),
        ]),
      }),
    );

    const expectedOrder = [
      ["source", ["before"]],
      ["target", ["moving", "after"]],
    ];
    const planOrder = (value: ProjectPlanV14) =>
      value.imageGroups.map((group) => [
        group.id,
        group.images.map((image) => image.id),
      ]);

    fireEvent.click(screen.getByRole("button", { name: "导出" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "导出 PDF" }));
    await waitFor(() => expect(pdfExport).toHaveBeenCalledTimes(1));
    expect(planOrder(pdfExport.mock.calls[0]![0])).toEqual(expectedOrder);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "导出" })).toBeVisible());

    fireEvent.click(screen.getByRole("button", { name: "导出" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "导出 DOCX" }));
    await waitFor(() => expect(docxExport).toHaveBeenCalledTimes(1));
    expect(planOrder(docxExport.mock.calls[0]![0])).toEqual(expectedOrder);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "导出" })).toBeVisible());

    fireEvent.click(screen.getByRole("button", { name: "导出" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "导出长图" }));
    fireEvent.click(screen.getByRole("button", { name: "开始导出" }));
    await waitFor(() => expect(longImageExport).toHaveBeenCalledTimes(1));
    const longImageCall = longImageExport.mock.lastCall;
    expect(longImageCall).toBeDefined();
    if (!longImageCall) {
      throw new Error("Expected one long-image export request.");
    }
    expect(planOrder(longImageCall[0].plan)).toEqual(expectedOrder);
  });
});
