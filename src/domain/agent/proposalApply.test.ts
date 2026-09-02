import { describe, expect, it } from "vitest";
import type {
  PreshotBlock,
  ProjectPlanV14,
} from "../plan/canvas/blockDocument";
import {
  createAgentTextEditProposal,
  hashPreshotBlock,
  hashPreshotDocument,
} from "./proposal";
import {
  applyAgentTextEditProposal,
  discardAgentTextEditProposal,
  projectAgentTextEditProposal,
  undoAgentProposalApply,
} from "./proposalApply";

function textBlock(id: string, text: string): PreshotBlock {
  return {
    id,
    type: "paragraph",
    props: { textAlignment: "left" },
    content: [{ type: "text", text, styles: {} }],
    children: [],
  };
}

function plan(): ProjectPlanV14 {
  return {
    schemaVersion: 14,
    title: "Editorial",
    document: {
      format: "preshot-blocks",
      version: 2,
      blocks: [
        textBlock("intro", "Before"),
        {
          id: "image-group-block",
          type: "imageGroup",
          props: { groupId: "group-1" },
          content: undefined,
          children: [],
        },
        textBlock("outro", "Keep me"),
      ],
    },
    imageGroups: [{
      id: "group-1",
      name: "References",
      type: "reference",
      x: 0,
      width: 400,
      height: 300,
      description: "Untouched",
      images: [],
    }],
  };
}

function proposalFor(
  current: ProjectPlanV14,
  operations: unknown[],
  revision = 3,
) {
  return createAgentTextEditProposal({
    proposalId: "proposal-1",
    sessionId: "session-1",
    baseRevision: revision,
    baseDocumentHash: hashPreshotDocument(current.document),
  }, {
    summary: "Update text",
    operations,
  });
}

