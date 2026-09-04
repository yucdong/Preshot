import { describe, expect, it } from "vitest";
import type { ProjectPlanV14 } from "../canvas/blockDocument";
import { layoutDocumentImageGroupForWidth } from "../canvas/documentImageGroupLayout";
import {
  migrateLegacyDefaultImageFrames,
  normalizeAllImageFramesToDefaultHeight,
  setBlockNoteImageNaturalDimensions,
} from "./plan";

describe("all image-frame normalization", () => {
  it("normalizes every image using cropped source dimensions and shared wrapping", () => {
    const crop = { x: 0.1, y: 0.2, width: 0.5, height: 0.8 };
    const first = {
      ...image("first", {
        aspectRatio: 2,
        frameWidth: 99,
        frameHeight: 77,
      }),
      sourceWidth: 1600,
      sourceHeight: 800,
      crop,
      frameOffsetX: 4,
      frameOffsetY: -3,
    };
    const second = image("second", {
      aspectRatio: 3,
      frameWidth: 120,
      frameHeight: 80,
    });
    const original = {
      ...group("images", 500, [first, second]),
      x: 23,
      height: 999,
      frameOffsetY: -7,
    };

    const result = normalizeAllImageFramesToDefaultHeight(
      planWithGroups([original]),
    );
    const normalized = result.plan.imageGroups[0];

    expect(result.normalizedImageCount).toBe(2);
    expect(result.affectedGroupCount).toBe(1);
    expect(normalized).toMatchObject({
      id: "images",
      x: 23,
      width: 500,
      frameOffsetY: -7,
    });
    expect(normalized.images).toEqual([
      {
        ...first,
        frameWidth: 300,
        frameHeight: 240,
      },
      {
        ...second,
        frameWidth: 360,
        frameHeight: 240,
      },
    ]);
    expect(normalized.images[0].crop).toBe(crop);
    expect(normalized.height).toBe(
      layoutDocumentImageGroupForWidth(normalized.images, normalized.width)
        .height,
    );
  });

  it("falls back to the current frame ratio and preserves group and image order", () => {
    const first = image("first", {
      aspectRatio: Number.NaN,
      frameWidth: 100,
      frameHeight: 50,
    });
    const second = image("second", {
      aspectRatio: Number.NaN,
      frameWidth: 60,
      frameHeight: 120,
    });
    const empty = group("empty", 400, []);
    const plan = planWithGroups([
      group("one", 400, [first]),
      empty,
      group("two", 400, [second]),
    ]);

    const result = normalizeAllImageFramesToDefaultHeight(plan);

    expect(result.normalizedImageCount).toBe(2);
    expect(result.affectedGroupCount).toBe(2);
    expect(result.plan.imageGroups.map((entry) => entry.id)).toEqual([
      "one",
      "empty",
      "two",
    ]);
    expect(result.plan.imageGroups[0].images[0]).toEqual({
      ...first,
      frameWidth: 480,
      frameHeight: 240,
    });
    expect(result.plan.imageGroups[1]).toBe(empty);
    expect(result.plan.imageGroups[2].images[0]).toEqual({
      ...second,
      frameWidth: 120,
      frameHeight: 240,
    });
  });

  it("returns the original plan when there are no images", () => {
    const plan = planWithGroups([group("empty", 400, [])]);

    expect(normalizeAllImageFramesToDefaultHeight(plan)).toEqual({
      plan,
      normalizedImageCount: 0,
      affectedGroupCount: 0,
    });
    expect(normalizeAllImageFramesToDefaultHeight(plan).plan).toBe(plan);
  });
});

