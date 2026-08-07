import { describe, expect, it } from "vitest";
import {
  contentSize,
  DEFAULT_PAGE_GEOMETRY,
  DOCUMENT_TITLE_HEIGHT,
  NO_COMPONENT_FRAME_CHROME,
  SPACING,
} from "./geometry";
import { layoutPlan, referenceImageSlots, slotCaptionSplit, TITLE_BAND } from "./engine";
import {
  DEFAULT_IMAGE_HEIGHT,
  type PlanComponent,
  type ReferenceComponent,
} from "./models";
import { COMPONENT_INSET, IMAGE_GAP, REFERENCE_DESCRIPTION_GAP } from "./referenceLayout";

const content = contentSize(DEFAULT_PAGE_GEOMETRY);

function plan(id: string, width: number): PlanComponent {
  return { id, name: "文案1", type: "plan", width, contentScale: 1, html: "" };
}

function measurements(planHeights: Record<string, number> = {}) {
  return {
    planHeights: new Map(Object.entries(planHeights)),
    referenceDescriptionHeights: new Map<string, number>(),
  };
}

describe("layoutPlan placement", () => {
  it("places a single full-width component at the origin of page 0", () => {
    const { pageCount, placements } = layoutPlan([plan("a", 1)]);
    expect(pageCount).toBe(1);
    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({
      componentId: "a",
      fragmentId: "a::0",
      fragmentIndex: 0,
      kind: "whole",
      pageIndex: 0,
    });
    expect(placements[0].rect).toEqual({ x: 0, y: 0, width: content.width, height: 56 });
  });

  it("flows two gap-aware components side by side on one row", () => {
    const { placements } = layoutPlan([
      plan("a", 0.45),
      plan("b", 0.45),
    ]);
    expect(placements[0].rect).toMatchObject({ x: 0, y: 0, width: content.width * 0.45 });
    expect(placements[1].rect.y).toBe(0);
    expect(placements[1].rect.width).toBe(content.width * 0.45);
    expect(placements[1].rect.x).toBeCloseTo(
      content.width * 0.45 + SPACING,
      8,
    );
  });

  it("places same-row components after the configured horizontal spacing gap", () => {
    const { placements } = layoutPlan([
      plan("a", 0.4),
      plan("b", 0.4),
    ]);

    expect(placements[1].rect.x).toBeCloseTo(
      content.width * 0.4 + SPACING,
      8,
    );
  });

  it("ignores removed logical row metadata when ordered components fit together", () => {
    const components: PlanComponent[] = [
      plan("a", 0.4),
      plan("b", 0.4),
    ];

    const [a, b] = layoutPlan(components).placements;

    expect(b.rect.x).toBeGreaterThan(a.rect.x);
    expect(b.rect.y).toBe(a.rect.y);
  });

  it("reserves title space before the first logical row when requested", () => {
    const [placement] = layoutPlan(
      [plan("a", 1)],
      DEFAULT_PAGE_GEOMETRY,
      measurements(),
      { frameChrome: NO_COMPONENT_FRAME_CHROME, includeDocumentTitle: true },
    ).placements;

    expect(placement.rect.y).toBe(DOCUMENT_TITLE_HEIGHT + SPACING);
  });

  it("wraps to the next row when the next component does not fit the row", () => {
    const third = content.width / 3;
    const [a, b, c] = layoutPlan([
      plan("a", 2 / 3),
      plan("b", 0.5),
      plan("c", 1 / 3),
    ], DEFAULT_PAGE_GEOMETRY, measurements({ a: 100, b: 100, c: 100 })).placements;
    expect(a.rect).toMatchObject({ x: 0, y: 0 });
    // b (1/2) does not fit next to a (2/3): 2/3 + 1/2 > 1 -> new row
    expect(b.rect.x).toBe(0);
    expect(b.rect.y).toBeCloseTo(100 + DEFAULT_PAGE_GEOMETRY.rowGap, 5);
    // c (1/3) fits next to b (1/2) on the same row
    expect(c.rect.y).toBeCloseTo(b.rect.y, 5);
    expect(c.rect.x).toBeCloseTo(content.width / 2 + SPACING, 5);
    expect(third).toBeGreaterThan(0);
  });

  it("lets measured plan components continue across pages instead of forcing a fresh page", () => {
    const { pageCount, placements } = layoutPlan([
      plan("a", 1),
      plan("b", 1),
      plan("c", 1),
      plan("d", 1),
    ], DEFAULT_PAGE_GEOMETRY, measurements({ a: 260, b: 260, c: 260, d: 260 }));
    expect(pageCount).toBe(2);
    expect(placements[0]).toMatchObject({ pageIndex: 0 });
    expect(placements[2]).toMatchObject({ pageIndex: 0, rect: { x: 0, width: content.width, height: 260 } });
    expect(placements[3]).toMatchObject({ pageIndex: 1, rect: { x: 0, width: content.width, height: 260 } });
  });

  it("uses the measured plan height", () => {
    const { pageCount, placements } = layoutPlan([plan("a", 1)], DEFAULT_PAGE_GEOMETRY, measurements({ a: 123 }));
    expect(pageCount).toBe(1);
    expect(placements[0].rect.height).toBe(123);
  });

  it("includes configured frame chrome exactly once in plan height and row flow", () => {
    const chrome = { topBarHeight: 24, contentGap: 4 };
    const { placements } = layoutPlan(
      [plan("a", 1), plan("b", 1)],
      DEFAULT_PAGE_GEOMETRY,
      measurements({ a: 100, b: 80 }),
      { frameChrome: chrome },
    );

    expect(placements[0].rect.height).toBe(128);
    expect(placements[1].rect.y).toBe(128 + DEFAULT_PAGE_GEOMETRY.rowGap);
    expect(placements[1].rect.height).toBe(108);
  });

  it("uses the compact fallback height before plan measurements exist", () => {
    const { placements } = layoutPlan([plan("a", 1)]);
    expect(placements[0].rect.height).toBe(56);
  });

  it("returns one empty page for no components", () => {
    expect(layoutPlan([])).toEqual({ pageCount: 1, placements: [] });
  });
});

