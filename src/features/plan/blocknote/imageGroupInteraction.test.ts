import { describe, expect, it } from "vitest";
import {
  affects,
  frameResizePreview,
  groupResizePreview,
  IMAGE_RESIZE_DIRECTIONS,
  imageGroupFrameResizePreview,
  imageWithPreview,
  nearestSnap,
  resizeCursor,
  resizeHandleStyle,
} from "./imageGroupInteraction";

describe("image-group interaction utilities", () => {
  it("retains the active candidate within its winning priority class", () => {
    const candidates = [
      {
        key: "active",
        value: 100,
        priority: 1,
        data: "active",
      },
      {
        key: "competing",
        value: 106,
        priority: 1,
        data: "competing",
      },
    ];

    expect(nearestSnap(107, candidates, "active")).toMatchObject({
      key: "active",
      distance: 7,
    });
  });

  it("transfers only after the active candidate passes its release threshold", () => {
    const candidates = [
      {
        key: "active",
        value: 100,
        priority: 1,
        data: "active",
      },
      {
        key: "competing",
        value: 106,
        priority: 1,
        data: "competing",
      },
    ];

    expect(nearestSnap(111, candidates, "active")).toMatchObject({
      key: "competing",
      distance: 5,
    });
  });

  it("allows an entering higher-priority candidate to override the active one", () => {
    const candidates = [
      {
        key: "active",
        value: 100,
        priority: 1,
        data: "active",
      },
      {
        key: "higher-priority",
        value: 106,
        priority: 0,
        data: "higher-priority",
      },
    ];

    expect(nearestSnap(107, candidates, "active")).toMatchObject({
      key: "higher-priority",
      distance: 1,
    });
  });

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

  it("uses candidate order as the deterministic distance tie breaker", () => {
    expect(nearestSnap(100, [
      { key: "first", value: 96, priority: 1, data: "first" },
      { key: "second", value: 104, priority: 1, data: "second" },
    ], null)?.key).toBe("first");
  });

  it("keeps image handles side-only while preserving group resize directions", () => {
    expect(IMAGE_RESIZE_DIRECTIONS).toEqual(["left", "right"]);
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

  it("locks side resize to the image's current displayed ratio", () => {
    const result = frameResizePreview({
      start: {
        imageId: "image",
        frameWidth: 120,
        frameHeight: 80,
        frameOffsetX: 2,
        frameOffsetY: 3,
      },
      startRect: { left: 100, right: 220, top: 100, bottom: 180 },
      direction: "right",
      deltaX: 30,
      deltaY: 100,
      candidates: [],
      snapState: {
        widthKey: null,
        heightKey: null,
        verticalKey: null,
        horizontalKey: null,
      },
      groupRect: { left: 0, right: 300, top: 0, bottom: 200 },
    });

    expect(result.preview).toEqual({
      imageId: "image",
      frameWidth: 150,
      frameHeight: 100,
      frameOffsetX: 2,
      frameOffsetY: 3,
    });
    expect(result.guide).toEqual({});

    const left = frameResizePreview({
      ...{
        start: result.preview,
        startRect: { left: 100, right: 250, top: 100, bottom: 200 },
        candidates: [],
        snapState: result.snapState,
        groupRect: { left: 0, right: 300, top: 0, bottom: 200 },
      },
      direction: "left",
      deltaX: 30,
      deltaY: 0,
    });
    expect(left.preview).toMatchObject({
      frameWidth: 120,
      frameHeight: 80,
      frameOffsetX: 32,
      frameOffsetY: 3,
    });
  });

  it("prefers equal-width then equal-height snapping over edge guides", () => {
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
        rect: { left: 50, right: 106, top: 20, bottom: 60 },
      }],
      snapState: {
        widthKey: null,
        heightKey: null,
        verticalKey: null,
        horizontalKey: null,
      },
      groupRect: { left: 0, right: 300, top: 0, bottom: 200 },
    });

    expect(result.preview.frameWidth).toBe(100);
    expect(result.preview.frameHeight).toBeCloseTo(80 / 90 * 100);
    expect(result.guide).toEqual({ dimension: "同宽 100" });
    expect(result.snapState).toMatchObject({
      widthKey: "width:other",
      verticalKey: null,
    });

    const equalHeight = frameResizePreview({
      start: {
        imageId: "image",
        frameWidth: 100,
        frameHeight: 50,
        frameOffsetX: 0,
        frameOffsetY: 0,
      },
      startRect: { left: 0, right: 100, top: 0, bottom: 50 },
      direction: "right",
      deltaX: 18,
      deltaY: 0,
      candidates: [{
        id: "other",
        frameWidth: 200,
        frameHeight: 60,
        rect: { left: 180, right: 380, top: 0, bottom: 60 },
      }],
      snapState: {
        widthKey: null,
        heightKey: null,
        verticalKey: null,
        horizontalKey: null,
      },
      groupRect: { left: 0, right: 400, top: 0, bottom: 200 },
    });
    expect(equalHeight.preview).toMatchObject({
      frameWidth: 120,
      frameHeight: 60,
    });
    expect(equalHeight.guide).toEqual({ dimension: "同高 60" });
  });

  it("shows one prioritized group or image edge guide", () => {
    const groupEdge = frameResizePreview({
      start: {
        imageId: "image",
        frameWidth: 100,
        frameHeight: 100,
        frameOffsetX: 0,
        frameOffsetY: 0,
      },
      startRect: { left: 100, right: 200, top: 0, bottom: 100 },
      direction: "right",
      deltaX: 100,
      deltaY: 0,
      candidates: [],
      snapState: {
        widthKey: null,
        heightKey: null,
        verticalKey: null,
        horizontalKey: null,
      },
      groupRect: { left: 0, right: 304, top: 0, bottom: 200 },
    });
    expect(groupEdge.preview.frameWidth).toBe(204);
    expect(groupEdge.guide).toEqual({
      vertical: { x: 304, label: "图片组右边缘" },
    });

    const imageEdge = frameResizePreview({
      ...{
        start: {
          imageId: "image",
          frameWidth: 100,
          frameHeight: 100,
          frameOffsetX: 0,
          frameOffsetY: 0,
        },
        startRect: { left: 20, right: 120, top: 0, bottom: 100 },
        direction: "right" as const,
        deltaX: 76,
        deltaY: 0,
        snapState: {
          widthKey: null,
          heightKey: null,
          verticalKey: null,
          horizontalKey: null,
        },
        groupRect: { left: 0, right: 300, top: 0, bottom: 200 },
      },
      candidates: [{
        id: "other",
        frameWidth: 80,
        frameHeight: 50,
        rect: { left: 200, right: 280, top: 0, bottom: 50 },
      }],
    });
    expect(imageEdge.preview.frameWidth).toBe(180);
    expect(imageEdge.guide).toEqual({
      vertical: { x: 200, label: "图片左边缘" },
    });

    const leftGroupEdge = frameResizePreview({
      start: {
        imageId: "image",
        frameWidth: 100,
        frameHeight: 100,
        frameOffsetX: 0,
        frameOffsetY: 0,
      },
      startRect: { left: 100, right: 200, top: 0, bottom: 100 },
      direction: "left",
      deltaX: -96,
      deltaY: 0,
      candidates: [],
      snapState: {
        widthKey: null,
        heightKey: null,
        verticalKey: null,
        horizontalKey: null,
      },
      groupRect: { left: 0, right: 300, top: 0, bottom: 200 },
    });
    expect(leftGroupEdge.preview).toMatchObject({
      frameWidth: 200,
      frameOffsetX: -100,
    });
    expect(leftGroupEdge.guide).toEqual({
      vertical: { x: 0, label: "图片组左边缘" },
    });

    const rightImageEdge = frameResizePreview({
      start: {
        imageId: "image",
        frameWidth: 100,
        frameHeight: 100,
        frameOffsetX: 0,
        frameOffsetY: 0,
      },
      startRect: { left: 200, right: 300, top: 0, bottom: 100 },
      direction: "left",
      deltaX: -36,
      deltaY: 0,
      candidates: [{
        id: "other",
        frameWidth: 80,
        frameHeight: 50,
        rect: { left: 80, right: 160, top: 0, bottom: 50 },
      }],
      snapState: {
        widthKey: null,
        heightKey: null,
        verticalKey: null,
        horizontalKey: null,
      },
      groupRect: { left: 0, right: 300, top: 0, bottom: 200 },
    });
    expect(rightImageEdge.preview).toMatchObject({
      frameWidth: 140,
      frameOffsetX: -40,
    });
    expect(rightImageEdge.guide).toEqual({
      vertical: { x: 160, label: "图片右边缘" },
    });
  });

  it("previews wrapping and a dynamic group height with current image order", () => {
    const images = [
      {
        id: "image",
        file: "references/image.png",
        aspectRatio: 1.5,
        frameWidth: 120,
        frameHeight: 80,
      },
      {
        id: "other",
        file: "references/other.png",
        aspectRatio: 1.5,
        frameWidth: 120,
        frameHeight: 80,
      },
    ];
    const result = imageGroupFrameResizePreview({
      images,
      groupWidth: 300,
      start: {
        imageId: "image",
        frameWidth: 120,
        frameHeight: 80,
        frameOffsetX: 0,
        frameOffsetY: 0,
      },
      startRect: { left: 0, right: 120, top: 0, bottom: 80 },
      direction: "right",
      deltaX: 40,
      deltaY: 0,
      candidates: [{
        id: "other",
        frameWidth: 120,
        frameHeight: 80,
        rect: { left: 127, right: 247, top: 0, bottom: 80 },
      }],
      snapState: {
        widthKey: null,
        heightKey: null,
        verticalKey: null,
        horizontalKey: null,
      },
      groupRect: { left: 0, right: 282, top: 0, bottom: 200 },
    });

    expect(result.layout.slots.map((slot) => slot.id)).toEqual([
      "image",
      "other",
    ]);
    expect(result.layout.slots[1]?.y).toBeGreaterThan(0);
    expect(result.preview.groupHeight).toBeCloseTo(result.layout.height);
  });

  it("allows direct resize to the full group inner width and wraps neighbors", () => {
    const images = [
      {
        id: "first",
        file: "references/first.png",
        aspectRatio: 1,
        frameWidth: 80,
        frameHeight: 80,
      },
      {
        id: "second",
        file: "references/second.png",
        aspectRatio: 1,
        frameWidth: 80,
        frameHeight: 80,
      },
    ];
    const result = imageGroupFrameResizePreview({
      images,
      groupWidth: 300,
      start: {
        imageId: "first",
        frameWidth: 80,
        frameHeight: 80,
        frameOffsetX: 0,
        frameOffsetY: 0,
      },
      startRect: { left: 0, right: 80, top: 0, bottom: 80 },
      direction: "right",
      deltaX: 500,
      deltaY: 0,
      candidates: [],
      snapState: {
        widthKey: null,
        heightKey: null,
        verticalKey: null,
        horizontalKey: null,
      },
      groupRect: { left: 0, right: 282, top: 0, bottom: 200 },
    });

    expect(result.preview).toMatchObject({
      frameWidth: 282,
      frameHeight: 282,
    });
    expect(result.layout.slots).toMatchObject([
      { id: "first", x: 0, y: 0, width: 282, height: 282 },
      { id: "second", x: 0, y: 289, width: 80, height: 80 },
    ]);
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
