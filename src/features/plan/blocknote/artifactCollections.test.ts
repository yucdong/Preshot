import { describe, expect, it } from "vitest";
import type {
  ProjectPlanV15,
} from "../../../domain/plan/canvas/blockDocument";
import type { ReferenceImage } from "../../../domain/plan/canvas/models";
import {
  allCollectionIdsInDocumentOrder,
  artifactCollectionGroups,
  replaceArtifactCollection,
} from "./artifactCollections";

const image: ReferenceImage = {
  id: "image-1",
  file: "references/0001.png",
  aspectRatio: 1,
  frameWidth: 240,
  frameHeight: 240,
};

function plan(): ProjectPlanV15 {
  return {
    schemaVersion: 15,
    title: "Artifacts",
    document: {
      format: "preshot-blocks",
      version: 3,
      blocks: [
        {
          id: "prop-block",
          type: "prop",
          props: { artifactId: "prop-1" },
          content: undefined,
          children: [],
        },
        {
          id: "group-block",
          type: "imageGroup",
          props: { groupId: "group-1" },
          content: undefined,
          children: [],
        },
        {
          id: "clothing-block",
          type: "clothing",
          props: { artifactId: "clothing-1" },
          content: undefined,
          children: [],
        },
      ],
    },
    imageGroups: [{
      id: "group-1",
      name: "References",
      type: "reference",
      x: 0,
      width: 640,
      height: 240,
      description: "",
      images: [],
    }],
    artifacts: [
      {
        id: "prop-1",
        kind: "prop",
        revision: 0,
        title: "Prop",
        source: "",
        gallery: { id: "prop-gallery", images: [image] },
      },
      {
        id: "clothing-1",
        kind: "clothing",
        revision: 0,
        title: "Clothing",
        source: "",
        mainGallery: { id: "clothing-main", images: [] },
        tryOn: {
          expanded: false,
          gallery: { id: "clothing-try-on", images: [] },
        },
      },
    ],
  };
}

describe("artifact collections", () => {
  it("preserves recursive document order across artifact and legacy groups", () => {
    expect(allCollectionIdsInDocumentOrder(plan())).toEqual([
      "prop-gallery",
      "group-1",
      "clothing-main",
    ]);
  });

  it("projects artifact collections as image groups and replaces immutably", () => {
    const original = plan();
    original.artifacts.push({
      id: "model-1",
      kind: "modelCard",
      revision: 0,
      modelId: "Model",
      heightCm: null,
      weightKg: null,
      shoeSize: "",
      samples: { id: "model-samples", images: [] },
    });
    expect(artifactCollectionGroups(original).map((group) => group.id))
      .toEqual([
        "prop-gallery",
        "clothing-main",
        "model-samples",
      ]);
    expect(
      artifactCollectionGroups(original).find(
        (group) => group.id === "model-samples",
      )?.height,
    ).toBe(134);
    const next = replaceArtifactCollection(
      original,
      "clothing-main",
      (collection) => ({ ...collection, images: [image] }),
    );
    expect(next).not.toBe(original);
    expect(
      next.artifacts.find((artifact) => artifact.kind === "clothing")
        ?.mainGallery.images,
    ).toEqual([image]);
    expect(original.artifacts.find(
      (artifact) => artifact.kind === "clothing",
    )?.mainGallery.images).toEqual([]);
  });
});
