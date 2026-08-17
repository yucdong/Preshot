import { describe, expect, it } from "vitest";
import type { ProjectPlanV14 } from "../canvas/blockDocument";
import { setBlockNoteImageNaturalDimensions } from "./plan";

describe("BlockNote image natural dimensions", () => {
  it("keeps the common frame height and derives width from source ratio", () => {
    const plan: ProjectPlanV14 = {
      schemaVersion: 14,
      title: "Demo",
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
      frameWidth: 216,
      frameHeight: 135,
      crop: { x: 0, y: 0, width: 1, height: 1 },
    });
  });
});
