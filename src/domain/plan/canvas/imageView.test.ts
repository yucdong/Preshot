import { describe, expect, it } from "vitest";
import {
  centeredCoverCrop,
  cropForResizedFrame,
  cropForFrame,
  imageViewRenderSpec,
} from "./imageView";

describe("image view", () => {
  it("derives a centered 4:5 cover crop from a 5:3 source", () => {
    expect(centeredCoverCrop(5 / 3, 4 / 5)).toEqual({
      x: 0.26,
      y: 0,
      width: 0.48,
      height: 1,
    });
  });

  it("maps a normalized crop to source pixels and destination units", () => {
    expect(imageViewRenderSpec({
      sourceWidth: 2000,
      sourceHeight: 1200,
      crop: { x: 0.26, y: 0, width: 0.48, height: 1 },
      destinationWidth: 240,
      destinationHeight: 300,
    })).toEqual({
      source: { x: 520, y: 0, width: 960, height: 1200 },
      destination: { width: 240, height: 300 },
    });
  });

  it("keeps the current focus while changing the frame ratio", () => {
    expect(cropForFrame({
      sourceAspectRatio: 5 / 3,
      frameAspectRatio: 1,
      focusX: 0.4,
      focusY: 0.5,
      zoom: 1,
    })).toEqual({ x: 0.1, y: 0, width: 0.6, height: 1 });
  });

  it("preserves an existing crop focus across frame resize", () => {
    expect(cropForResizedFrame({
      aspectRatio: 5 / 3,
      frameWidth: 240,
      frameHeight: 300,
      crop: { x: 0.16, y: 0, width: 0.48, height: 1 },
    }, {
      frameWidth: 240,
      frameHeight: 240,
    })).toEqual({ x: 0.1, y: 0, width: 0.6, height: 1 });
  });
});