describe("legacy default image-frame migration", () => {
  it("upgrades every matched image across every image group", () => {
    const plan = planWithGroups([
      group("first", 500, [
        image("a", { aspectRatio: 1.5, frameWidth: 202.5, frameHeight: 135 }),
        image("b", { aspectRatio: 1, frameWidth: 135, frameHeight: 135 }),
      ]),
      group("second", 400, [
        image("c", { aspectRatio: 0.75, frameWidth: 101.25, frameHeight: 135 }),
      ]),
    ]);

    const result = migrateLegacyDefaultImageFrames(plan);

    expect(result.migratedImageCount).toBe(3);
    expect(result.affectedGroupCount).toBe(2);
    expect(result.plan.imageGroups.flatMap((entry) => entry.images)).toMatchObject([
      { id: "a", frameWidth: 360, frameHeight: 240 },
      { id: "b", frameWidth: 240, frameHeight: 240 },
      { id: "c", frameWidth: 180, frameHeight: 240 },
    ]);
  });

  it("changes only legacy defaults in a mixed legacy and manually-sized plan", () => {
    const manual = image("manual", {
      aspectRatio: 1.5,
      frameWidth: 300,
      frameHeight: 135,
    });
    const customHeight = image("custom-height", {
      aspectRatio: 1.5,
      frameWidth: 270,
      frameHeight: 180,
    });
    const plan = planWithGroups([
      group("mixed", 600, [
        image("legacy", {
          aspectRatio: 1.5,
          frameWidth: 202.5,
          frameHeight: 135,
        }),
        manual,
        customHeight,
      ]),
    ]);

    const result = migrateLegacyDefaultImageFrames(plan);

    expect(result.migratedImageCount).toBe(1);
    expect(result.plan.imageGroups[0].images).toEqual([
      expect.objectContaining({
        id: "legacy",
        frameWidth: 360,
        frameHeight: 240,
      }),
      manual,
      customHeight,
    ]);
  });

  it("upgrades a square placeholder before hydration and then applies the source ratio", () => {
    const plan = planWithGroups([
      group("placeholder", 600, [
        image("placeholder", {
          aspectRatio: 1,
          frameWidth: 135.01,
          frameHeight: 134.99,
        }),
      ]),
    ]);

    const migrated = migrateLegacyDefaultImageFrames(plan).plan;
    expect(migrated.imageGroups[0].images[0]).toMatchObject({
      frameWidth: 240,
      frameHeight: 240,
    });

    const hydrated = setBlockNoteImageNaturalDimensions(migrated, {
      file: "references/placeholder.png",
      sourceWidth: 1600,
      sourceHeight: 1000,
    });
    expect(hydrated.imageGroups[0].images[0]).toMatchObject({
      frameWidth: 384,
      frameHeight: 240,
      sourceWidth: 1600,
      sourceHeight: 1000,
    });
  });

  it("leaves an intentional legacy-height square frame for a non-square source untouched", () => {
    const crop = { x: 0, y: 0, width: 1, height: 1 };
    const original = {
      ...image("intentional-square", {
        aspectRatio: 2,
        frameWidth: 135,
        frameHeight: 135,
      }),
      sourceWidth: 1600,
      sourceHeight: 800,
      crop,
    };
    const plan = planWithGroups([
      group("intentional-square", 500, [original]),
    ]);

    const result = migrateLegacyDefaultImageFrames(plan);

    expect(result).toEqual({
      plan,
      migratedImageCount: 0,
      affectedGroupCount: 0,
    });
    expect(result.plan).toBe(plan);
    expect(result.plan.imageGroups[0].images[0]).toBe(original);
  });

  it("uses the effective crop ratio while preserving crop and focal metadata", () => {
    const crop = { x: 0.2, y: 0, width: 0.5, height: 1 };
    const plan = planWithGroups([
      group("crop", 500, [{
        ...image("cropped", {
          aspectRatio: 2,
          frameWidth: 135,
          frameHeight: 135,
        }),
        sourceWidth: 1200,
        sourceHeight: 600,
        crop,
        frameOffsetX: 4,
        frameOffsetY: 3,
      }]),
    ]);

    const result = migrateLegacyDefaultImageFrames(plan);
    const migrated = result.plan.imageGroups[0].images[0];

    expect(migrated).toMatchObject({
      id: "cropped",
      file: "references/cropped.png",
      frameWidth: 240,
      frameHeight: 240,
      frameOffsetX: 4,
      frameOffsetY: 3,
      crop,
    });
    expect(migrated.crop).toBe(crop);
  });

  it("recognizes a square legacy frame when the crop makes the effective source square", () => {
    const crop = { x: 0.25, y: 0, width: 0.5, height: 1 };
    const plan = planWithGroups([
      group("square-crop", 500, [{
        ...image("square-crop", {
          aspectRatio: 2,
          frameWidth: 135,
          frameHeight: 135,
        }),
        sourceWidth: 1600,
        sourceHeight: 800,
        crop,
      }]),
    ]);

    const result = migrateLegacyDefaultImageFrames(plan);

    expect(result.migratedImageCount).toBe(1);
    expect(result.plan.imageGroups[0].images[0]).toMatchObject({
      frameWidth: 240,
      frameHeight: 240,
      crop,
    });
  });

  it("is idempotent once legacy defaults have been upgraded", () => {
    const plan = planWithGroups([
      group("stable", 500, [
        image("legacy", {
          aspectRatio: 1.5,
          frameWidth: 202.5,
          frameHeight: 135,
        }),
      ]),
    ]);

    const first = migrateLegacyDefaultImageFrames(plan);
    const second = migrateLegacyDefaultImageFrames(first.plan);

    expect(second).toEqual({
      plan: first.plan,
      migratedImageCount: 0,
      affectedGroupCount: 0,
    });
    expect(second.plan).toBe(first.plan);
  });

  it("recomputes affected group wrapping from authoritative width and preserves placement", () => {
    const original = {
      ...group("wrapped", 500, [
        {
          ...image("a", {
            aspectRatio: 1.5,
            frameWidth: 202.5,
            frameHeight: 135,
          }),
          frameOffsetX: 10,
          frameOffsetY: 5,
        },
        image("b", {
          aspectRatio: 1.5,
          frameWidth: 202.5,
          frameHeight: 135,
        }),
      ]),
      x: 31,
      height: 999,
      frameOffsetY: -8,
    };

    const migrated = migrateLegacyDefaultImageFrames(
      planWithGroups([original]),
    ).plan.imageGroups[0];

    expect(migrated.x).toBe(31);
    expect(migrated.width).toBe(500);
    expect(migrated.frameOffsetY).toBe(-8);
    expect(migrated.images[0]).toMatchObject({
      frameOffsetX: 10,
      frameOffsetY: 5,
    });
    expect(migrated.height).toBe(
      layoutDocumentImageGroupForWidth(migrated.images, 500).height,
    );
    expect(migrated.height).toBe(510);
  });
});

