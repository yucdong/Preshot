import { describe, expect, it } from "vitest";
import {
  createEmptyProjectPlanV13,
  validateProjectPlanV13,
} from "./blockDocument";

describe("BlockNote plan v13", () => {
  it("creates a portable empty block document", () => {
    expect(createEmptyProjectPlanV13("Editorial", { makeId: () => "block-1" }))
      .toEqual({
        schemaVersion: 13,
        title: "Editorial",
        document: {
          format: "preshot-blocks",
          version: 1,
          blocks: [{
            id: "block-1",
            type: "paragraph",
            props: {},
            content: [],
            children: [],
          }],
        },
        imageGroups: [],
      });
  });

  it("strictly validates top-level image-group references", () => {
    const plan = {
      schemaVersion: 13,
      title: "Editorial",
      document: {
        format: "preshot-blocks",
        version: 1,
        blocks: [{
          id: "block-1",
          type: "imageGroup",
          props: { groupId: "group-1" },
          content: undefined,
          children: [],
        }],
      },
      imageGroups: [{
        id: "group-1",
        name: "References",
        type: "reference",
        x: 0,
        width: 400,
        height: 300,
        description: "",
        images: [],
      }],
    };

    expect(validateProjectPlanV13(plan)).toEqual(plan);
    expect(() => validateProjectPlanV13({
      ...plan,
      document: {
        ...plan.document,
        blocks: [{
          ...plan.document.blocks[0],
          props: { groupId: "missing" },
        }],
      },
    })).toThrow(/missing image group/i);
    expect(() => validateProjectPlanV13({
      ...plan,
      document: {
        ...plan.document,
        blocks: [{
          id: "parent",
          type: "paragraph",
          props: {},
          content: [],
          children: [plan.document.blocks[0]],
        }],
      },
    })).toThrow(/top-level/i);
  });
});
