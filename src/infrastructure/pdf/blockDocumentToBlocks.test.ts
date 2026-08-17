import { describe, expect, it } from "vitest";
import type { PreshotBlockDocument } from "../../domain/plan/canvas/blockDocument";
import { blockDocumentToPdfBlocks } from "./blockDocumentToBlocks";

describe("blockDocumentToPdfBlocks", () => {
  it("maps native BlockNote JSON and image groups without HTML", () => {
    const document: PreshotBlockDocument = {
      format: "preshot-blocks",
      version: 1,
      blocks: [
        {
          id: "heading",
          type: "heading",
          props: { level: 1 },
          content: [{ type: "text", text: "Title", styles: { bold: true } }],
          children: [],
        },
        {
          id: "group",
          type: "imageGroup",
          props: { groupId: "group-1" },
          content: undefined,
          children: [],
        },
      ],
    };

    expect(blockDocumentToPdfBlocks(document)).toEqual([
      {
        type: "heading",
        level: 1,
        runs: [{ text: "Title", bold: true }],
      },
      { type: "imageGroup", groupId: "group-1" },
    ]);
  });
});