function reference(overrides: Partial<ReferenceComponent> = {}): ReferenceComponent {
  return {
    id: "ref",
    type: "reference",
    width: 1,
    contentScale: 1,
    name: "T",
    description: "",
    showDescription: true,
imageHeight: 180, images: [
      { id: "i1", file: "references/0001.png", aspectRatio: 1 },
      { id: "i2", file: "references/0002.png", aspectRatio: 1 },
      { id: "i3", file: "references/0003.png", aspectRatio: 1 },
      { id: "i4", file: "references/0004.png", aspectRatio: 1 },
    ],
    ...overrides,
  };
}

function referenceWithTwelveImages(overrides: Partial<ReferenceComponent> = {}): ReferenceComponent {
  return reference({
    imageHeight: 180,
    images: Array.from({ length: 12 }, (_, index) => ({
      id: `img-${index + 1}`,
      file: `references/${String(index + 1).padStart(4, "0")}.png`,
      aspectRatio: 1,
    })),
    ...overrides,
  });
}

describe("reference image slots", () => {
  it("lays out aspect-ratio slots below the title band", () => {
    const rect = { x: 0, y: 0, width: 300, height: 300 };
    // Use smaller imageHeight so multiple images fit per row in a 300pt wide rect
    const slots = referenceImageSlots(rect, reference({ imageHeight: 80 }));
    expect(slots).toHaveLength(4);
    // All images start at or below the title band
    expect(slots[0].y).toBeGreaterThanOrEqual(TITLE_BAND);
    // The first three images fit on the first row.
    expect(slots[0].y).toBe(slots[1].y);
    expect(slots[1].x).toBeGreaterThan(slots[0].x);
    // When aspect ratio defaults to 1.0 and captions off, images are square
    expect(slots[0].width).toBeCloseTo(slots[0].height, 5);
    expect(slots[2].y).toBe(slots[0].y);
    expect(slots[3].y).toBeGreaterThan(slots[0].y);
  });

  it("adds a caption band only to images with captions", () => {
    const rect = { x: 0, y: 0, width: 300, height: 400 };
    const slots = referenceImageSlots(rect, reference({
      images: [{ id: "captioned", file: "captioned.png", aspectRatio: 1, caption: "Palette" }],
    }));
    const { image, caption } = slotCaptionSplit(slots[0], slots[0].captionHeight);
    expect(caption.height).toBeCloseTo(slots[0].height - image.height, 5);
    expect(caption.height).toBeGreaterThan(0);
    expect(image.width).toBe(slots[0].width);
    expect(caption.y).toBeCloseTo(image.y + image.height, 5);
  });

  it("returns the whole slot as the image when an image has no caption", () => {
    const slot = { x: 1, y: 2, width: 10, height: 10 };
    expect(slotCaptionSplit(slot, 0)).toEqual({ image: slot, caption: { x: 1, y: 12, width: 10, height: 0 } });
  });

  it("splits a captioned slot into image and caption regions", () => {
    const slotSize = 120;
    const tileHeight = 160;
    const slot = { x: 0, y: 0, width: slotSize, height: tileHeight };
    const { image, caption } = slotCaptionSplit(slot, 40);
    expect(caption.height).toBeGreaterThan(0);
    expect(image.height).toBeGreaterThan(caption.height); // image is the dominant band
    expect(image.height + caption.height).toBe(slot.height); // bands fill the slot
    // Caption band starts directly below the image band
    expect(caption.y).toBe(image.y + image.height);
    expect(caption.x).toBe(image.x);
    expect(caption.width).toBe(image.width);
    expect(Math.abs(image.width - image.height)).toBeLessThanOrEqual(1);
  });

  it("populates imageSlots on reference placements via layoutPlan", () => {
    const result = layoutPlan([reference()]);
    expect(result.placements[0].imageSlots).toBeDefined();
    expect(result.placements[0].imageSlots).toHaveLength(5);
    expect(result.placements[0].imageSlots?.map((slot) => slot.id)).toEqual([
      "i1",
      "i2",
      "i3",
      "i4",
      "__add__",
    ]);
  });

  it("reserves the measured reference description and its rendered gap", () => {
    const withoutDescription = layoutPlan([reference({ description: "" })]).placements[0];
    const withDescription = layoutPlan(
      [reference({ description: "<p>Details</p>" })],
      DEFAULT_PAGE_GEOMETRY,
      {
        planHeights: new Map(),
        referenceDescriptionHeights: new Map([["ref", 40]]),
      },
    ).placements[0];

    expect(withDescription.rect.height - withoutDescription.rect.height).toBe(
      40 + REFERENCE_DESCRIPTION_GAP,
    );
  });

  it("does not reserve a hidden reference description", () => {
    const withoutDescription = layoutPlan([reference({ description: "" })]).placements[0];
    const hiddenDescription = layoutPlan(
      [reference({ description: "<p>Details</p>", showDescription: false })],
      DEFAULT_PAGE_GEOMETRY,
      {
        planHeights: new Map(),
        referenceDescriptionHeights: new Map([["ref", 40]]),
      },
    ).placements[0];

    expect(hiddenDescription.rect.height).toBe(withoutDescription.rect.height);
  });

  it("fits all slots inside the gutter-inset content box (no horizontal overflow)", () => {
    const rect = { x: 0, y: 0, width: 300, height: 300 };
    const slots = referenceImageSlots(rect, reference());
    // The rightmost slot's right edge must not exceed the content width (rect.width - gutter)
    const contentWidth = rect.width - DEFAULT_PAGE_GEOMETRY.gutter;
    const maxRight = Math.max(...slots.map((slot) => slot.x + slot.width));
    expect(maxRight).toBeLessThanOrEqual(contentWidth);
  });

  it("spaces captioned multi-row images by full slot height without overlap", () => {
    // Create a scenario where images wrap: 3 square images, imageHeight 100,
    // rect narrow enough that only 2 fit per row
    const ih = 100;
    const slotHeight = 114.8; // 100pt image plus one normal caption line
    const gutter = IMAGE_GAP;
    // Width calculation: need 2 images per row, so width > 2*(ih + gutter) but < 3*ih
    // innerWidth = width - gutter; for 2 per row: innerWidth ~= 2*ih + gutter
    const rect = { x: 0, y: 0, width: 250, height: 500 };
    const top = TITLE_BAND; // no description
    
    const comp: ReferenceComponent = {
      id: "r",
      type: "reference",
      width: 1,
      contentScale: 1,
      name: "Test",
      description: "",
      showDescription: true,
imageHeight: ih,
      images: [
        { id: "i1", file: "1.png", aspectRatio: 1 },
        { id: "i2", file: "2.png", aspectRatio: 1, caption: "Palette" },
        { id: "i3", file: "3.png", aspectRatio: 1, caption: "Palette" },
      ],
    };
    
    const slots = referenceImageSlots(rect, comp);
    expect(slots).toHaveLength(3);
    
    // First row: slots 0 and 1 should both have y = top
    expect(slots[0].y).toBe(top);
    expect(slots[1].y).toBe(top);
    
    const expectedSecondRowY = top + slotHeight + gutter;
    expect(slots[2].y).toBe(expectedSecondRowY);
    
    // Verify no overlap: first row bottom (y + height) should not exceed second row top
    const firstRowBottom = slots[0].y + slots[0].height;
    expect(firstRowBottom).toBeLessThanOrEqual(slots[2].y);
    
    expect(slots[0].height).toBe(ih);
    expect(slots[1].height).toBeCloseTo(slotHeight, 5);
    expect(slots[2].height).toBeCloseTo(slotHeight, 5);
  });

  it("emits multiple fragments for a reference group whose rows cross pages", () => {
    const narrowGeometry = {
      ...DEFAULT_PAGE_GEOMETRY,
      page: { ...DEFAULT_PAGE_GEOMETRY.page, height: 540 },
    };

    const result = layoutPlan([referenceWithTwelveImages()], narrowGeometry);
    const fragments = result.placements.filter((placement) => placement.componentId === "ref");
    const pageHeight = contentSize(narrowGeometry).height;

    expect(fragments.length).toBeGreaterThan(1);
    expect(fragments[0]).toMatchObject({ fragmentId: "ref::0", fragmentIndex: 0, kind: "first", pageIndex: 0 });
    expect(fragments[1]).toMatchObject({ fragmentId: "ref::1", fragmentIndex: 1, kind: "continuation", pageIndex: 1 });
    expect(fragments[1].rect.y).toBe(0);
    expect(
      Math.min(
        ...(fragments[1].imageSlots ?? [])
          .filter((slot) => slot.kind === "image")
          .map((slot) => slot.y),
      ),
    ).toBe(0);
    expect(new Set(fragments.map((fragment) => fragment.pageIndex)).size).toBe(fragments.length);
    expect(fragments.every((fragment) => fragment.rect.y + fragment.rect.height <= pageHeight + 0.01)).toBe(true);
    expect(fragments.flatMap((fragment) => fragment.imageSlots?.map((slot) => slot.id) ?? [])).toContain("__add__");
  });

  it("keeps image rows and following components after a multi-page reference description", () => {
    const geometry = {
      ...DEFAULT_PAGE_GEOMETRY,
      pageGap: 16,
    };
    const pageSpan = geometry.page.height + geometry.pageGap;
    const surfaceTop = (placement: {
      pageIndex: number;
      rect: { y: number };
    }) => placement.pageIndex * pageSpan + geometry.margin + placement.rect.y;
    const longReference = reference({
      description: "<p>Long description</p>",
      images: [
        { id: "i1", file: "references/0001.png", aspectRatio: 1 },
        { id: "i2", file: "references/0002.png", aspectRatio: 1 },
      ],
    });

    const result = layoutPlan(
      [longReference, plan("following", 1)],
      geometry,
      {
        planHeights: new Map([["following", 80]]),
        referenceDescriptionHeights: new Map([
          ["ref", content.height * 2 + 100],
        ]),
      },
      { frameChrome: { topBarHeight: 24, contentGap: 4 } },
    );
    const referencePlacements = result.placements.filter(
      (placement) => placement.componentId === "ref",
    );
    const descriptionPlacement = referencePlacements[0];
    const imagePlacements = referencePlacements.filter((placement) =>
      placement.imageSlots?.some((slot) => slot.kind === "image"),
    );
    const followingPlacement = result.placements.find(
      (placement) => placement.componentId === "following",
    );

    expect(descriptionPlacement.rect.height).toBeGreaterThan(content.height);
    expect(descriptionPlacement.imageSlots).toEqual([]);
    expect(imagePlacements.length).toBeGreaterThan(0);
    expect(
      imagePlacements.flatMap((placement) => placement.imageSlots ?? []).every(
        (slot) => slot.width > 0 && slot.height > 0,
      ),
    ).toBe(true);
    expect(surfaceTop(imagePlacements[0])).toBeGreaterThanOrEqual(
      surfaceTop(descriptionPlacement) + descriptionPlacement.rect.height,
    );

    const finalReferencePlacement =
      referencePlacements[referencePlacements.length - 1];
    expect(followingPlacement).toBeDefined();
    expect(surfaceTop(followingPlacement!)).toBeGreaterThanOrEqual(
      surfaceTop(finalReferencePlacement) + finalReferencePlacement.rect.height,
    );
  });

  it("reserves configured frame chrome for every reference fragment", () => {
    const chromeHeight = 28;
    const narrowGeometry = {
      ...DEFAULT_PAGE_GEOMETRY,
      page: { ...DEFAULT_PAGE_GEOMETRY.page, height: 540 },
    };

    const fragments = layoutPlan(
      [referenceWithTwelveImages()],
      narrowGeometry,
      measurements(),
      { frameChrome: { topBarHeight: 24, contentGap: 4 } },
    ).placements;

    expect(fragments.length).toBeGreaterThan(1);
    for (const fragment of fragments) {
      const maxSlotBottom = Math.max(
        ...(fragment.imageSlots ?? []).map((slot) => slot.y + slot.height),
      );
      expect(fragment.rect.height - maxSlotBottom).toBeCloseTo(
        COMPONENT_INSET * 2 + chromeHeight,
        5,
      );
    }
  });
});

