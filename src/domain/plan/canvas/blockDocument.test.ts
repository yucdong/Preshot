import { describe, expect, it } from "vitest";
import type { ReferenceComponent, ReferenceImage } from "./models";
import {
  ARTIFACT_COLLECTION_IMAGE_LIMIT,
  ARTIFACT_IMAGE_LIMIT,
  ARTIFACT_RECORD_LIMIT,
  artifactCollectionsInPlan,
  artifactIdsInBlockDocument,
  createEmptyProjectPlanV14,
  createEmptyProjectPlanV15,
  mediaFilesInBlockDocument,
  migrateProjectPlanV13ToV14,
  migrateProjectPlanV13ToV15,
  migrateProjectPlanV14ToV15,
  type ArtifactRecord,
  type PropArtifact,
  type ProjectPlanV15,
  validateBlockDocument,
  validateProjectPlanV15,
} from "./blockDocument";

function image(id: string): ReferenceImage {
  return {
    id,
    file: `references/${id}.png`,
    aspectRatio: 1.5,
    sourceWidth: 900,
    sourceHeight: 600,
    frameWidth: 240,
    frameHeight: 160,
  };
}

function group(id: string, images: ReferenceImage[] = []): ReferenceComponent {
  return {
    id,
    name: id,
    type: "reference",
    x: 0,
    width: 400,
    height: 300,
    description: "",
    images,
  };
}

function marker(artifact: ArtifactRecord) {
  return {
    id: `block-${artifact.id}`,
    type: artifact.kind,
    props: { artifactId: artifact.id },
    content: undefined,
    children: [],
  };
}

function prop(
  id: string,
  images: ReferenceImage[] = [],
): PropArtifact {
  return {
    id,
    kind: "prop",
    revision: 0,
    title: `Prop ${id}`,
    gallery: { id: `gallery-${id}`, images },
    source: "",
  };
}

function planWithArtifacts(artifacts: ArtifactRecord[]): ProjectPlanV15 {
  return {
    schemaVersion: 15,
    title: "Artifacts",
    document: {
      format: "preshot-blocks",
      version: 3,
      blocks: artifacts.map(marker),
    },
    imageGroups: [],
    artifacts,
  };
}