describe("BlockNote image natural dimensions", () => {
  it("upgrades a legacy default frame to the 240-unit default", () => {
    const plan: ProjectPlanV14 = {
      schemaVersion: 15,
      artifacts: [],
      title: "Demo",
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
        name: "Group",
        type: "reference",
        x: 0,
        width: 400,
        height: 300,
        description: "",
        images: [{
          id: "image",
          file: "references/image.png",
          aspectRatio: 1,
          frameWidth: 135,
          frameHeight: 135,
        }],
      }],
    };

    const next = setBlockNoteImageNaturalDimensions(plan, {
      file: "references/image.png",
      sourceWidth: 1600,
      sourceHeight: 1000,
    });

    expect(next.imageGroups[0].images[0]).toMatchObject({
      aspectRatio: 1.6,
      sourceWidth: 1600,
      sourceHeight: 1000,
      frameWidth: 384,
      frameHeight: 240,
      crop: { x: 0, y: 0, width: 1, height: 1 },
    });
  });

  it("hydrates a current placeholder at 240 units without changing its height", () => {
    const plan = planWithImage({
      aspectRatio: 1,
      frameWidth: 240,
      frameHeight: 240,
    });

    const next = setBlockNoteImageNaturalDimensions(plan, {
      file: "references/image.png",
      sourceWidth: 900,
      sourceHeight: 600,
    });

    expect(next.imageGroups[0].images[0]).toMatchObject({
      aspectRatio: 1.5,
      frameWidth: 360,
      frameHeight: 240,
    });
  });

  it("preserves an intentional current-height square frame for a non-square source", () => {
    const crop = { x: 0, y: 0, width: 1, height: 1 };
    const plan = planWithImage({
      aspectRatio: 2,
      sourceWidth: 1600,
      sourceHeight: 800,
      frameWidth: 240,
      frameHeight: 240,
      crop,
    });

    const next = setBlockNoteImageNaturalDimensions(plan, {
      file: "references/image.png",
      sourceWidth: 1600,
      sourceHeight: 800,
    });

    expect(next).toBe(plan);
    expect(next.imageGroups[0].images[0]).toMatchObject({
      frameWidth: 240,
      frameHeight: 240,
      crop,
    });
  });

  it("hydrates a square current frame when its crop has a square effective ratio", () => {
    const crop = { x: 0.25, y: 0, width: 0.5, height: 1 };
    const plan = planWithImage({
      aspectRatio: 2,
      sourceWidth: 1600,
      sourceHeight: 800,
      frameWidth: 240,
      frameHeight: 240,
      crop,
    });

    const first = setBlockNoteImageNaturalDimensions(plan, {
      file: "references/image.png",
      sourceWidth: 1600,
      sourceHeight: 800,
    });
    const second = setBlockNoteImageNaturalDimensions(first, {
      file: "references/image.png",
      sourceWidth: 1600,
      sourceHeight: 800,
    });

    expect(first.imageGroups[0].images[0]).toMatchObject({
      frameWidth: 240,
      frameHeight: 240,
      crop,
    });
    expect(second).toBe(first);
  });

  it("recognizes a legacy 135-unit aspect-derived default frame", () => {
    const plan = planWithImage({
      aspectRatio: 1.6,
      frameWidth: 216,
      frameHeight: 135,
    });

    const next = setBlockNoteImageNaturalDimensions(plan, {
      file: "references/image.png",
      sourceWidth: 800,
      sourceHeight: 500,
    });

    expect(next.imageGroups[0].images[0]).toMatchObject({
      frameWidth: 384,
      frameHeight: 240,
    });
  });

  it("preserves intentional frame dimensions during load hydration", () => {
    const plan = planWithImage({
      aspectRatio: 1,
      frameWidth: 180,
      frameHeight: 90,
    });

    const next = setBlockNoteImageNaturalDimensions(plan, {
      file: "references/image.png",
      sourceWidth: 900,
      sourceHeight: 600,
    });

    expect(next.imageGroups[0].images[0]).toMatchObject({
      aspectRatio: 1.5,
      sourceWidth: 900,
      sourceHeight: 600,
      frameWidth: 180,
      frameHeight: 90,
    });
    expect(next.imageGroups[0].images[0].crop).toBeUndefined();
  });
});

