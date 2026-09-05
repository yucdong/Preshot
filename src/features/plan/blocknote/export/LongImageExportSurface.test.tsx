// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  PreshotBlock,
  ProjectPlanV14,
} from "../../../../domain/plan/canvas/blockDocument";
import { preshotBlockNoteSchema } from "../preshotBlockNoteSchema";
import { LongImageExportSurface } from "./LongImageExportSurface";
import {
  longImageExportContentWidth,
  measureLongImageExportSurface,
  validateLongImageExportAssets,
} from "./longImageExportModel";

const LOCAL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const LOCAL_AUDIO = "data:audio/wav;base64,UklGRg==";
const LOCAL_VIDEO = "data:video/mp4;base64,AAAA";
const LOCAL_FILE = "data:application/octet-stream;base64,AA==";

function textBlock(
  id: string,
  type: PreshotBlock["type"],
  text: string,
  props: PreshotBlock["props"] = {},
): PreshotBlock {
  return {
    id,
    type,
    props,
    content: [{ type: "text", text, styles: {} }],
    children: [],
  };
}

function complexPlan(): ProjectPlanV14 {
  const headings = Array.from({ length: 6 }, (_, index) =>
    textBlock(
      `heading-${index + 1}`,
      "heading",
      `中文标题 ${index + 1}`,
      { level: index + 1 },
    ));
  return {
    schemaVersion: 15,
    artifacts: [],
    title: "长图导出测试",
    document: {
      format: "preshot-blocks",
      version: 3,
      blocks: [
        textBlock("paragraph", "paragraph", "中文正文与字体测试"),
        ...headings,
        textBlock("bullet", "bulletListItem", "无序列表"),
        textBlock("numbered", "numberedListItem", "有序列表"),
        textBlock("check", "checkListItem", "检查列表", { checked: true }),
        textBlock("toggle", "toggleListItem", "折叠列表"),
        textBlock("quote", "quote", "引用内容"),
        textBlock("code", "codeBlock", "const 拍摄 = true;", {
          language: "typescript",
        }),
        {
          id: "table",
          type: "table",
          props: {},
          content: {
            type: "tableContent",
            columnWidths: [160, 180],
            rows: [{
              cells: [
                [{ type: "text", text: "镜头", styles: {} }],
                [{ type: "text", text: "备注", styles: {} }],
              ],
            }],
          },
          children: [],
        },
        {
          id: "native-image",
          type: "image",
          props: {
            caption: "静态图片",
            name: "native.png",
            previewWidth: 320,
            showPreview: true,
            url: "media/native.png",
          },
          content: undefined,
          children: [],
        },
        {
          id: "native-audio",
          type: "audio",
          props: {
            caption: "环境声",
            name: "ambient.wav",
            showPreview: true,
            url: "media/ambient.wav",
          },
          content: undefined,
          children: [],
        },
        {
          id: "native-video",
          type: "video",
          props: {
            caption: "机位视频",
            name: "camera.mp4",
            previewWidth: 480,
            showPreview: true,
            url: "media/camera.mp4",
          },
          content: undefined,
          children: [],
        },
        {
          id: "native-file",
          type: "file",
          props: {
            caption: "附件",
            name: "call-sheet.bin",
            showPreview: false,
            url: "media/call-sheet.bin",
          },
          content: undefined,
          children: [],
        },
        {
          id: "image-group-block",
          type: "imageGroup",
          props: { groupId: "group-1" },
          content: undefined,
          children: [],
        },
      ],
    },
    imageGroups: [{
      id: "group-1",
      name: "参考图",
      type: "reference",
      x: 12,
      width: 400,
      height: 260,
      frameOffsetY: 4,
      description: "",
      images: [
        {
          id: "first",
          file: "references/0001.png",
          aspectRatio: 2,
          frameWidth: 200,
          frameHeight: 100,
          crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
        },
        {
          id: "second",
          file: "references/0002.png",
          aspectRatio: 1,
          frameWidth: 200,
          frameHeight: 120,
        },
      ],
    }],
  };
}

const assets = {
  "media/native.png": LOCAL_PNG,
  "media/ambient.wav": LOCAL_AUDIO,
  "media/camera.mp4": LOCAL_VIDEO,
  "media/call-sheet.bin": LOCAL_FILE,
  "references/0001.png": LOCAL_PNG,
  "references/0002.png": LOCAL_PNG,
};