describe("BlockNote plan v15", () => {
  it("accepts only explicit cover or stretch image fit modes", () => {
    const stretched = prop("stretched", [{
      ...image("image"),
      fitMode: "stretch",
    }]);
    expect(validateProjectPlanV15(planWithArtifacts([stretched]))
      .artifacts[0]).toMatchObject(stretched);

    const invalid = structuredClone(planWithArtifacts([stretched]));
    const artifact = invalid.artifacts[0];
    if (artifact.kind === "prop") {
      (artifact.gallery.images[0] as unknown as { fitMode: string }).fitMode =
        "contain";
    }
    expect(() => validateProjectPlanV15(invalid)).toThrow(/fitMode/i);
  });

  it("creates schema-v15 document-v3 plans through canonical and compatibility APIs", () => {
    const expected = {
      schemaVersion: 15,
      title: "Editorial",
      document: {
        format: "preshot-blocks",
        version: 3,
        blocks: [{
          id: "block-1",
          type: "paragraph",
          props: {},
          content: [],
          children: [],
        }],
      },
      imageGroups: [],
      artifacts: [],
    };

    expect(createEmptyProjectPlanV15(
      "Editorial",
      { makeId: () => "block-1" },
    )).toEqual(expected);
    expect(createEmptyProjectPlanV14(
      "Editorial",
      { makeId: () => "block-1" },
    )).toEqual(expected);
  });

  it("validates all strict artifact records and marker correspondence", () => {
    const artifacts: ArtifactRecord[] = [
      {
        id: "location",
        kind: "shootingLocation",
        revision: 1,
        venueName: "Studio A",
        address: "1 Camera Road",
        description: "North-facing windows",
        gallery: { id: "location-gallery", images: [image("location-image")] },
      },
      {
        id: "model",
        kind: "modelCard",
        revision: 2,
        modelId: "M-001",
        heightCm: 172.5,
        weightKg: null,
        shoeSize: "EU 39",
        notes: "Available after 14:00",
        layout: {
          widthRatio: 0.6,
          offsetRatio: 0.1,
          minHeight: 320,
        },
        samples: { id: "model-samples", images: [image("model-image")] },
      },
      {
        id: "look",
        kind: "clothing",
        revision: 3,
        title: "Evening look",
        mainGallery: { id: "look-main", images: [image("look-image")] },
        tryOn: {
          expanded: true,
          gallery: { id: "look-try-on", images: [image("try-on-image")] },
        },
        source: "Wardrobe",
      },
      prop("reflector", [image("prop-image")]),
    ];
    const plan = planWithArtifacts(artifacts);

    expect(validateProjectPlanV15(plan)).toEqual(plan);
    expect(() => validateProjectPlanV15({
      ...plan,
      artifacts: plan.artifacts.map((artifact) =>
        artifact.kind === "modelCard"
          ? { ...artifact, notes: 42 }
          : artifact),
    })).toThrow(/notes must be text/i);
    expect(() => validateProjectPlanV15({
      ...plan,
      artifacts: plan.artifacts.map((artifact) =>
        artifact.kind === "modelCard"
          ? {
              ...artifact,
              layout: { widthRatio: 0.8, offsetRatio: 0.4 },
            }
          : artifact),
    })).toThrow(/layout is malformed/i);
    expect(artifactIdsInBlockDocument(plan.document)).toEqual([
      "location",
      "model",
      "look",
      "reflector",
    ]);
    expect(artifactCollectionsInPlan(plan).map(({ id }) => id)).toEqual([
      "location-gallery",
      "model-samples",
      "look-main",
      "look-try-on",
      "gallery-reflector",
    ]);
    expect(() => validateProjectPlanV15({
      ...plan,
      artifacts: [{
        ...artifacts[0],
        unsupported: true,
      }],
      document: {
        ...plan.document,
        blocks: [marker(artifacts[0])],
      },
    })).toThrow(/unsupported field/i);
  });

  it("requires one kind-matched record for every artifact marker", () => {
    const artifact = prop("reflector");
    const plan = planWithArtifacts([artifact]);

    expect(() => validateProjectPlanV15({
      ...plan,
      artifacts: [],
    })).toThrow(/missing artifact/i);
    expect(() => validateProjectPlanV15({
      ...plan,
      document: {
        ...plan.document,
        blocks: [...plan.document.blocks, {
          ...marker(artifact),
          id: "duplicate-marker",
        }],
      },
    })).toThrow(/2 times/i);
    expect(() => validateProjectPlanV15({
      ...plan,
      document: {
        ...plan.document,
        blocks: [],
      },
    })).toThrow(/exactly once/i);
    expect(() => validateProjectPlanV15({
      ...plan,
      document: {
        ...plan.document,
        blocks: [{
          ...marker(artifact),
          type: "clothing",
        }],
      },
    })).toThrow(/does not match/i);
    expect(() => validateProjectPlanV15({
      ...plan,
      document: {
        ...plan.document,
        blocks: [{
          ...marker(artifact),
          props: { artifactId: artifact.id, title: "leaked sidecar" },
        }],
      },
    })).toThrow(/marker block.*malformed/i);
  });

  it("enforces unique artifact and image IDs across every collection", () => {
    const artifact = prop("reflector", [image("shared-image")]);
    const base = planWithArtifacts([artifact]);
    const withGroup: ProjectPlanV15 = {
      ...base,
      document: {
        ...base.document,
        blocks: [{
          id: "group-block",
          type: "imageGroup",
          props: { groupId: "group" },
          content: undefined,
          children: [],
        }, ...base.document.blocks],
      },
      imageGroups: [group("group", [image("shared-image")])],
    };

    expect(() => validateProjectPlanV15(withGroup)).toThrow(
      /image id "shared-image".*globally unique/i,
    );
    const duplicateArtifactPlan = planWithArtifacts([
      artifact,
      { ...artifact, gallery: { id: "other-gallery", images: [] } },
    ]);
    duplicateArtifactPlan.document.blocks[1]!.id = "second-artifact-block";
    expect(() => validateProjectPlanV15(duplicateArtifactPlan)).toThrow(
      /artifact id "reflector".*unique/i,
    );
    expect(() => validateProjectPlanV15(planWithArtifacts([
      artifact,
      prop("second", [image("shared-image")]),
    ]))).toThrow(/image id "shared-image".*globally unique/i);
    expect(() => validateProjectPlanV15(planWithArtifacts([
      prop("absolute", [{
        ...image("absolute-image"),
        file: "C:\\photos\\absolute.png",
      }]),
    ]))).toThrow(/project-relative reference/i);
  });

  it("enforces artifact record and image caps without capping legacy groups", () => {
    const tooManyArtifacts = Array.from(
      { length: ARTIFACT_RECORD_LIMIT + 1 },
      (_, index) => prop(`artifact-${index}`),
    );
    expect(() => validateProjectPlanV15(
      planWithArtifacts(tooManyArtifacts),
    )).toThrow(/512-artifact limit/i);

    const tooManyCollectionImages = Array.from(
      { length: ARTIFACT_COLLECTION_IMAGE_LIMIT + 1 },
      (_, index) => image(`collection-${index}`),
    );
    expect(() => validateProjectPlanV15(planWithArtifacts([
      prop("large", tooManyCollectionImages),
    ]))).toThrow(/128-image limit/i);

    const artifactImageOverflow = Array.from(
      { length: ARTIFACT_IMAGE_LIMIT / ARTIFACT_COLLECTION_IMAGE_LIMIT + 1 },
      (_, artifactIndex) => prop(
        `overflow-${artifactIndex}`,
        Array.from(
          {
            length: artifactIndex ===
                ARTIFACT_IMAGE_LIMIT / ARTIFACT_COLLECTION_IMAGE_LIMIT
              ? 1
              : ARTIFACT_COLLECTION_IMAGE_LIMIT,
          },
          (_, imageIndex) => image(`overflow-${artifactIndex}-${imageIndex}`),
        ),
      ),
    );
    expect(() => validateProjectPlanV15(
      planWithArtifacts(artifactImageOverflow),
    )).toThrow(/2048-artifact-image limit/i);

    const legacyImages = Array.from(
      { length: ARTIFACT_IMAGE_LIMIT + 1 },
      (_, index) => image(`legacy-${index}`),
    );
    const legacyPlan: ProjectPlanV15 = {
      ...planWithArtifacts([]),
      document: {
        format: "preshot-blocks",
        version: 3,
        blocks: [{
          id: "legacy-marker",
          type: "imageGroup",
          props: { groupId: "legacy" },
          content: undefined,
          children: [],
        }],
      },
      imageGroups: [group("legacy", legacyImages)],
    };
    expect(validateProjectPlanV15(legacyPlan)).toEqual(legacyPlan);
  });

  it("validates image groups only at the top level", () => {
    const plan: ProjectPlanV15 = {
      schemaVersion: 15,
      title: "Editorial",
      document: {
        format: "preshot-blocks",
        version: 3,
        blocks: [{
          id: "block-1",
          type: "imageGroup",
          props: { groupId: "group-1" },
          content: undefined,
          children: [],
        }],
      },
      imageGroups: [group("group-1")],
      artifacts: [],
    };

    expect(validateProjectPlanV15(plan)).toEqual(plan);
    expect(() => validateProjectPlanV15({
      ...plan,
      document: {
        ...plan.document,
        blocks: [{
          id: "parent",
          type: "paragraph",
          props: {},
          content: [],
          children: [{
            id: "nested-image-group",
            type: "imageGroup",
            props: { groupId: "group-1" },
            content: undefined,
            children: [],
          }],
        }],
      },
    })).toThrow(/top-level/i);
  });

  it("deterministically migrates v14 and repairs duplicate legacy image IDs", () => {
    const legacy = {
      schemaVersion: 14,
      title: "Editorial",
      document: {
        format: "preshot-blocks",
        version: 2,
        blocks: [
          {
            id: "first-marker",
            type: "imageGroup",
            props: { groupId: "first" },
            content: undefined,
            children: [],
          },
          {
            id: "second-marker",
            type: "imageGroup",
            props: { groupId: "second" },
            content: undefined,
            children: [],
          },
        ],
      },
      imageGroups: [
        group("first", [image("photo"), image("photo")]),
        group("second", [image("photo--v15-2"), image("photo")]),
      ],
    };

    const first = migrateProjectPlanV14ToV15(legacy);
    const second = migrateProjectPlanV14ToV15(structuredClone(legacy));

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schemaVersion: 15,
      document: { version: 3 },
      artifacts: [],
    });
    expect(first.imageGroups.flatMap((entry) =>
      entry.images.map(({ id }) => id)
    )).toEqual([
      "photo",
      "photo--v15-3",
      "photo--v15-2",
      "photo--v15-4",
    ]);
    expect(first.imageGroups.flatMap((entry) =>
      entry.images.map(({ id: _id, ...rest }) => rest)
    )).toEqual(legacy.imageGroups.flatMap((entry) =>
      entry.images.map(({ id: _id, ...rest }) => rest)
    ));
  });

  it("chains v13 through v14 before producing v15", () => {
    const legacy = {
      schemaVersion: 13,
      title: "Editorial",
      document: {
        format: "preshot-blocks",
        version: 1,
        blocks: [{
          id: "paragraph",
          type: "paragraph",
          props: {},
          content: [],
          children: [],
        }],
      },
      imageGroups: [],
    };

    expect(migrateProjectPlanV13ToV14(legacy)).toMatchObject({
      schemaVersion: 14,
      document: { version: 2 },
    });
    expect(migrateProjectPlanV13ToV15(legacy)).toEqual({
      ...legacy,
      schemaVersion: 15,
      document: {
        ...legacy.document,
        version: 3,
      },
      artifacts: [],
    });
  });

  it("validates native media blocks and collects project media files", () => {
    const document = {
      format: "preshot-blocks",
      version: 3,
      blocks: [
        {
          id: "image",
          type: "image",
          props: {
            backgroundColor: "default",
            textAlignment: "left",
            name: "look.png",
            url: "media/0001.png",
            caption: "Look",
            showPreview: true,
            previewWidth: 320,
          },
          content: undefined,
          children: [],
        },
        {
          id: "video",
          type: "video",
          props: {
            backgroundColor: "default",
            textAlignment: "left",
            name: "clip.mp4",
            url: "https://example.com/clip.mp4",
            caption: "",
            showPreview: true,
          },
          content: undefined,
          children: [],
        },
      ],
    };

    expect(mediaFilesInBlockDocument(
      validateBlockDocument(document),
    )).toEqual(["media/0001.png"]);
    expect(() => validateBlockDocument({
      ...document,
      blocks: [{
        ...document.blocks[0],
        props: {
          ...document.blocks[0].props,
          url: "data:image/png;base64,AA",
        },
      }],
    })).toThrow(/media block/i);
  });
});
