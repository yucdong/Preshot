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
  it("decodes concurrently without exceeding the worker limit", async () => {
    const plan: ProjectPlanV14 = {
      schemaVersion: 15, title: "Parallel", artifacts: [], imageGroups: [],
      document: { format: "preshot-blocks", version: 3, blocks: [] },
    };
    const pending: Array<() => void> = [];
    const measure = vi.fn(() => new Promise<{ sourceWidth: number; sourceHeight: number }>((resolve) => {
      pending.push(() => resolve({ sourceWidth: 800, sourceHeight: 600 }));
    }));
    const result = applyMeasuredImages(plan, Array.from({ length: 9 }, (_, i) => [`${i}.png`, `${i}`] as const), measure);
    expect(measure).toHaveBeenCalledTimes(4);
    while (pending.length) {
      pending.splice(0).reverse().forEach((finish) => finish());
      await Promise.resolve();
      await Promise.resolve();
    }
    await result;
    expect(measure).toHaveBeenCalledTimes(9);
  });

  it("surfaces decode failure and stops scheduling remaining images", async () => {
    const plan: ProjectPlanV14 = {
      schemaVersion: 15, title: "Failure", artifacts: [], imageGroups: [],
      document: { format: "preshot-blocks", version: 3, blocks: [] },
    };
    const remaining: Array<() => void> = [];
    const measure = vi.fn((source: string) => source === "0"
      ? Promise.reject(new Error("Invalid image"))
      : new Promise<{ sourceWidth: number; sourceHeight: number }>((resolve) => {
        remaining.push(() => resolve({ sourceWidth: 800, sourceHeight: 600 }));
      }));
    await expect(applyMeasuredImages(plan, Array.from({ length: 8 }, (_, i) => [`${i}.png`, `${i}`] as const), measure))
      .rejects.toThrow("Invalid image");
    remaining.splice(0).forEach((finish) => finish());
    await Promise.resolve();
    await Promise.resolve();
    expect(measure).toHaveBeenCalledTimes(4);
  });

  it("hydrates a captured location image with its measured aspect ratio", async () => {
    const plan: ProjectPlanV14 = {
      schemaVersion: 15,
      title: "Captured location",
      document: {
        format: "preshot-blocks",
        version: 3,
        blocks: [{
          id: "location-block",
          type: "shootingLocation",
          props: { artifactId: "location" },
          content: undefined,
          children: [],
        }],
      },
      imageGroups: [],
      artifacts: [{
        id: "location",
        kind: "shootingLocation",
        revision: 0,
        venueName: "Location",
        address: "",
        description: "",
        gallery: {
          id: "location-gallery",
          images: [{
            id: "capture",
            file: "references/capture.png",
            aspectRatio: 1,
            frameWidth: 240,
            frameHeight: 240,
          }],
        },
      }],
    };

    const result = await applyMeasuredImages(
      plan,
      [["references/capture.png", "capture"]],
      async () => ({ sourceWidth: 1_200, sourceHeight: 800 }),
    );
    const artifact = result.artifacts[0];
    expect(artifact.kind).toBe("shootingLocation");
    if (artifact.kind !== "shootingLocation") return;
    expect(artifact.gallery.images[0]).toMatchObject({
      aspectRatio: 1.5,
      sourceWidth: 1_200,
      sourceHeight: 800,
      frameWidth: 360,
      frameHeight: 240,
    });
  });

  it("hydrates matching image records through an injected decoder", async () => {
    const plan: ProjectPlanV14 = {
      schemaVersion: 15,
      artifacts: [],
      title: "Hydration",
      document: {
        format: "preshot-blocks",
        version: 3,
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
      frameWidth: 160,
    });
  });

  it("hydrates a batch at one 240-unit height with aspect-derived widths", async () => {
    const plan: ProjectPlanV14 = {
      schemaVersion: 15,
      artifacts: [],
      title: "Batch",
      document: {
        format: "preshot-blocks",
        version: 3,
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
        width: 800,
        height: 320,
        description: "",
        images: [
          {
            id: "landscape",
            file: "references/landscape.png",
            aspectRatio: 1,
            frameWidth: 240,
            frameHeight: 240,
          },
          {
            id: "portrait",
            file: "references/portrait.png",
            aspectRatio: 1,
            frameWidth: 240,
            frameHeight: 240,
          },
        ],
      }],
    };
    const dimensions = new Map([
      ["landscape", { sourceWidth: 1200, sourceHeight: 800 }],
      ["portrait", { sourceWidth: 600, sourceHeight: 900 }],
    ]);

    const result = await applyMeasuredImages(
      plan,
      [
        ["references/landscape.png", "landscape"],
        ["references/portrait.png", "portrait"],
      ],
      async (key) => dimensions.get(key)!,
    );

    expect(result.imageGroups[0].images).toMatchObject([
      { frameWidth: 360, frameHeight: 240 },
      { frameWidth: 160, frameHeight: 240 },
    ]);
    expect(result.imageGroups[0].height).toBe(258);
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
