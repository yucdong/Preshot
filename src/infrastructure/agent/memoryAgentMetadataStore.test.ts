import { describe, expect, it } from "vitest";
import {
  createAgentTextEditProposal,
  hashPreshotDocument,
} from "../../domain/agent";
import { createMemoryAgentMetadataStore } from "./memoryAgentMetadataStore";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const EMPTY_DOCUMENT = {
  format: "preshot-blocks" as const,
  version: 3 as const,
  blocks: [],
};
const EMPTY_HASH = hashPreshotDocument(EMPTY_DOCUMENT);

function proposal(sessionId: string, proposalId: string) {
  return createAgentTextEditProposal({
    proposalId,
    sessionId,
    baseRevision: 1,
    baseDocumentHash: HASH_A,
  }, {
    summary: "Update text",
    operations: [{
      op: "update",
      blockId: "block-1",
      expectedBlockHash: HASH_B,
      patch: { text: "Updated" },
    }],
  });
}

describe("memory agent metadata store", () => {
  it("adopts renamed projects and lists sessions newest first", async () => {
    const times = [
      "2026-08-22T00:00:00.000Z",
      "2026-08-22T00:00:01.000Z",
      "2026-08-22T00:00:02.000Z",
      "2026-08-22T00:00:03.000Z",
    ];
    const store = createMemoryAgentMetadataStore({
      now: () => times.shift() ?? "2026-08-22T00:00:04.000Z",
    });
    await store.adoptProject({
      projectId: "project-1",
      projectPath: "C:/Projects/Original",
      projectName: "Original",
    });
    await store.createSession({
      sessionId: "older",
      projectId: "project-1",
      title: "Older",
      state: "idle",
    });
    await store.createSession({
      sessionId: "newer",
      projectId: "project-1",
      title: "Newer",
      state: "idle",
      modelId: "gpt-test",
    });
    const adopted = await store.adoptProject({
      projectId: "project-1",
      projectPath: "C:\\Projects\\Renamed\\",
      projectName: "Original",
    });

    expect(adopted.projectPath).toBe("C:\\Projects\\Renamed");
    expect((await store.listSessions("project-1")).map((item) => item.sessionId))
      .toEqual(["newer", "older"]);
  });

  it("stores drafts, usage, proposal receipts, and optional operations", async () => {
    const store = createMemoryAgentMetadataStore();
    await store.adoptProject({
      projectId: "project-1",
      projectPath: "C:\\Project",
      projectName: "Project",
    });
    await store.createSession({
      sessionId: "session-1",
      projectId: "project-1",
      title: "Session",
      state: "idle",
    });

    expect(await store.readDraft("session-1")).toBeNull();
    await store.writeDraft("session-1", "Remember this");
    expect((await store.readDraft("session-1"))?.text).toBe("Remember this");

    const withoutOperations = await store.createProposal(
      proposal("session-1", "proposal-1"),
      false,
    );
    expect(withoutOperations.operationCount).toBe(1);
    expect(withoutOperations.operations).toBeUndefined();
    const applied = await store.applyProposal("proposal-1", 2, HASH_B);
    expect(applied.status).toBe("applied");
    expect((await store.undoProposal("proposal-1")).status).toBe("undone");

    const session = await store.updateUsage(
      "session-1",
      {
        inputTokens: 10,
        outputTokens: 5,
        reasoningTokens: 1,
        cacheReadTokens: 2,
        cacheWriteTokens: 0,
        requestCount: 1,
      },
      {
        usedTokens: 18,
        limitTokens: 100,
        percentage: 18,
        level: "normal",
      },
      { amount: 0.1, currency: "USD", source: "proxy" },
    );
    expect(session.usage?.inputTokens).toBe(10);
    expect(session.context?.percentage).toBe(18);
    expect(session.cost?.currency).toBe("USD");
  });

  it("cascades one project while retaining cleanup tombstones and other projects", async () => {
    const store = createMemoryAgentMetadataStore();
    for (const projectId of ["project-1", "project-2"]) {
      await store.adoptProject({
        projectId,
        projectPath: `C:\\${projectId}`,
        projectName: projectId,
      });
      await store.createSession({
        sessionId: `${projectId}-session`,
        projectId,
        title: projectId,
        state: "idle",
      });
    }
    await store.writeDraft("project-1-session", "draft");
    await store.createProposal(createAgentTextEditProposal({
      proposalId: "project-1-proposal",
      sessionId: "project-1-session",
      baseRevision: 1,
      baseDocumentHash: EMPTY_HASH,
    }, {
      summary: "Delete recovery",
      operations: [{
        op: "delete",
        blockId: "block-1",
        expectedBlockHash: HASH_B,
      }],
    }));
    await store.beginProposalRecovery({
      operationId: "project-1-operation",
      kind: "apply",
      proposalId: "project-1-proposal",
      sessionId: "project-1-session",
      projectId: "project-1",
      beforeDocumentHash: EMPTY_HASH,
      beforeRevision: 1,
      afterDocumentHash: HASH_B,
      afterRevision: 2,
      checkpoint: {
        checkpointId: "project-1-checkpoint",
        proposalId: "project-1-proposal",
        sessionId: "project-1-session",
        projectId: "project-1",
        beforeRevision: 1,
        beforeDocumentHash: EMPTY_HASH,
        appliedRevision: 2,
        appliedDocumentHash: HASH_B,
        beforePlan: {
          schemaVersion: 15,
          title: "Project",
          document: EMPTY_DOCUMENT,
          imageGroups: [],
          artifacts: [],
        },
        changes: [],
      },
      finalization: {
        status: "applied",
        finalizedAt: "2026-08-22T00:00:00.000Z",
        revision: 2,
        documentHash: HASH_B,
      },
    });
    const tombstone = await store.addCleanupTombstone({
      projectId: "project-1",
      resourceKind: "copilot_session",
      resourceId: "runtime-1",
      lastError: "locked",
    });

    await store.deleteProject("project-1");

    expect(await store.listSessions("project-1")).toEqual([]);
    expect(await store.listSessions("project-2")).toHaveLength(1);
    expect(await store.listCleanupTombstones()).toHaveLength(1);
    expect(await store.listProposalRecovery("project-1")).toMatchObject([{
      status: "conflict",
      error: expect.stringMatching(/deleted/i),
    }]);
    expect(
      (await store.retryCleanupTombstone(tombstone.tombstoneId)).attemptCount,
    ).toBe(1);
    await store.removeCleanupTombstone(tombstone.tombstoneId);
    expect(await store.listCleanupTombstones()).toEqual([]);
  });
});
