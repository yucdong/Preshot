import { describe, expect, it, vi } from "vitest";
import {
  createAgentTextEditProposal,
  hashPreshotDocument,
  type AgentApplyCheckpoint,
} from "../../domain/agent";
import { createTauriAgentMetadataStore } from "./tauriAgentMetadataStore";

const HASH = `sha256:${"a".repeat(64)}`;

const PROJECT = {
  projectId: "project-1",
  projectPath: "C:\\Project",
  projectName: "Project",
  state: "active",
  createdAt: "2026-08-22T00:00:00.000Z",
  updatedAt: "2026-08-22T00:00:00.000Z",
};

const SESSION = {
  sessionId: "session-1",
  projectId: "project-1",
  projectPath: "C:\\Project",
  title: "Session",
  state: "idle",
  createdAt: "2026-08-22T00:00:00.000Z",
  updatedAt: "2026-08-22T00:00:00.000Z",
};

describe("Tauri agent metadata store", () => {
  it("adopts projects and validates native identity", async () => {
    const invokeCommand = vi.fn().mockResolvedValue(PROJECT);
    const store = createTauriAgentMetadataStore({ invokeCommand });

    await expect(store.adoptProject(PROJECT)).resolves.toEqual(PROJECT);
    expect(invokeCommand).toHaveBeenCalledWith(
      "agent_store_adopt_project",
      { path: "C:\\Project" },
    );

    invokeCommand.mockResolvedValue({ ...PROJECT, projectId: "other" });
    await expect(store.adoptProject(PROJECT)).rejects.toMatchObject({
      code: "store_failed",
      phase: "store",
    });
  });

  it("maps session, draft, usage, and cleanup commands narrowly", async () => {
    const invokeCommand = vi.fn()
      .mockResolvedValueOnce(SESSION)
      .mockResolvedValueOnce({ ...SESSION, title: "Renamed" })
      .mockResolvedValueOnce({
        sessionId: "session-1",
        text: "draft",
        updatedAt: "2026-08-22T00:00:01.000Z",
      })
      .mockResolvedValueOnce({
        ...SESSION,
        usage: {
          inputTokens: 1,
          outputTokens: 2,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          requestCount: 1,
        },
      })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);
    const store = createTauriAgentMetadataStore({ invokeCommand });

    await store.createSession({
      sessionId: "session-1",
      projectId: "project-1",
      title: "Session",
      state: "idle",
    });
    await store.renameSession("session-1", "Renamed");
    await store.writeDraft("session-1", "draft");
    await store.updateUsage("session-1", {
      inputTokens: 1,
      outputTokens: 2,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      requestCount: 1,
    });
    await store.listCleanupTombstones();
    await store.deleteProject("project-1");

    expect(invokeCommand.mock.calls.map(([command]) => command)).toEqual([
      "agent_store_create_session",
      "agent_store_rename_session",
      "agent_store_write_draft",
      "agent_store_update_usage",
      "agent_store_list_cleanup_tombstones",
      "agent_store_delete_project",
    ]);
  });

  it("can omit validated operation JSON while retaining its count", async () => {
    const proposal = createAgentTextEditProposal({
      proposalId: "proposal-1",
      sessionId: "session-1",
      baseRevision: 1,
      baseDocumentHash: HASH,
    }, {
      summary: "Update",
      operations: [{
        op: "delete",
        blockId: "block-1",
        expectedBlockHash: HASH,
      }],
    });
    const response = {
      proposalId: "proposal-1",
      sessionId: "session-1",
      status: "staged",
      summary: "Update",
      baseRevision: 1,
      baseDocumentHash: HASH,
      operationCount: 1,
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
    };
    const invokeCommand = vi.fn().mockResolvedValue(response);
    const store = createTauriAgentMetadataStore({ invokeCommand });

    await expect(store.createProposal(proposal, false)).resolves.toEqual(response);
    expect(invokeCommand).toHaveBeenCalledWith(
      "agent_store_create_proposal",
      {
        input: {
          proposalId: "proposal-1",
          sessionId: "session-1",
          summary: "Update",
          baseRevision: 1,
          baseDocumentHash: HASH,
          operationCount: 1,
        },
      },
    );
  });

  it("commits checkpoint and applied receipt through one native command", async () => {
    const response = {
      proposalId: "proposal-1",
      sessionId: "session-1",
      status: "applied",
      summary: "Update",
      baseRevision: 1,
      baseDocumentHash: HASH,
      operationCount: 1,
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:01.000Z",
      appliedAt: "2026-08-22T00:00:01.000Z",
      appliedRevision: 2,
      appliedDocumentHash: HASH,
    };
    const invokeCommand = vi.fn().mockResolvedValue(response);
    const store = createTauriAgentMetadataStore({ invokeCommand });
    const beforeDocument = {
      format: "preshot-blocks" as const,
      version: 3 as const,
      blocks: [],
    };
    const beforeDocumentHash = hashPreshotDocument(beforeDocument);
    const checkpoint: AgentApplyCheckpoint = {
      checkpointId: "checkpoint-1",
      proposalId: "proposal-1",
      sessionId: "session-1",
      projectId: "project-1",
      beforeRevision: 1,
      beforeDocumentHash,
      appliedRevision: 2,
      appliedDocumentHash: HASH,
      beforePlan: {
        schemaVersion: 15,
        title: "Project",
        document: beforeDocument,
        imageGroups: [],
        artifacts: [],
      },
      changes: [],
    };

    await expect(store.commitProposalApply(checkpoint, 2, HASH))
      .resolves.toEqual(response);
    expect(invokeCommand).toHaveBeenCalledWith(
      "agent_store_commit_proposal_apply",
      {
        input: {
          checkpoint: {
            checkpointId: "checkpoint-1",
            proposalId: "proposal-1",
            sessionId: "session-1",
            projectId: "project-1",
            checkpoint,
          },
          appliedRevision: 2,
          appliedDocumentHash: HASH,
        },
      },
    );
  });

  it("maps and validates durable proposal recovery commands", async () => {
    const beforeDocument = {
      format: "preshot-blocks" as const,
      version: 3 as const,
      blocks: [],
    };
    const beforeDocumentHash = hashPreshotDocument(beforeDocument);
    const checkpoint: AgentApplyCheckpoint = {
      checkpointId: "checkpoint-recovery",
      proposalId: "proposal-1",
      sessionId: "session-1",
      projectId: "project-1",
      beforeRevision: 1,
      beforeDocumentHash,
      appliedRevision: 2,
      appliedDocumentHash: HASH,
      beforePlan: {
        schemaVersion: 15,
        title: "Project",
        document: beforeDocument,
        imageGroups: [],
        artifacts: [],
      },
      changes: [],
    };
    const input = {
      operationId: "operation-1",
      kind: "apply" as const,
      proposalId: "proposal-1",
      sessionId: "session-1",
      projectId: "project-1",
      beforeDocumentHash,
      beforeRevision: 1,
      afterDocumentHash: HASH,
      afterRevision: 2,
      checkpoint,
      finalization: {
        status: "applied" as const,
        finalizedAt: "2026-08-22T00:00:01.000Z",
        revision: 2,
        documentHash: HASH,
      },
    };
    const operation = {
      ...input,
      status: "pending",
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
    };
    const invokeCommand = vi.fn()
      .mockResolvedValueOnce(operation)
      .mockResolvedValueOnce([operation])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        ...operation,
        status: "conflict",
        error: "hash mismatch",
      })
      .mockResolvedValueOnce({
        ...operation,
        error: "retry after reload",
      });
    const store = createTauriAgentMetadataStore({ invokeCommand });

    await expect(store.beginProposalRecovery(input)).resolves.toEqual(operation);
    await expect(store.listProposalRecovery("project-1"))
      .resolves.toEqual([operation]);
    await store.finalizeProposalRecovery("operation-1");
    await store.abortProposalRecovery("operation-1");
    await expect(store.markProposalRecoveryConflict(
      "operation-1",
      "hash mismatch",
    )).resolves.toMatchObject({ status: "conflict" });
    await expect(store.recordProposalRecoveryError(
      "operation-1",
      "retry after reload",
    )).resolves.toMatchObject({ status: "pending" });
    expect(invokeCommand.mock.calls.map(([command]) => command)).toEqual([
      "agent_store_begin_proposal_recovery",
      "agent_store_list_proposal_recovery",
      "agent_store_finalize_proposal_recovery",
      "agent_store_abort_proposal_recovery",
      "agent_store_mark_proposal_recovery_conflict",
      "agent_store_record_proposal_recovery_error",
    ]);
  });

  it("rejects malformed responses and preserves native error context", async () => {
    const malformed = createTauriAgentMetadataStore({
      invokeCommand: vi.fn().mockResolvedValue([{ state: "idle" }]),
    });
    await expect(malformed.listSessions("project-1")).rejects.toMatchObject({
      code: "store_failed",
    });

    const failed = createTauriAgentMetadataStore({
      invokeCommand: vi.fn().mockRejectedValue({
        code: "agent_store_busy",
        message: "Database is busy",
      }),
    });
    await expect(failed.deleteSession("session-1")).rejects.toThrow(
      "Database is busy",
    );
  });
});
