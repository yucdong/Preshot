import { describe, expect, it } from "vitest";
import {
  affects,
  frameResizePreview,
  groupResizePreview,
  imageWithPreview,
  nearestSnap,
  resizeCursor,
  resizeHandleStyle,
} from "./imageGroupInteraction";

describe("image-group interaction utilities", () => {
  it("uses 6px snap entry and 10px active-key release hysteresis", () => {
    const candidates = [{
      key: "edge",
      value: 100,
      priority: 1,
      data: "edge",
    }];

    expect(nearestSnap(107, candidates, null)).toBeNull();
    expect(nearestSnap(107, candidates, "edge")).toMatchObject({
      key: "edge",
      distance: 7,
    });
    expect(nearestSnap(111, candidates, "edge")).toBeNull();
  });

  it("prefers candidate priority before distance", () => {
    expect(nearestSnap(100, [
      { key: "center", value: 100, priority: 2, data: "center" },
      { key: "edge", value: 104, priority: 1, data: "edge" },
    ], null)?.key).toBe("edge");
  });

  it("maps resize directions to affected edges and cursors", () => {
    expect(affects("top-left", "top")).toBe(true);
    expect(affects("top-left", "right")).toBe(false);
    expect(resizeCursor("left")).toBe("ew-resize");
    expect(resizeCursor("bottom")).toBe("ns-resize");
    expect(resizeCursor("top-left")).toBe("nwse-resize");
    expect(resizeCursor("top-right")).toBe("nesw-resize");
  });

  it("builds stable edge and corner hit-area geometry", () => {
    expect(resizeHandleStyle("left")).toMatchObject({
      left: 0,
      top: 24,
      bottom: 24,
      width: 20,
      cursor: "ew-resize",
    });
    expect(resizeHandleStyle("bottom-right")).toMatchObject({
      right: 0,
      bottom: 0,
      width: 24,
      height: 24,
      cursor: "nwse-resize",
    });
  });

  it("calculates snapped image-frame preview geometry and guides", () => {
    const result = frameResizePreview({
      start: {
        imageId: "image",
        frameWidth: 100,
        frameHeight: 100,
        frameOffsetX: 2,
        frameOffsetY: 3,
      },
      startRect: { left: 100, right: 200, top: 100, bottom: 200 },
      direction: "top-left",
      deltaX: 40,
      deltaY: 30,
      candidates: [{
        id: "other",
        frameWidth: 200,
        frameHeight: 200,
        rect: { left: 50, right: 140, top: 40, bottom: 130 },
      }],
      snapState: {
        widthKey: null,
        heightKey: null,
        verticalKey: null,
        horizontalKey: null,
      },
      groupRect: { left: 40, top: 30 },
    });

    expect(result.preview).toEqual({
      imageId: "image",
      frameWidth: 60,
      frameHeight: 70,
      frameOffsetX: 42,
      frameOffsetY: 33,
    });
    expect(result.guide).toEqual({
      vertical: { x: 100, label: "右边对齐" },
      horizontal: { y: 100, label: "下边对齐" },
    });
    expect(result.snapState).toMatchObject({
      verticalKey: "x:other:right",
      horizontalKey: "y:other:bottom",
    });
  });

  it("prefers equal-size snapping over edge guides", () => {
    const result = frameResizePreview({
      start: {
        imageId: "image",
        frameWidth: 90,
        frameHeight: 80,
        frameOffsetX: 0,
        frameOffsetY: 0,
      },
      startRect: { left: 10, right: 100, top: 10, bottom: 90 },
      direction: "right",
      deltaX: 6,
      deltaY: 0,
      candidates: [{
        id: "other",
        frameWidth: 100,
        frameHeight: 40,
        rect: { left: 50, right: 196, top: 20, bottom: 60 },
      }],
      snapState: {
        widthKey: null,
        heightKey: null,
        verticalKey: null,
        horizontalKey: null,
      },
      groupRect: { left: 0, top: 0 },
    });

    expect(result.preview.frameWidth).toBe(100);
    expect(result.guide).toEqual({ dimension: "同宽 100" });
    expect(result.snapState).toMatchObject({
      widthKey: "width:other",
      verticalKey: null,
    });
  });

  it("calculates clamped image-group preview geometry", () => {
    expect(groupResizePreview(
      { x: 40, width: 200, height: 120, frameOffsetY: 5 },
      "top-left",
      -100,
      50,
      260,
    )).toEqual({
      x: 0,
      width: 260,
      height: 80,
      frameOffsetY: 55,
    });
    expect(groupResizePreview(
      { x: 40, width: 200, height: 120, frameOffsetY: 5 },
      "bottom-right",
      -150,
      -100,
      260,
    )).toEqual({
      x: 40,
      width: 120,
      height: 80,
      frameOffsetY: 5,
    });
  });

  it("applies previews only to the matching image", () => {
    const image = {
      id: "image",
      file: "references/image.png",
      aspectRatio: 1,
      frameWidth: 100,
      frameHeight: 100,
    };
    const preview = {
      imageId: "image",
      frameWidth: 140,
      frameHeight: 80,
      frameOffsetX: 2,
      frameOffsetY: 3,
    };

    expect(imageWithPreview(image, preview)).toMatchObject({
      frameWidth: 140,
      frameHeight: 80,
      frameOffsetX: 2,
      frameOffsetY: 3,
    });
    expect(imageWithPreview(image, { ...preview, imageId: "other" }))
      .toBe(image);
  });
});