describe("continuous width layout", () => {
  function mk(id: string, width: number): PlanComponent {
    return { id, name: "文案1", type: "plan", width, contentScale: 1, html: "" };
  }

  it("packs two sub-half-width components on one row and wraps wider ones", () => {
    const a = layoutPlan([
      mk("a", 0.4),
      mk("b", 0.4),
    ], DEFAULT_PAGE_GEOMETRY);
    expect(a.placements[0].rect.y).toBe(a.placements[1].rect.y); // same row
    const b = layoutPlan([
      mk("a", 0.6),
      mk("b", 0.6),
    ], DEFAULT_PAGE_GEOMETRY);
    expect(b.placements[1].rect.y).toBeGreaterThan(b.placements[0].rect.y); // wrapped
  });
});

describe("aspect-ratio reference image slots", () => {
  it("packs images at imageHeight using aspect ratios (landscape + portrait)", () => {
    const rect = { x: 0, y: 0, width: 300, height: 300 };
    const comp = reference({
      imageHeight: 100,
      images: [
        { id: "i1", file: "landscape.png", aspectRatio: 2 }, // width ~200
        { id: "i2", file: "portrait.png", aspectRatio: 0.5 }, // width ~50
      ],
    });
    const slots = referenceImageSlots(rect, comp);
    expect(slots).toHaveLength(2);
    // Both images should fit on one row at the specified height
    expect(slots[0].height).toBeCloseTo(100, 1);
    expect(slots[1].height).toBeCloseTo(100, 1);
    // Widths should match imageHeight × aspectRatio
    expect(slots[0].width).toBeCloseTo(200, 1); // 100 * 2
    expect(slots[1].width).toBeCloseTo(50, 1); // 100 * 0.5
    // Both on same row (same y)
    expect(slots[0].y).toBe(slots[1].y);
    // Second image should be positioned after the first + gap
    expect(slots[1].x).toBeGreaterThan(slots[0].x + slots[0].width);
  });

  it("adds a caption band to the individual image with a caption", () => {
    const rect = { x: 0, y: 0, width: 400, height: 400 };
    const comp = reference({
      imageHeight: 100,
images: [
        { id: "i1", file: "photo.png", aspectRatio: 1.5, caption: "Test" },
      ],
    });
    const slots = referenceImageSlots(rect, comp);
    expect(slots).toHaveLength(1);
    const expectedSlotHeight = 114.8;
    expect(slots[0].height).toBeCloseTo(expectedSlotHeight, 5);
    const { image, caption } = slotCaptionSplit(slots[0], slots[0].captionHeight);
    expect(image.height).toBe(100);
    expect(caption.height).toBeCloseTo(expectedSlotHeight - 100, 5);
    expect(caption.y).toBe(image.y + image.height);
  });

  it("uses DEFAULT_IMAGE_HEIGHT when the component is configured with the new default", () => {
    const rect = { x: 0, y: 0, width: 400, height: 400 };
    const comp = reference({
      imageHeight: DEFAULT_IMAGE_HEIGHT,
      images: [
        { id: "i1", file: "photo.png", aspectRatio: 1 },
      ],
    });
    const slots = referenceImageSlots(rect, comp);
    expect(slots).toHaveLength(1);
    expect(slots[0].height).toBeCloseTo(DEFAULT_IMAGE_HEIGHT, 1);
    expect(slots[0].width).toBeCloseTo(DEFAULT_IMAGE_HEIGHT, 1);
  });
});