describe("agent proposal projection, apply, discard, and undo", () => {
  it("projects updates and trusted-ID inserts without mutating the source plan", () => {
    const current = plan();
    const intro = current.document.blocks[0];
    const imageGroupBlock = current.document.blocks[1];
    const outro = current.document.blocks[2];
    const proposal = proposalFor(current, [
      {
        op: "update",
        blockId: intro.id,
        expectedBlockHash: hashPreshotBlock(intro),
        patch: { text: "After" },
      },
      {
        op: "insertAfter",
        referenceBlockId: imageGroupBlock.id,
        expectedReferenceHash: hashPreshotBlock(imageGroupBlock),
        blocks: [{ type: "heading", text: "New section", props: { level: 2 } }],
      },
    ]);
    const projected = projectAgentTextEditProposal(
      current,
      3,
      proposal,
      () => "trusted-id",
    );
    expect(projected.status).toBe("projected");
    if (projected.status !== "projected") return;
    expect(current.document.blocks[0]).toBe(intro);
    expect(current.document.blocks).toHaveLength(3);
    expect(projected.plan.document.blocks).toHaveLength(4);
    expect(projected.plan.document.blocks[0].content).toEqual([
      { type: "text", text: "After", styles: {} },
    ]);
    expect(projected.plan.document.blocks[2]).toMatchObject({
      id: "trusted-id",
      type: "heading",
      props: { level: 2 },
    });
    expect(projected.plan.document.blocks[3]).toBe(outro);
    expect(projected.plan.document.blocks[1]).toBe(imageGroupBlock);
    expect(projected.plan.imageGroups).toBe(current.imageGroups);
    expect(projected.plan.title).toBe(current.title);
  });

  it("reports stale revisions and document hashes before projection", () => {
    const current = plan();
    const intro = current.document.blocks[0];
    const proposal = proposalFor(current, [{
      op: "update",
      blockId: intro.id,
      expectedBlockHash: hashPreshotBlock(intro),
      patch: { text: "After" },
    }]);
    expect(projectAgentTextEditProposal(current, 4, proposal, () => "id"))
      .toMatchObject({ status: "stale", reason: "revision" });
    expect(projectAgentTextEditProposal({
      ...current,
      document: {
        ...current.document,
        blocks: [textBlock("changed", "Changed"), ...current.document.blocks],
      },
    }, 3, proposal, () => "id")).toMatchObject({
      status: "stale",
      reason: "document_hash",
    });
  });

  it("reports hash, missing, non-text, and generated-ID conflicts", () => {
    const current = plan();
    const intro = current.document.blocks[0];
    const wrongHash = hashPreshotBlock(textBlock("intro", "Other"));
    expect(projectAgentTextEditProposal(
      current,
      3,
      proposalFor(current, [{
        op: "update",
        blockId: intro.id,
        expectedBlockHash: wrongHash,
        patch: { text: "After" },
      }]),
      () => "new-id",
    )).toMatchObject({
      status: "conflict",
      conflict: { reason: "hash_mismatch", blockId: "intro" },
    });
    expect(projectAgentTextEditProposal(
      current,
      3,
      proposalFor(current, [{
        op: "delete",
        blockId: "missing",
        expectedBlockHash: wrongHash,
      }]),
      () => "new-id",
    )).toMatchObject({
      status: "conflict",
      conflict: { reason: "missing" },
    });
    const imageGroup = current.document.blocks[1];
    expect(projectAgentTextEditProposal(
      current,
      3,
      proposalFor(current, [{
        op: "delete",
        blockId: imageGroup.id,
        expectedBlockHash: hashPreshotBlock(imageGroup),
      }]),
      () => "new-id",
    )).toMatchObject({
      status: "conflict",
      conflict: { reason: "not_text" },
    });
    expect(projectAgentTextEditProposal(
      current,
      3,
      proposalFor(current, [{
        op: "insertAfter",
        referenceBlockId: intro.id,
        expectedReferenceHash: hashPreshotBlock(intro),
        blocks: [{ type: "paragraph", text: "New" }],
      }]),
      () => "intro",
    )).toMatchObject({
      status: "conflict",
      conflict: { reason: "duplicate_id" },
    });
  });

  it("validates the complete projected v14 document", () => {
    const current: ProjectPlanV14 = {
      ...plan(),
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
              id: "left",
              type: "column",
              props: { width: 1 },
              content: undefined,
              children: [textBlock("left-text", "Delete me")],
            },
            {
              id: "right",
              type: "column",
              props: { width: 1 },
              content: undefined,
              children: [textBlock("right-text", "Keep")],
            },
          ],
        }, plan().document.blocks[1]],
      },
    };
    const target = current.document.blocks[0].children[0].children[0];
    expect(projectAgentTextEditProposal(
      current,
      3,
      proposalFor(current, [{
        op: "delete",
        blockId: target.id,
        expectedBlockHash: hashPreshotBlock(target),
      }]),
      () => "id",
    )).toMatchObject({
      status: "invalid",
      message: expect.stringMatching(/column is malformed/i),
    });
  });

  it("applies one checkpoint, discards atomically, and undoes only without conflicts", () => {
    const current = plan();
    const intro = current.document.blocks[0];
    const proposal = proposalFor(current, [{
      op: "update",
      blockId: intro.id,
      expectedBlockHash: hashPreshotBlock(intro),
      patch: { text: "Applied" },
    }]);
    const applied = applyAgentTextEditProposal(current, 3, proposal, {
      makeId: () => "new-id",
      makeCheckpointId: () => "checkpoint-1",
      appliedAt: "2026-08-22T00:00:00Z",
    });
    expect(applied.status).toBe("applied");
    if (applied.status !== "applied") return;
    expect(applied.revision).toBe(4);
    expect(applied.receipt).toMatchObject({
      status: "applied",
      operationCount: 1,
      appliedRevision: 4,
    });
    expect(applied.checkpoint).toMatchObject({
      checkpointId: "checkpoint-1",
      beforeRevision: 3,
      appliedRevision: 4,
    });
    expect(Object.isFrozen(applied.checkpoint.beforePlan)).toBe(true);
    expect(discardAgentTextEditProposal(proposal, "later")).toEqual({
      proposalId: "proposal-1",
      sessionId: "session-1",
      status: "discarded",
      discardedAt: "later",
      operationCount: 1,
    });

    const undone = undoAgentProposalApply(
      applied.checkpoint,
      applied.plan,
      applied.revision,
    );
    expect(undone).toMatchObject({
      status: "undone",
      revision: 5,
      documentHash: hashPreshotDocument(current.document),
    });
    if (undone.status === "undone") {
      expect(undone.plan).toEqual(current);
      expect(undone.plan).not.toBe(current);
    }
    expect(undoAgentProposalApply(
      applied.checkpoint,
      applied.plan,
      5,
    )).toMatchObject({ status: "undone", revision: 6 });
    const withUnrelatedEdit = {
      ...applied.plan,
      document: {
        ...applied.plan.document,
        blocks: [...applied.plan.document.blocks, textBlock("manual", "Edit")],
      },
    };
    const unrelatedUndo = undoAgentProposalApply(
      applied.checkpoint,
      withUnrelatedEdit,
      4,
    );
    expect(unrelatedUndo).toMatchObject({ status: "undone" });
    if (unrelatedUndo.status === "undone") {
      expect(unrelatedUndo.plan.document.blocks.at(-1)?.id).toBe("manual");
    }
    expect(undoAgentProposalApply(
      applied.checkpoint,
      {
        ...applied.plan,
        document: {
          ...applied.plan.document,
          blocks: applied.plan.document.blocks.map((block) =>
            block.id === "intro" ? textBlock("intro", "User edit") : block
          ),
        },
      },
      4,
    )).toMatchObject({
      status: "conflict",
      reason: "affected_blocks",
      affectedBlockIds: ["intro"],
    });
  });
});
