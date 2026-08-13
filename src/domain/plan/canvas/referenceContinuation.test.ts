import { describe, expect, it } from "vitest";
import { contentSize, DEFAULT_PAGE_GEOMETRY } from "./geometry";
import { MIN_COMPONENT_HEIGHT, type ProjectPlan, type ReferenceComponent } from "./models";
import { scaleReferenceImages } from "./plan";
import { layoutDocumentFlow } from "./documentFlow";
import {
  maximumFittingReferenceAverageHeight,
  normalizeReferenceContinuations,
} from "./referenceContinuation";

const content = contentSize(DEFAULT_PAGE_GEOMETRY);

function reference(images: number, frameHeight: number): ReferenceComponent {
  return {
    id: "reference",
    name: "图片组1",
    type: "reference",
    x: 0,
    width: content.width,
    height: content.height,
    description: "",
    images: Array.from({ length: images }, (_, index) => ({
      id: `image-${index + 1}`,
      file: `references/${index + 1}.png`,
      aspectRatio: 1,
      frameWidth: frameHeight,
      frameHeight,
    })),
  };
}

function plan(component: ReferenceComponent): ProjectPlan {
  return { schemaVersion: 12, title: "Demo", components: [component] };
}

describe("normalizeReferenceContinuations", () => {
  it("computes a 4pt-stepped maximum average height that fits one page", () => {
    const component = reference(12, 100);
    const maximum = maximumFittingReferenceAverageHeight(component, { step: 4, minimum: 24 });
    const atMaximum = scaleReferenceImages(plan(component), {
      componentId: component.id,
      scale: maximum / 100,
    });
    const maximumFromScaled = maximumFittingReferenceAverageHeight(
      atMaximum.components[0] as ReferenceComponent,
      { step: 4, minimum: 24 },
    );

    expect(maximum).toBeGreaterThanOrEqual(24);
    expect((maximum - 24) % 4).toBe(0);
    expect(normalizeReferenceContinuations(atMaximum, { makeId: () => "unused" }).components).toHaveLength(1);
    expect(maximumFromScaled).toBe(maximum);
  });

  it("shrinks all image frames uniformly when that keeps the group on one page", () => {
    const original = plan(reference(12, 180));
    const normalized = normalizeReferenceContinuations(original, {
      makeId: () => "unused",
    });
    const component = normalized.components[0] as ReferenceComponent;

    expect(normalized.components).toHaveLength(1);
    expect(component.images[0].frameHeight).toBeLessThan(180);
    expect(component.images[0].frameHeight).toBeGreaterThanOrEqual(67.5);
    expect(new Set(component.images.map((image) => image.frameHeight)).size).toBe(1);
    expect(component.height).toBeLessThanOrEqual(content.height);
  });

  it("creates persisted uniquely named continuation groups after reaching minimum size", () => {
    let id = 1;
    const original = plan(reference(80, 135));
    const normalized = normalizeReferenceContinuations(original, {
      makeId: () => `continuation-${id++}`,
    });
    const groups = normalized.components as ReferenceComponent[];

    expect(groups.length).toBeGreaterThan(1);
    expect(groups.map((group) => group.name)).toEqual(
      groups.map((_group, index) => index === 0 ? "图片组1" : `图片组1 (${index + 1})`),
    );
    expect(groups.slice(1).map((group) => group.id)).toEqual(
      groups.slice(1).map((_group, index) => `continuation-${index + 1}`),
    );
    expect(groups.flatMap((group) => group.images.map((image) => image.id))).toEqual(
      original.components[0].type === "reference"
        ? original.components[0].images.map((image) => image.id)
        : [],
    );
    expect(groups.every((group) => group.height <= content.height)).toBe(true);
    expect(groups.every((group) => group.images.every((image) => image.frameHeight >= 67.5))).toBe(true);
  });

  it("shrinks an oversized card to the bottom of its final image row", () => {
    const original = plan(reference(2, 100));
    const normalized = normalizeReferenceContinuations(original, { makeId: () => "unused" });
    const component = normalized.components[0] as ReferenceComponent;

    expect(component.height).toBeLessThan(original.components[0].height);
    expect(component.height).toBeGreaterThan(MIN_COMPONENT_HEIGHT);
    expect(normalizeReferenceContinuations(normalized, { makeId: () => "unused" })).toBe(normalized);
  });

  it("grows again when an added image creates another row", () => {
    const compact = normalizeReferenceContinuations(plan(reference(2, 100)), {
      makeId: () => "unused",
    });
    const compactComponent = compact.components[0] as ReferenceComponent;
    const withAnotherRow = {
      ...compactComponent,
      images: [
        ...compactComponent.images,
        ...Array.from({ length: 4 }, (_, index) => ({
          id: `added-${index}`,
          file: `references/added-${index}.png`,
          aspectRatio: 1,
          frameWidth: 100,
          frameHeight: 100,
        })),
      ],
    };
    const grown = normalizeReferenceContinuations(plan(withAnotherRow), {
      makeId: () => "unused",
    });

    expect(grown.components[0].height).toBeGreaterThan(compactComponent.height);
    expect(grown.components[0].height).toBeLessThanOrEqual(content.height);
  });

  it("grows a short component to contain complete image rows without internal scrolling", () => {
    const original = plan({ ...reference(6, 135), height: 120 });
    const normalized = normalizeReferenceContinuations(original, { makeId: () => "unused" });
    const component = normalized.components[0] as ReferenceComponent;

    expect(component.height).toBeGreaterThan(120);
    expect(component.height).toBeLessThanOrEqual(content.height);
  });

  it("shrinks the natural card after whole-group image scaling", () => {
    const original = normalizeReferenceContinuations(plan(reference(12, 100)), {
      makeId: () => "unused",
    });
    const scaled = scaleReferenceImages(original, {
      componentId: "reference",
      scale: 0.6,
    });
    const normalized = normalizeReferenceContinuations(scaled, {
      makeId: () => "unused",
    });

    expect(normalized.components).toHaveLength(1);
    expect(normalized.components[0].height).toBeLessThan(original.components[0].height);
  });

  it("lets a scaled reference card flow back onto the preceding page", () => {
    const leading = {
      id: "leading",
      name: "Leading",
      type: "plan" as const,
      x: 0,
      width: content.width,
      height: 400,
      textRoot: { kind: "leaf" as const, id: "leading:root", html: "<p>Leading</p>" },
    };
    const originalReference = normalizeReferenceContinuations(
      plan(reference(12, 100)),
      { makeId: () => "unused" },
    ).components[0] as ReferenceComponent;
    expect(
      layoutDocumentFlow([leading, originalReference], DEFAULT_PAGE_GEOMETRY, {
        includeDocumentTitle: false,
      }).pageCount,
    ).toBe(2);

    const scaledPlan = scaleReferenceImages(plan(originalReference), {
      componentId: "reference",
      scale: 0.5,
    });
    const compactReference = normalizeReferenceContinuations(scaledPlan, {
      makeId: () => "unused",
    }).components[0];

    expect(
      layoutDocumentFlow([leading, compactReference], DEFAULT_PAGE_GEOMETRY, {
        includeDocumentTitle: false,
      }).pageCount,
    ).toBe(1);
  });
});