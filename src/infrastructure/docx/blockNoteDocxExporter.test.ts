// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { ProjectPlanV14 } from "../../domain/plan/canvas/blockDocument";
import { createBlockNoteDocxExporter } from "./blockNoteDocxExporter";

const TEST_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAFCAYAAAB4ka1VAAAAE0lEQVR4nGO4dvnif3yYYRAoAAC9iYrpFnTwwwAAAABJRU5ErkJggg==";

function pngBytes(): Uint8Array {
  return Uint8Array.from(atob(TEST_PNG.split(",")[1]!), (value) =>
    value.charCodeAt(0));
}

function imageGroupPlan(): ProjectPlanV14 {
  return {
    schemaVersion: 15,
    artifacts: [],
    title: "DOCX production",
    document: {
      format: "preshot-blocks",
      version: 3,
      blocks: [{
        id: "group-block",
        type: "imageGroup",
        props: { groupId: "group-1" },
        content: undefined,
        children: [],
      }],
    },
    imageGroups: [{
      id: "group-1",
      name: "构图参考",
      description: "一张参考图片",
      type: "reference",
      x: 0,
      width: 360,
      height: 220,
      images: [{
        id: "image-1",
        file: "references/0001.png",
        aspectRatio: 8 / 5,
        sourceWidth: 800,
        sourceHeight: 500,
        frameWidth: 360,
        frameHeight: 220,
        crop: { x: 0, y: 0, width: 1, height: 1 },
      }],
    }],
  };
}

describe("createBlockNoteDocxExporter", () => {
  it("snapshots plan/assets, injects imageGroup composition, and returns DOCX ZIP bytes", async () => {
    const plan = imageGroupPlan();
    const snapshot = structuredClone(plan);
    const compositor = vi.fn().mockResolvedValue(pngBytes());
    const exporter = createBlockNoteDocxExporter({
      compositor,
      optimizeImage: vi.fn().mockResolvedValue({
        mime: "image/png",
        bytes: pngBytes(),
      }),
      optimizeDocxImage: vi.fn().mockResolvedValue({
        mime: "image/png",
        bytes: pngBytes(),
        sourceWidth: 800,
        sourceHeight: 500,
      }),
    });

    const bytes = await exporter.export(plan, {
      "references/0001.png": TEST_PNG,
    });

    expect(exporter.implementation).toBe("blocknote-docx");
    expect(bytes.length).toBeGreaterThan(4);
    expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b]);
    expect(compositor).toHaveBeenCalledOnce();
    expect(compositor.mock.calls[0]?.[0]).toMatchObject({
      blockId: "group-block",
      groupId: "group-1",
    });
    expect(plan).toEqual(snapshot);
  });

  it("surfaces contextual preflight failures before packing", async () => {
    const exporter = createBlockNoteDocxExporter({
      compositor: vi.fn(),
    });

    await expect(exporter.export(imageGroupPlan(), {})).rejects.toThrow(
      /missing image data.*group-block.*group-1.*image-1/i,
    );
  });
});