function image(
  id: string,
  dimensions: Pick<
    ProjectPlanV14["imageGroups"][number]["images"][number],
    "aspectRatio" | "frameWidth" | "frameHeight"
  >,
): ProjectPlanV14["imageGroups"][number]["images"][number] {
  return {
    id,
    file: `references/${id}.png`,
    ...dimensions,
  };
}

function group(
  id: string,
  width: number,
  images: ProjectPlanV14["imageGroups"][number]["images"],
): ProjectPlanV14["imageGroups"][number] {
  return {
    id,
    name: id,
    type: "reference",
    x: 0,
    width,
    height: 300,
    description: "",
    images,
  };
}

function planWithGroups(
  imageGroups: ProjectPlanV14["imageGroups"],
): ProjectPlanV14 {
  return {
    schemaVersion: 15,
    artifacts: [],
    title: "Demo",
    document: {
      format: "preshot-blocks",
      version: 3,
      blocks: imageGroups.map((entry) => ({
        id: `${entry.id}-block`,
        type: "imageGroup",
        props: { groupId: entry.id },
        content: undefined,
        children: [],
      })),
    },
    imageGroups,
  };
}

function planWithImage(
  image: Omit<
    ProjectPlanV14["imageGroups"][number]["images"][number],
    "id" | "file"
  >,
): ProjectPlanV14 {
  return {
    schemaVersion: 15,
    artifacts: [],
    title: "Demo",
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
      name: "Group",
      type: "reference",
      x: 0,
      width: 400,
      height: 300,
      description: "",
      images: [{
        id: "image",
        file: "references/image.png",
        ...image,
      }],
    }],
  };
}
