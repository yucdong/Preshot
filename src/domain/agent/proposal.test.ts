import { describe, expect, it } from "vitest";
import type {
  PreshotBlock,
  PreshotBlockDocument,
} from "../plan/canvas/blockDocument";
import {
  applyAllowedTextBlockPatch,
  createAgentTextEditProposal,
  hashAgentValue,
  hashPreshotBlock,
  hashPreshotDocument,
  validateAgentTextEditProposal,
} from "./proposal";

function textBlock(
  id: string,
  text: string,
  type: PreshotBlock["type"] = "paragraph",
): PreshotBlock {
  return {
    id,
    type,
    props: {},
    content: [{ type: "text", text, styles: {} }],
    children: [],
  };
}

function document(): PreshotBlockDocument {
  return {
    format: "preshot-blocks",
    version: 2,
    blocks: [textBlock("block-1", "Before")],
  };
}

function envelope() {
  return {
    proposalId: "proposal-1",
    sessionId: "session-1",
    baseRevision: 2,
    baseDocumentHash: hashPreshotDocument(document()),
  };
}

describe("closed agent text proposal schema and hashing", () => {
  it("produces canonical SHA-256 hashes independent of object key order", () => {
    expect(hashAgentValue({ b: 2, a: 1 })).toBe(
      "sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777",
    );
    expect(hashAgentValue({ b: 2, a: 1 }))
      .toBe(hashAgentValue({ a: 1, b: 2 }));
    expect(hashPreshotBlock(document().blocks[0])).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
  });

  it("normalizes update, insert, and delete operations without inserted IDs", () => {
    const block = document().blocks[0];
    const proposal = createAgentTextEditProposal(envelope(), {
      summary: "Revise the opening",
      operations: [
        {
          op: "update",
          blockId: block.id,
          expectedBlockHash: hashPreshotBlock(block),
          patch: {
            type: "heading",
            text: "After",
            props: { level: 2, textAlignment: "center" },
          },
        },
        {
          op: "insertAfter",
          referenceBlockId: block.id,
          expectedReferenceHash: hashPreshotBlock(block),
          blocks: [{
            type: "bulletListItem",
            text: "Shot one",
            children: [{ type: "paragraph", text: "Detail" }],
          }],
        },
        {
          op: "delete",
          blockId: "old-block",
          expectedBlockHash: hashPreshotBlock(textBlock("old-block", "Old")),
        },
      ],
    });
    expect(proposal).toMatchObject({
      version: 1,
      proposalId: "proposal-1",
      operations: [
        { op: "update", patch: { type: "heading", text: "After" } },
        { op: "insertAfter", blocks: [{ type: "bulletListItem" }] },
        { op: "delete" },
      ],
    });
    expect(validateAgentTextEditProposal(proposal)).toEqual(proposal);
    expect("id" in proposal.operations[1]).toBe(false);
  });

  it("rejects model-supplied IDs, schema, paths, media, and arbitrary props", () => {
    const block = document().blocks[0];
    const forbiddenDrafts = [
      { type: "paragraph", text: "Text", id: "model-id" },
      { type: "image", text: "Text", url: "media/file.png" },
      { type: "paragraph", text: "Text", schemaVersion: 14 },
      { type: "paragraph", text: "Text", path: "C:\\secret" },
      { type: "paragraph", text: "Text", props: { groupId: "group-1" } },
    ];
    for (const draft of forbiddenDrafts) {
      expect(() => createAgentTextEditProposal(envelope(), {
        summary: "Forbidden",
        operations: [{
          op: "insertAfter",
          referenceBlockId: block.id,
          expectedReferenceHash: hashPreshotBlock(block),
          blocks: [draft],
        }],
      })).toThrow();
    }
  });

  it("enforces operation, text, insertion, nesting, summary, and duplicate limits", () => {
    const block = document().blocks[0];
    const limits = {
      maxOperations: 2,
      maxInsertedBlocks: 2,
      maxTextCharactersPerBlock: 4,
      maxTotalTextCharacters: 8,
      maxNestingDepth: 2,
      maxSummaryCharacters: 20,
    };
    const insert = (blocks: unknown[]) => ({
      op: "insertAfter",
      referenceBlockId: block.id,
      expectedReferenceHash: hashPreshotBlock(block),
      blocks,
    });
    expect(() => createAgentTextEditProposal(envelope(), {
      summary: "Too much text",
      operations: [insert([{ type: "paragraph", text: "12345" }])],
    }, limits)).toThrow(/at most 4/i);
    expect(() => createAgentTextEditProposal(envelope(), {
      summary: "Too many blocks",
      operations: [insert([
        { type: "paragraph", text: "a" },
        { type: "paragraph", text: "b" },
        { type: "paragraph", text: "c" },
      ])],
    }, limits)).toThrow(/inserted blocks/i);
    expect(() => createAgentTextEditProposal(envelope(), {
      summary: "Total text",
      operations: [insert([
        { type: "paragraph", text: "1234" },
        { type: "paragraph", text: "5678" },
      ])],
    }, { ...limits, maxTotalTextCharacters: 7 })).toThrow(/total text/i);
    expect(() => createAgentTextEditProposal(envelope(), {
      summary: "Nested",
      operations: [insert([{
        type: "paragraph",
        text: "a",
        children: [{
          type: "paragraph",
          text: "b",
          children: [{ type: "paragraph", text: "c" }],
        }],
      }])],
    }, { ...limits, maxInsertedBlocks: 3 })).toThrow(/nesting depth/i);
    expect(() => createAgentTextEditProposal(envelope(), {
      summary: "Too many operations",
      operations: [
        insert([{ type: "paragraph", text: "a" }]),
        insert([{ type: "paragraph", text: "b" }]),
        insert([{ type: "paragraph", text: "c" }]),
      ],
    }, { ...limits, maxInsertedBlocks: 3 })).toThrow(/1-2 operations/i);
    expect(() => createAgentTextEditProposal(envelope(), {
      summary: "Summary too long",
      operations: [insert([{ type: "paragraph", text: "a" }])],
    }, { ...limits, maxSummaryCharacters: 3 })).toThrow(/summary/i);
    expect(() => createAgentTextEditProposal(envelope(), {
      summary: "Duplicate",
      operations: [
        {
          op: "update",
          blockId: block.id,
          expectedBlockHash: hashPreshotBlock(block),
          patch: { text: "One" },
        },
        {
          op: "delete",
          blockId: block.id,
          expectedBlockHash: hashPreshotBlock(block),
        },
      ],
    })).toThrow(/more than once/i);
  });

  it("applies only the closed patch surface and preserves children", () => {
    const child = textBlock("child", "Nested");
    const block = { ...textBlock("block", "Before"), children: [child] };
    const result = applyAllowedTextBlockPatch(block, {
      type: "checkListItem",
      text: "After",
      props: { checked: true },
    });
    expect(result).toMatchObject({
      id: "block",
      type: "checkListItem",
      props: { checked: true },
      content: [{ type: "text", text: "After", styles: {} }],
    });
    expect(result.children).toBe(block.children);
  });
});
