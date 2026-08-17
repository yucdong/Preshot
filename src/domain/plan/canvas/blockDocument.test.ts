import { describe, expect, it } from "vitest";
import {
  createEmptyProjectPlanV14,
  mediaFilesInBlockDocument,
  migrateProjectPlanV13ToV14,
  validateBlockDocument,
  validateProjectPlanV14,
} from "./blockDocument";

describe("BlockNote plan v14", () => {
  it("creates a portable empty block document", () => {
    expect(createEmptyProjectPlanV14("Editorial", { makeId: () => "block-1" }))
      .toEqual({
        schemaVersion: 14,
        title: "Editorial",
        document: {
          format: "preshot-blocks",
          version: 2,
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

  it("validates image groups at the top level or directly inside columns", () => {
    const plan = {
      schemaVersion: 14,
      title: "Editorial",
      document: {
        format: "preshot-blocks",
        version: 2,
        blocks: [{
          id: "columns",
          type: "columnList",
          props: {},
          content: undefined,
          children: [
            {
              id: "left-column",
              type: "column",
              props: { width: 0.75 },
              content: undefined,
              children: [{
                id: "paragraph",
                type: "paragraph",
                props: {},
                content: [],
                children: [],
              }],
            },
            {
              id: "right-column",
              type: "column",
              props: { width: 1.25 },
              content: undefined,
              children: [{
                id: "block-1",
                type: "imageGroup",
                props: { groupId: "group-1" },
                content: undefined,
                children: [],
              }],
            },
          ],
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

    expect(validateProjectPlanV14(plan)).toEqual(plan);
    expect(() => validateProjectPlanV14({
      ...plan,
      document: {
        ...plan.document,
        blocks: [{
          ...plan.document.blocks[0],
          children: plan.document.blocks[0].children.map((column, index) =>
            index === 1
              ? {
                  ...column,
                  children: [{
                    ...column.children[0],
                    props: { groupId: "missing" },
                  }],
                }
              : column),
        }],
      },
    })).toThrow(/missing image group/i);
    expect(() => validateProjectPlanV14({
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
    })).toThrow(/column/i);
    expect(() => validateProjectPlanV14({
      ...plan,
      document: {
        ...plan.document,
        blocks: [{
          ...plan.document.blocks[0],
          children: [plan.document.blocks[0].children[0]],
        }],
      },
    })).toThrow(/column list/i);
  });

  it("migrates schema 13 documents without changing their blocks", () => {
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

    expect(migrateProjectPlanV13ToV14(legacy)).toEqual({
      ...legacy,
      schemaVersion: 14,
      document: {
        ...legacy.document,
        version: 2,
      },
    });
  });

  it("validates native media blocks and collects project media files", () => {
    const document = {
      format: "preshot-blocks",
      version: 2,
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
