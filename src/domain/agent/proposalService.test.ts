import { describe, expect, it, vi } from "vitest";
import { createMemoryAgentMetadataStore } from "../../infrastructure/agent/memoryAgentMetadataStore";
import type {
  PreshotBlock,
  ProjectPlanV14,
} from "../plan/canvas/blockDocument";
import type { AgentProposalApplicationPort } from "./ports";
import {
  createAgentTextEditProposal,
  hashPreshotBlock,
  hashPreshotDocument,
} from "./proposal";
import {
  applyAgentTextEditProposal,
  undoAgentProposalApply,
} from "./proposalApply";
import { AgentProposalService } from "./proposalService";
import type { AgentMetadataStorePort } from "./metadataStore";
import { AgentProposalTemporaryError } from "./errors";

function block(
  id: string,
  text: string,
  children: PreshotBlock[] = [],
): PreshotBlock {
  return {
    id,
    type: "paragraph",
    props: {},
    content: [{ type: "text", text, styles: {} }],
    children,
  };
}

function plan(): ProjectPlanV14 {
  return {
    schemaVersion: 15,
    title: "Proposal",
    document: {
      format: "preshot-blocks",
      version: 3,
      blocks: [
        block("intro", "Before"),
        block("parent", "Parent", [block("nested", "Nested")]),
        block("remove", "Delete"),
        block("keep", "Keep"),
      ],
    },
    imageGroups: [],
    artifacts: [],
  };
}

async function harness() {
  const metadata = createMemoryAgentMetadataStore({
    now: (() => {
      let sequence = 0;
      return () => new Date(++sequence * 1_000).toISOString();
    })(),
  });
  await metadata.adoptProject({
    projectId: "project-1",
    projectPath: "C:\\Project",
    projectName: "Project",
  });
  await metadata.createSession({
    sessionId: "session-1",
    projectId: "project-1",
    title: "Session",
    state: "idle",
  });
  let current = plan();
  let revision = 3;
  const applyAtomically = vi.fn<
    AgentProposalApplicationPort["applyAtomically"]
  >(async (input) => {
    expect(input.expectedRevision).toBe(revision);
    expect(input.expectedDocumentHash).toBe(
      hashPreshotDocument(current.document),
    );
    current = structuredClone(input.projectedPlan);
    revision += 1;
  });
  const restoreCheckpointAtomically = vi.fn<
    AgentProposalApplicationPort["restoreCheckpointAtomically"]
  >(async (input) => {
    expect(input.expectedRevision).toBe(revision);
    current = structuredClone(input.restoredPlan);
    revision += 1;
  });
  const rollbackAtomically = vi.fn<
    AgentProposalApplicationPort["rollbackAtomically"]
  >(async (input) => {
    expect(input.expectedRevision).toBe(revision);
    current = structuredClone(input.snapshotPlan);
    revision = input.snapshotRevision;
  });
  const application: AgentProposalApplicationPort = {
    getReadiness: (projectId) => ({
      status: "ready",
      projectId,
      revision,
    }),
    subscribeReadiness: () => () => undefined,
    async getCurrentPlan(projectId) {
      if (projectId !== "project-1") throw new Error("wrong project");
      return { plan: structuredClone(current), revision };
    },
    applyAtomically,
    restoreCheckpointAtomically,
    rollbackAtomically,
  };
  let id = 0;
  const service = (overrides: {
    readonly metadata?: AgentMetadataStorePort;
    readonly application?: AgentProposalApplicationPort;
  } = {}) => new AgentProposalService({
    metadata: overrides.metadata ?? metadata,
    application: overrides.application ?? application,
    makeId: () => `trusted-${++id}`,
    now: () => "2026-08-22T00:00:00.000Z",
  });
  return {
    metadata,
    application,
    applyAtomically,
    restoreCheckpointAtomically,
    rollbackAtomically,
    service,
    current: () => current,
    revision: () => revision,
    userEdit(next: ProjectPlanV14) {
      current = next;
      revision += 1;
    },
  };
}