describe("LongImageExportSurface", () => {
  it("renders the complete schema-14 document with export-only boundaries", async () => {
    const plan = complexPlan();
    const onSurfaceReady = vi.fn();
    const { container } = render(
      <LongImageExportSurface
        onSurfaceReady={onSurfaceReady}
        plan={plan}
        resolvedAssets={assets}
      />,
    );

    expect(await screen.findByText("中文正文与字体测试")).toBeVisible();
    for (let level = 1; level <= 6; level += 1) {
      const heading = screen.getByText(`中文标题 ${level}`);
      expect(heading.tagName).toBe(`H${level}`);
    }
    expect(screen.getByText("无序列表")).toBeVisible();
    expect(screen.getByText("有序列表")).toBeVisible();
    expect(screen.getByText("引用内容")).toBeVisible();
    expect(screen.getByText("const 拍摄 = true;")).toBeVisible();
    expect(screen.getByText("镜头")).toBeVisible();

    await waitFor(() => {
      expect(onSurfaceReady).toHaveBeenCalled();
      expect(
        container.querySelectorAll("[data-preshot-export-top-level-block]"),
      ).toHaveLength(plan.document.blocks.length);
    });
    expect(
      container.querySelectorAll("[data-preshot-export-atomic-block]"),
    ).toHaveLength(7);
    expect(
      container.querySelectorAll("[data-preshot-export-image-group-row]"),
    ).toHaveLength(2);
  });

  it("uses exact geometry, local static media, and control-free image parity", async () => {
    const { container } = render(
      <LongImageExportSurface
        plan={complexPlan()}
        resolvedAssets={assets}
      />,
    );
    const surface = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(
        "[data-preshot-long-image-export-surface]",
      );
      expect(element).not.toBeNull();
      return element!;
    });
    const documentElement = surface.querySelector<HTMLElement>(
      "[data-preshot-export-document]",
    )!;

    expect(surface).toHaveStyle({ width: "900px" });
    expect(surface.dataset.preshotExportContentWidth).toBe("840");
    expect(documentElement).toHaveStyle({
      padding: "36px",
      width: "1080px",
    });
    expect(documentElement.style.zoom).toBe(String(900 / 1080));
    expect(surface.querySelector("[contenteditable='true']")).toBeNull();
    expect(surface.querySelector(".bn-editor")).toHaveAttribute(
      "tabindex",
      "-1",
    );
    expect(surface.querySelector(".bn-side-menu")).toBeNull();
    expect(surface.querySelector(".bn-toolbar")).toBeNull();
    expect(surface.querySelector(".preshot-blocknote-image-group-toolbar"))
      .toBeNull();
    expect(surface.querySelector("[data-group-resize-edge]")).toBeNull();
    expect(surface.textContent).not.toContain("加载中");

    const nativeMedia = surface.querySelectorAll<HTMLElement>(
      "[data-preshot-export-native-media]",
    );
    expect(nativeMedia).toHaveLength(4);
    expect([...nativeMedia].map((entry) =>
      entry.dataset.preshotExportNativeMediaLabel)).toEqual([
      "IMAGE · native.png",
      "AUDIO · ambient.wav",
      "VIDEO · camera.mp4",
      "FILE · call-sheet.bin",
    ]);
    expect(surface.querySelector("[controls]")).toBeNull();
    surface.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
      expect(image.src.startsWith("data:")).toBe(true);
    });

    const group = surface.querySelector<HTMLElement>(
      '[data-preshot-export-image-group="group-1"]',
    )!;
    expect(group).toHaveStyle({
      height: "260px",
      marginLeft: "12px",
      transform: "translateY(4px)",
      width: "400px",
    });
    const frames = surface.querySelectorAll<HTMLElement>(
      "[data-preshot-export-image]",
    );
    expect([...frames].map((entry) => entry.dataset.preshotExportImage))
      .toEqual(["first", "second"]);
    expect(frames[0]).toHaveStyle({ height: "100px", width: "200px" });
    expect(frames[1]).toHaveStyle({
      height: "120px",
      top: "107px",
      width: "200px",
    });
    expect(frames[0].querySelector("img")).toHaveStyle({
      left: "-50%",
      width: "200%",
    });
  });

  it("supports the 890px preset and reports stable measurement categories", async () => {
    const { container } = render(
      <LongImageExportSurface
        outerWidth={890}
        plan={complexPlan()}
        resolvedAssets={assets}
      />,
    );
    const surface = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(
        "[data-preshot-export-outer-width='890']",
      );
      expect(element).not.toBeNull();
      return element!;
    });

    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 890, 1200),
    );
    const measurements = measureLongImageExportSurface(surface);

    expect(measurements.outerWidth).toBe(890);
    expect(measurements.contentWidth).toBeCloseTo(
      longImageExportContentWidth(890),
      6,
    );
    expect(measurements.height).toBe(1200);
    expect(measurements.topLevelBlocks).toHaveLength(
      complexPlan().document.blocks.length,
    );
    expect(measurements.imageGroupRows.map((row) => row.id))
      .toEqual(["group-1:0", "group-1:1"]);
    expect(measurements.imageGroupRows[0]).toMatchObject({
      blockId: "image-group-block",
      groupId: "group-1",
      imageIds: ["first"],
      rowIndex: 0,
    });
    expect(measurements.imageGroupRows[1]).toMatchObject({
      blockId: "image-group-block",
      groupId: "group-1",
      imageIds: ["second"],
      rowIndex: 1,
    });
  });

  it("matches the editor expansion rule for legacy default-width groups", async () => {
    const plan = complexPlan();
    plan.imageGroups[0] = {
      ...plan.imageGroups[0],
      x: 0,
      width: 674,
    };
    const { container } = render(
      <LongImageExportSurface plan={plan} resolvedAssets={assets} />,
    );
    const group = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(
        '[data-preshot-export-image-group="group-1"]',
      );
      expect(element).not.toBeNull();
      return element!;
    });

    expect(group).toHaveStyle({ marginLeft: "0px", width: "1008px" });
  });

  it("uses the exact shared schema and rejects missing or remote assets", () => {
    const plan = complexPlan();
    expect(preshotBlockNoteSchema.blockSchema.imageGroup.type)
      .toBe("imageGroup");
    expect(() => validateLongImageExportAssets(plan, {
      ...assets,
      "references/0001.png": "https://example.com/private.png",
    })).toThrow('local image data for "references/0001.png"');
    expect(() => validateLongImageExportAssets(plan, {
      ...assets,
      "media/camera.mp4": "",
    })).toThrow('resolved local asset for "media/camera.mp4"');
  });
});
