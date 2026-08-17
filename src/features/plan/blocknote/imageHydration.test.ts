// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectPlanV14 } from "../../../domain/plan/canvas/blockDocument";
import {
  applyMeasuredImages,
  measureImageDimensions,
} from "./imageHydration";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("applyMeasuredImages", () => {
  it("hydrates matching image records through an injected decoder", async () => {
    const plan: ProjectPlanV14 = {
      schemaVersion: 14,
      title: "Hydration",
      document: {
        format: "preshot-blocks",
        version: 2,
        blocks: [{
          id: "group-block",
          type: "imageGroup",
          props: { groupId: "group" },
          content: undefined,
          children: [],
        }],
      },
      imageGroups: [{
        id: "group",
        name: "References",
        type: "reference",
        x: 0,
        width: 400,
        height: 220,
        description: "",
        images: [{
          id: "image",
          file: "references/look.png",
          aspectRatio: 1,
          frameWidth: 160,
          frameHeight: 160,
        }],
      }],
    };
    const measure = vi.fn().mockResolvedValue({
      sourceWidth: 800,
      sourceHeight: 500,
    });

    const result = await applyMeasuredImages(
      plan,
      [["references/look.png", "data:image/png;base64,AA"]],
      measure,
    );

    expect(measure).toHaveBeenCalledWith("data:image/png;base64,AA");
    expect(result.imageGroups[0].images[0]).toMatchObject({
      sourceWidth: 800,
      sourceHeight: 500,
      aspectRatio: 1.6,
      frameHeight: 160,
      frameWidth: 256,
    });
  });
});

describe("measureImageDimensions", () => {
  it("falls back to the browser load event when decode is unavailable", async () => {
    class BrowserImage {
      naturalHeight = 500;
      naturalWidth = 800;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }

      decode() {
        return Promise.reject(new Error("decode is unavailable"));
      }
    }
    vi.stubGlobal("Image", BrowserImage);

    await expect(measureImageDimensions("data:image/png;base64,AA"))
      .resolves.toEqual({
        sourceWidth: 800,
        sourceHeight: 500,
      });
  });
});