describe("AgentProposalService", () => {
  it("projects a stacked diff without mutation, gates deletion, applies once, and restarts undo", async () => {
    const test = await harness();
    const before = test.current();
    const intro = before.document.blocks[0];
    const nested = before.document.blocks[1].children[0];
    const remove = before.document.blocks[2];
    const proposal = createAgentTextEditProposal({
      proposalId: "proposal-1",
      sessionId: "session-1",
      baseRevision: test.revision(),
      baseDocumentHash: hashPreshotDocument(before.document),
    }, {
      summary: "Revise text",
      operations: [
        {
          op: "update",
          blockId: intro.id,
          expectedBlockHash: hashPreshotBlock(intro),
          patch: { text: "After" },
        },
        {
          op: "insertAfter",
          referenceBlockId: nested.id,
          expectedReferenceHash: hashPreshotBlock(nested),
          blocks: [{
            type: "bulletListItem",
            text: "Nested addition",
            children: [{ type: "paragraph", text: "Nested detail" }],
          }],
        },
        {
          op: "delete",
          blockId: remove.id,
          expectedBlockHash: hashPreshotBlock(remove),
        },
      ],
    });
    await test.metadata.createProposal(proposal);

    const prepared = await test.service().prepare(
      "project-1",
      "session-1",
      proposal.proposalId,
    );
    expect(prepared).toMatchObject({
      status: "ready",
      prepared: {
        requiresDeleteConfirmation: true,
        diff: {
          counts: { add: 2, edit: 1, delete: 1 },
          destructive: true,
        },
      },
    });
    expect(test.current()).toEqual(before);
    expect(test.applyAtomically).not.toHaveBeenCalled();

    await expect(test.service().apply(
      "project-1",
      "session-1",
      proposal.proposalId,
    )).resolves.toMatchObject({
      status: "delete_confirmation_required",
      deleteCount: 1,
    });
    expect(test.applyAtomically).not.toHaveBeenCalled();

    const applyingService = test.service();
    await applyingService.prepare("project-1", "session-1", proposal.proposalId);
    await expect(applyingService.apply(
      "project-1",
      "session-1",
      proposal.proposalId,
      true,
    )).resolves.toMatchObject({ status: "applied", revision: 4 });
    expect(test.applyAtomically).toHaveBeenCalledTimes(1);
    expect(test.current().document.blocks[0].content).toEqual([
      { type: "text", text: "After", styles: {} },
    ]);

    test.userEdit({
      ...test.current(),
      document: {
        ...test.current().document,
        blocks: [...test.current().document.blocks, block("manual", "Manual")],
      },
    });
    await expect(test.service().undo(
      "project-1",
      "session-1",
    )).resolves.toMatchObject({ status: "undone" });
    expect(test.restoreCheckpointAtomically).toHaveBeenCalledTimes(1);
    expect(test.current().document.blocks.at(-1)?.id).toBe("manual");
    expect(test.current().document.blocks[0]).toMatchObject({ id: "intro" });
    expect((await test.metadata.listProposals("session-1"))[0].status)
      .toBe("undone");
  });

  it("marks stale races, discards, sends immutable revision context, and refuses affected undo conflicts", async () => {
    const test = await harness();
    const before = test.current();
    const intro = before.document.blocks[0];
    const first = createAgentTextEditProposal({
      proposalId: "stale-proposal",
      sessionId: "session-1",
      baseRevision: test.revision(),
      baseDocumentHash: hashPreshotDocument(before.document),
    }, {
      summary: "Stale",
      operations: [{
        op: "update",
        blockId: intro.id,
        expectedBlockHash: hashPreshotBlock(intro),
        patch: { text: "Assistant" },
      }],
    });
    await test.metadata.createProposal(first);
    test.userEdit({
      ...before,
      document: {
        ...before.document,
        blocks: before.document.blocks.map((entry) =>
          entry.id === intro.id ? block(intro.id, "User") : entry
        ),
      },
    });
    await expect(test.service().prepare(
      "project-1",
      "session-1",
      first.proposalId,
    )).resolves.toMatchObject({ status: "stale" });
    expect((await test.metadata.listProposals("session-1"))[0].status)
      .toBe("stale");

    const current = test.current();
    const keep = current.document.blocks.find((entry) => entry.id === "keep")!;
    const discard = createAgentTextEditProposal({
      proposalId: "discard-proposal",
      sessionId: "session-1",
      baseRevision: test.revision(),
      baseDocumentHash: hashPreshotDocument(current.document),
    }, {
      summary: "Discard",
      operations: [{
        op: "update",
        blockId: keep.id,
        expectedBlockHash: hashPreshotBlock(keep),
        patch: { text: "Discarded" },
      }],
    });
    await test.metadata.createProposal(discard);
    const revisionContext = await test.service().revisionContext(
      "project-1",
      "session-1",
      discard.proposalId,
      "Keep the original tone",
    );
    expect(Object.isFrozen(revisionContext)).toBe(true);
    expect(revisionContext.feedback).toBe("Keep the original tone");
    expect(test.current()).toEqual(current);
    await test.service().discard("session-1", discard.proposalId);
    expect((await test.metadata.listProposals("session-1"))[0].status)
      .toBe("discarded");
  });

  it("reconciles a persisted apply when atomic checkpoint metadata fails and permits retry", async () => {
    const test = await harness();
    const before = test.current();
    const intro = before.document.blocks[0];
    const proposal = createAgentTextEditProposal({
      proposalId: "metadata-retry",
      sessionId: "session-1",
      baseRevision: test.revision(),
      baseDocumentHash: hashPreshotDocument(before.document),
    }, {
      summary: "Retry metadata",
      operations: [{
        op: "update",
        blockId: intro.id,
        expectedBlockHash: hashPreshotBlock(intro),
        patch: { text: "After metadata retry" },
      }],
    });
    await test.metadata.createProposal(proposal);
    const finalizeProposalRecovery = vi.fn<
      AgentMetadataStorePort["finalizeProposalRecovery"]
    >()
      .mockRejectedValueOnce(new Error("checkpoint database unavailable"))
      .mockImplementation((...args) =>
        test.metadata.finalizeProposalRecovery(...args)
      );
    const service = test.service({
      metadata: { ...test.metadata, finalizeProposalRecovery },
    });
    await service.prepare("project-1", "session-1", proposal.proposalId);

    await expect(service.apply(
      "project-1",
      "session-1",
      proposal.proposalId,
    )).rejects.toThrow("checkpoint database unavailable");
    expect(test.current()).toEqual(before);
    expect(test.revision()).toBe(3);
    expect(test.rollbackAtomically).toHaveBeenCalledTimes(1);
    expect((await test.metadata.listProposals("session-1"))[0].status)
      .toBe("staged");
    expect(await test.metadata.readLatestCheckpoint("session-1")).toBeNull();

    await expect(service.apply(
      "project-1",
      "session-1",
      proposal.proposalId,
    )).resolves.toMatchObject({ status: "applied", revision: 4 });
    expect(finalizeProposalRecovery).toHaveBeenCalledTimes(2);
    expect(test.applyAtomically).toHaveBeenCalledTimes(2);
    expect((await test.metadata.listProposals("session-1"))[0].status)
      .toBe("applied");
    expect(await test.metadata.readLatestCheckpoint("session-1"))
      .toMatchObject({ proposalId: proposal.proposalId });
  });

  it("reconciles a persisted undo when metadata fails and keeps the checkpoint retryable", async () => {
    const test = await harness();
    const before = test.current();
    const intro = before.document.blocks[0];
    const proposal = createAgentTextEditProposal({
      proposalId: "undo-metadata-retry",
      sessionId: "session-1",
      baseRevision: test.revision(),
      baseDocumentHash: hashPreshotDocument(before.document),
    }, {
      summary: "Undo metadata",
      operations: [{
        op: "update",
        blockId: intro.id,
        expectedBlockHash: hashPreshotBlock(intro),
        patch: { text: "Applied before undo" },
      }],
    });
    await test.metadata.createProposal(proposal);
    const finalizeProposalRecovery = vi.fn<
      AgentMetadataStorePort["finalizeProposalRecovery"]
    >()
      .mockImplementation((...args) =>
        test.metadata.finalizeProposalRecovery(...args)
      );
    const service = test.service({
      metadata: { ...test.metadata, finalizeProposalRecovery },
    });
    await service.prepare("project-1", "session-1", proposal.proposalId);
    await service.apply("project-1", "session-1", proposal.proposalId);
    finalizeProposalRecovery.mockRejectedValueOnce(
      new Error("undo metadata unavailable"),
    );
    const applied = test.current();
    const appliedRevision = test.revision();

    await expect(service.undo("project-1", "session-1"))
      .rejects.toThrow("undo metadata unavailable");
    expect(test.current()).toEqual(applied);
    expect(test.revision()).toBe(appliedRevision);
    expect(test.rollbackAtomically).toHaveBeenCalledTimes(1);
    expect((await test.metadata.listProposals("session-1"))[0].status)
      .toBe("applied");
    expect(await test.metadata.readLatestCheckpoint("session-1"))
      .toMatchObject({ proposalId: proposal.proposalId });

    await expect(service.undo("project-1", "session-1"))
      .resolves.toMatchObject({ status: "undone" });
    expect(test.restoreCheckpointAtomically).toHaveBeenCalledTimes(2);
    expect(finalizeProposalRecovery).toHaveBeenCalledTimes(3);
    expect((await test.metadata.listProposals("session-1"))[0].status)
      .toBe("undone");
  });

  it("recovers staged apply journals at every durable boundary by document hash", async () => {
    const createFixture = async () => {
      const test = await harness();
      const before = test.current();
      const intro = before.document.blocks[0];
      const proposal = createAgentTextEditProposal({
        proposalId: "crash-apply",
        sessionId: "session-1",
        baseRevision: test.revision(),
        baseDocumentHash: hashPreshotDocument(before.document),
      }, {
        summary: "Crash apply",
        operations: [{
          op: "update",
          blockId: intro.id,
          expectedBlockHash: hashPreshotBlock(intro),
          patch: { text: "Recovered apply" },
        }],
      });
      await test.metadata.createProposal(proposal);
      const applied = applyAgentTextEditProposal(
        before,
        test.revision(),
        proposal,
        {
          projectId: "project-1",
          makeId: () => "inserted",
          makeCheckpointId: () => "checkpoint-crash",
          appliedAt: "2026-08-22T00:00:01.000Z",
        },
      );
      if (applied.status !== "applied") {
        throw new Error(`Unexpected projection: ${applied.status}`);
      }
      await test.metadata.beginProposalRecovery({
        operationId: "operation-crash",
        kind: "apply",
        proposalId: proposal.proposalId,
        sessionId: proposal.sessionId,
        projectId: "project-1",
        beforeDocumentHash: proposal.baseDocumentHash,
        beforeRevision: proposal.baseRevision,
        afterDocumentHash: applied.documentHash,
        afterRevision: applied.revision,
        checkpoint: applied.checkpoint,
        finalization: {
          status: "applied",
          finalizedAt: "2026-08-22T00:00:02.000Z",
          revision: applied.revision,
          documentHash: applied.documentHash,
        },
      });
      return { test, proposal, applied, before };
    };

    const beforeSave = await createFixture();
    beforeSave.test.userEdit(structuredClone(beforeSave.before));
    await expect(beforeSave.test.service().recoverProject("project-1"))
      .resolves.toEqual([{
        status: "cleared",
        operationId: "operation-crash",
        kind: "apply",
        proposalId: "crash-apply",
      }]);
    expect(
      (await beforeSave.test.metadata.listProposals("session-1"))[0].status,
    ).toBe("staged");
    expect(await beforeSave.test.metadata.listProposalRecovery("project-1"))
      .toEqual([]);

    const afterSave = await createFixture();
    afterSave.test.userEdit(afterSave.applied.plan);
    const getCurrentPlan = vi.spyOn(
      afterSave.test.application,
      "getCurrentPlan",
    );
    const recoveryService = afterSave.test.service();
    const [first, second] = await Promise.all([
      recoveryService.recoverProject("project-1"),
      recoveryService.recoverProject("project-1"),
    ]);
    expect(getCurrentPlan).toHaveBeenCalledTimes(1);
    expect([first, second].flat().some((result) =>
      result.status === "finalized"
    )).toBe(true);
    expect(
      (await afterSave.test.metadata.listProposals("session-1"))[0],
    ).toMatchObject({
      status: "applied",
      appliedAt: "2026-08-22T00:00:02.000Z",
      appliedRevision: 4,
      appliedDocumentHash: afterSave.applied.documentHash,
    });
    expect(await afterSave.test.metadata.readLatestCheckpoint("session-1"))
      .toEqual(afterSave.applied.checkpoint);
    await expect(afterSave.test.service().recoverProject("project-1"))
      .resolves.toEqual([]);

    const temporary = await createFixture();
    temporary.test.userEdit(temporary.applied.plan);
    vi.spyOn(temporary.test.application, "getCurrentPlan")
      .mockRejectedValueOnce(
        new AgentProposalTemporaryError(
          "PLAN_BRIDGE_NOT_READY",
          "bridge mounting",
        ),
      )
      .mockRejectedValueOnce(
        new AgentProposalTemporaryError("PLAN_LOADING", "plan loading"),
      );
    const temporaryService = temporary.test.service();
    await expect(temporaryService.recoverProject("project-1"))
      .resolves.toMatchObject([{
        status: "retryable",
        code: "PLAN_BRIDGE_NOT_READY",
        operation: { status: "pending" },
      }]);
    await expect(temporaryService.recoverProject("project-1"))
      .resolves.toMatchObject([{
        status: "retryable",
        code: "PLAN_LOADING",
        operation: {
          status: "pending",
          error: expect.stringContaining("PLAN_LOADING"),
        },
      }]);
    await expect(temporaryService.recoverProject("project-1"))
      .resolves.toMatchObject([{
        status: "finalized",
        proposalId: "crash-apply",
      }]);
    expect(await temporary.test.metadata.listProposalRecovery("project-1"))
      .toEqual([]);

    const duplicateInstance = await createFixture();
    duplicateInstance.test.userEdit(duplicateInstance.applied.plan);
    const duplicateResults = await Promise.all([
      duplicateInstance.test.service().recoverProject("project-1"),
      duplicateInstance.test.service().recoverProject("project-1"),
    ]);
    expect(duplicateResults.flat().some((result) =>
      result.status === "finalized"
    )).toBe(true);
    expect(
      (await duplicateInstance.test.metadata.listProposals("session-1"))[0]
        .status,
    ).toBe("applied");
    expect(
      await duplicateInstance.test.metadata.listProposalRecovery("project-1"),
    ).toEqual([]);

    const conflict = await createFixture();
    conflict.test.userEdit({
      ...conflict.before,
      document: {
        ...conflict.before.document,
        blocks: [...conflict.before.document.blocks, block("other", "Other")],
      },
    });
    const conflicted = await conflict.test.service().recoverProject(
      "project-1",
    );
    expect(conflicted[0]).toMatchObject({
      status: "conflict",
      operation: {
        status: "conflict",
        proposalId: "crash-apply",
      },
    });
    await expect(conflict.test.service().recoverProject("project-1"))
      .resolves.toEqual(conflicted);
    expect(
      (await conflict.test.metadata.listProposals("session-1"))[0].status,
    ).toBe("staged");

    const unavailable = await createFixture();
    vi.spyOn(unavailable.test.application, "getCurrentPlan")
      .mockRejectedValue(new Error("project missing or schema invalid"));
    await expect(
      unavailable.test.service().recoverProject("project-1"),
    ).resolves.toMatchObject([{
      status: "conflict",
      operation: {
        status: "conflict",
        error: expect.stringMatching(/missing or schema invalid/),
      },
    }]);
  });

  it("recovers undo journals without losing exact checkpoints or unrelated revisions", async () => {
    const test = await harness();
    const before = test.current();
    const intro = before.document.blocks[0];
    const proposal = createAgentTextEditProposal({
      proposalId: "crash-undo",
      sessionId: "session-1",
      baseRevision: test.revision(),
      baseDocumentHash: hashPreshotDocument(before.document),
    }, {
      summary: "Crash undo",
      operations: [{
        op: "update",
        blockId: intro.id,
        expectedBlockHash: hashPreshotBlock(intro),
        patch: { text: "Applied" },
      }],
    });
    await test.metadata.createProposal(proposal);
    const service = test.service();
    await service.apply("project-1", "session-1", proposal.proposalId);
    const checkpoint = await test.metadata.readLatestCheckpoint("session-1");
    if (!checkpoint) throw new Error("Expected applied checkpoint");
    const appliedPlan = test.current();
    const appliedRevision = test.revision();
    const undone = undoAgentProposalApply(
      checkpoint,
      appliedPlan,
      appliedRevision,
    );
    if (undone.status !== "undone") throw new Error("Expected undo projection");
    await test.metadata.beginProposalRecovery({
      operationId: "operation-undo",
      kind: "undo",
      proposalId: proposal.proposalId,
      sessionId: proposal.sessionId,
      projectId: "project-1",
      beforeDocumentHash: hashPreshotDocument(appliedPlan.document),
      beforeRevision: appliedRevision,
      afterDocumentHash: undone.documentHash,
      afterRevision: undone.revision,
      checkpoint,
      finalization: {
        status: "undone",
        finalizedAt: "2026-08-22T00:00:03.000Z",
      },
    });
    test.userEdit(undone.plan);

    await expect(service.recoverProject("project-1")).resolves.toMatchObject([
      { status: "finalized", kind: "undo", proposalId: "crash-undo" },
    ]);
    expect((await test.metadata.listProposals("session-1"))[0]).toMatchObject({
      status: "undone",
      undoneAt: "2026-08-22T00:00:03.000Z",
    });
    expect(await test.metadata.readLatestCheckpoint("session-1")).toBeNull();
  });

  it("does not touch the project when journal storage is unavailable", async () => {
    const test = await harness();
    const getCurrentPlan = vi.spyOn(test.application, "getCurrentPlan");
    const metadata: AgentMetadataStorePort = {
      ...test.metadata,
      listProposalRecovery: vi.fn().mockRejectedValue(
        new Error("agent.db unavailable"),
      ),
    };

    await expect(test.service({ metadata }).recoverProject("project-1"))
      .rejects.toThrow("agent.db unavailable");
    expect(getCurrentPlan).not.toHaveBeenCalled();
  });

  it("does not save a proposal when the pending journal cannot be written", async () => {
    const test = await harness();
    const before = test.current();
    const intro = before.document.blocks[0];
    const proposal = createAgentTextEditProposal({
      proposalId: "journal-write-failure",
      sessionId: "session-1",
      baseRevision: test.revision(),
      baseDocumentHash: hashPreshotDocument(before.document),
    }, {
      summary: "Journal failure",
      operations: [{
        op: "update",
        blockId: intro.id,
        expectedBlockHash: hashPreshotBlock(intro),
        patch: { text: "Must not persist" },
      }],
    });
    await test.metadata.createProposal(proposal);
    const metadata: AgentMetadataStorePort = {
      ...test.metadata,
      beginProposalRecovery: vi.fn().mockRejectedValue(
        new Error("agent.db is read-only"),
      ),
    };
    const service = test.service({ metadata });

    await expect(service.apply(
      "project-1",
      "session-1",
      proposal.proposalId,
    )).rejects.toThrow("agent.db is read-only");
    expect(test.applyAtomically).not.toHaveBeenCalled();
    expect(test.current()).toEqual(before);
  });
});
