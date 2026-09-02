import { invoke } from "@tauri-apps/api/core";
import {
  AGENT_ERROR_CODES,
  type AgentCleanupTombstone,
  AgentDomainError,
  type AgentMetadataStorePort,
  type AgentProjectAdoption,
  type AgentProjectMetadata,
  type AgentSessionMetadata,
  type AgentSessionState,
  type AgentStoredProposal,
  agentContextUsage,
  normalizeAgentTokenUsage,
  normalizeReliableMonetaryCost,
  validateAgentTextEditProposal,
  validateAgentApplyCheckpoint,
  validateAgentProposalRecoveryOperation,
} from "../../domain/agent";

type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

interface Dependencies {
  readonly invokeCommand?: InvokeCommand;
}

function malformedResponse(): never {
  throw new AgentDomainError(
    "store_failed",
    "store",
    "Malformed agent metadata response",
  );
}

const SESSION_STATES = new Set<AgentSessionState>([
  "creating",
  "idle",
  "running",
  "waiting_permission",
  "waiting_user_input",
  "stopping",
  "disconnected",
  "error",
  "deleting",
]);

const PROPOSAL_STATUSES = new Set([
  "staged",
  "stale",
  "applied",
  "discarded",
  "undone",
]);

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return malformedResponse();
  }
  return value as Record<string, unknown>;
}

function string(
  value: Record<string, unknown>,
  key: string,
  optional = false,
): string | undefined {
  const candidate = value[key];
  if (candidate === undefined && optional) return undefined;
  if (typeof candidate !== "string" || candidate.length === 0) {
    return malformedResponse();
  }
  return candidate;
}

function integer(
  value: Record<string, unknown>,
  key: string,
  optional = false,
): number | undefined {
  const candidate = value[key];
  if (candidate === undefined && optional) return undefined;
  if (
    typeof candidate !== "number" ||
    !Number.isSafeInteger(candidate) ||
    candidate < 0
  ) {
    return malformedResponse();
  }
  return candidate;
}

function validateProject(value: unknown): AgentProjectMetadata {
  const candidate = record(value);
  const state = string(candidate, "state");
  if (
    state !== "active" &&
    state !== "deleting" &&
    state !== "cleanup_pending"
  ) {
    return malformedResponse();
  }
  return {
    projectId: string(candidate, "projectId")!,
    projectPath: string(candidate, "projectPath")!,
    projectName: string(candidate, "projectName")!,
    state,
    createdAt: string(candidate, "createdAt")!,
    updatedAt: string(candidate, "updatedAt")!,
  };
}

function validateStoredError(value: unknown): AgentSessionMetadata["lastError"] {
  if (value === undefined) return undefined;
  const candidate = record(value);
  const code = string(candidate, "code");
  const phase = string(candidate, "phase");
  if (
    !AGENT_ERROR_CODES.includes(code as (typeof AGENT_ERROR_CODES)[number]) ||
    typeof candidate.retryable !== "boolean"
  ) {
    return malformedResponse();
  }
  return {
    code: code as (typeof AGENT_ERROR_CODES)[number],
    phase: phase as NonNullable<AgentSessionMetadata["lastError"]>["phase"],
    message: string(candidate, "message")!,
    retryable: candidate.retryable,
    ...(string(candidate, "recovery", true)
      ? { recovery: string(candidate, "recovery", true)! }
      : {}),
  };
}

function validateSession(value: unknown): AgentSessionMetadata {
  const candidate = record(value);
  const state = string(candidate, "state");
  if (!SESSION_STATES.has(state as AgentSessionState)) {
    return malformedResponse();
  }
  const modelId = string(candidate, "modelId", true);
  const interruptedAt = string(candidate, "interruptedAt", true);
  const lastError = validateStoredError(candidate.lastError);
  const usage = candidate.usage === undefined
    ? undefined
    : normalizeAgentTokenUsage(candidate.usage);
  let context: AgentSessionMetadata["context"];
  if (candidate.context !== undefined) {
    const contextValue = record(candidate.context);
    const usedTokens = integer(contextValue, "usedTokens")!;
    const rawLimit = contextValue.limitTokens;
    if (
      rawLimit !== undefined &&
      (
        typeof rawLimit !== "number" ||
        !Number.isSafeInteger(rawLimit) ||
        rawLimit <= 0
      )
    ) {
      return malformedResponse();
    }
    context = agentContextUsage(
      usedTokens,
      rawLimit === undefined ? null : rawLimit,
    );
  }
  const cost = candidate.cost === undefined
    ? undefined
    : normalizeReliableMonetaryCost(candidate.cost);
  if (candidate.cost !== undefined && cost === null) {
    return malformedResponse();
  }
  return {
    sessionId: string(candidate, "sessionId")!,
    projectId: string(candidate, "projectId")!,
    projectPath: string(candidate, "projectPath")!,
    title: string(candidate, "title")!,
    state: state as AgentSessionState,
    createdAt: string(candidate, "createdAt")!,
    updatedAt: string(candidate, "updatedAt")!,
    ...(modelId ? { modelId } : {}),
    ...(lastError ? { lastError } : {}),
    ...(interruptedAt ? { interruptedAt } : {}),
    ...(usage ? { usage } : {}),
    ...(context ? { context } : {}),
    ...(cost ? { cost } : {}),
  };
}

function validateDraft(value: unknown) {
  const candidate = record(value);
  return {
    sessionId: string(candidate, "sessionId")!,
    text: typeof candidate.text === "string"
      ? candidate.text
      : malformedResponse(),
    updatedAt: string(candidate, "updatedAt")!,
  };
}

function validateProposal(value: unknown): AgentStoredProposal {
  const candidate = record(value);
  const status = string(candidate, "status");
  if (!PROPOSAL_STATUSES.has(status!)) {
    return malformedResponse();
  }
  const proposalId = string(candidate, "proposalId")!;
  const sessionId = string(candidate, "sessionId")!;
  const baseRevision = integer(candidate, "baseRevision")!;
  const baseDocumentHash = string(candidate, "baseDocumentHash")!;
  const operationCount = integer(candidate, "operationCount")!;
  let operations: AgentStoredProposal["operations"];
  if (candidate.operations !== undefined) {
    operations = validateAgentTextEditProposal({
      version: 1,
      proposalId,
      sessionId,
      baseRevision,
      baseDocumentHash,
      summary: string(candidate, "summary")!,
      operations: candidate.operations,
    }).operations;
    if (operations.length !== operationCount) {
      return malformedResponse();
    }
  }
  return {
    proposalId,
    sessionId,
    status: status as AgentStoredProposal["status"],
    summary: string(candidate, "summary")!,
    baseRevision,
    baseDocumentHash,
    operationCount,
    createdAt: string(candidate, "createdAt")!,
    updatedAt: string(candidate, "updatedAt")!,
    ...(operations ? { operations } : {}),
    ...(string(candidate, "appliedAt", true)
      ? { appliedAt: string(candidate, "appliedAt", true)! }
      : {}),
    ...(integer(candidate, "appliedRevision", true) === undefined
      ? {}
      : { appliedRevision: integer(candidate, "appliedRevision", true)! }),
    ...(string(candidate, "appliedDocumentHash", true)
      ? {
        appliedDocumentHash: string(
          candidate,
          "appliedDocumentHash",
          true,
        )!,
      }
      : {}),
    ...(string(candidate, "discardedAt", true)
      ? { discardedAt: string(candidate, "discardedAt", true)! }
      : {}),
    ...(string(candidate, "undoneAt", true)
      ? { undoneAt: string(candidate, "undoneAt", true)! }
      : {}),
  };
}

function validateTombstone(value: unknown): AgentCleanupTombstone {
  const candidate = record(value);
  if (candidate.resourceKind !== "copilot_session") {
    return malformedResponse();
  }
  return {
    tombstoneId: string(candidate, "tombstoneId")!,
    projectId: string(candidate, "projectId")!,
    resourceKind: "copilot_session",
    resourceId: string(candidate, "resourceId")!,
    attemptCount: integer(candidate, "attemptCount")!,
    createdAt: string(candidate, "createdAt")!,
    updatedAt: string(candidate, "updatedAt")!,
    ...(string(candidate, "lastError", true)
      ? { lastError: string(candidate, "lastError", true)! }
      : {}),
    ...(string(candidate, "retryAfter", true)
      ? { retryAfter: string(candidate, "retryAfter", true)! }
      : {}),
  };
}

function errorDetail(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function wrapStoreFailure(error: unknown): AgentDomainError {
  return error instanceof AgentDomainError
    ? error
    : new AgentDomainError(
      "store_failed",
      "store",
      `Agent metadata store failed: ${errorDetail(error)}`,
      { cause: error },
    );
}

export function createTauriAgentMetadataStore({
  invokeCommand = invoke,
}: Dependencies = {}): AgentMetadataStorePort {
  async function call(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      return await invokeCommand(command, args);
    } catch (error) {
      throw wrapStoreFailure(error);
    }
  }

  return {
    async adoptProject(project: AgentProjectAdoption) {
      const adopted = validateProject(
        await call("agent_store_adopt_project", { path: project.projectPath }),
      );
      if (
        adopted.projectId !== project.projectId ||
        adopted.projectName !== project.projectName
      ) {
        throw wrapStoreFailure(new Error("Adopted project identity changed"));
      }
      return adopted;
    },
    async listSessions(projectId) {
      const response = await call("agent_store_list_sessions", { projectId });
      if (!Array.isArray(response)) {
        return malformedResponse();
      }
      return response.map(validateSession);
    },
    async createSession(input) {
      return validateSession(
        await call("agent_store_create_session", { input }),
      );
    },
    async updateSession(input) {
      return validateSession(
        await call("agent_store_update_session", { input }),
      );
    },
    async renameSession(sessionId, title) {
      return validateSession(
        await call("agent_store_rename_session", { sessionId, title }),
      );
    },
    async deleteSession(sessionId) {
      await call("agent_store_delete_session", { sessionId });
    },
    async readDraft(sessionId) {
      const response = await call("agent_store_read_draft", { sessionId });
      return response === null ? null : validateDraft(response);
    },
    async writeDraft(sessionId, text) {
      return validateDraft(
        await call("agent_store_write_draft", { sessionId, text }),
      );
    },
    async createProposal(proposal, retainOperations = true) {
      return validateProposal(
        await call("agent_store_create_proposal", {
          input: {
            proposalId: proposal.proposalId,
            sessionId: proposal.sessionId,
            summary: proposal.summary,
            baseRevision: proposal.baseRevision,
            baseDocumentHash: proposal.baseDocumentHash,
            operationCount: proposal.operations.length,
            ...(retainOperations ? { operations: proposal.operations } : {}),
          },
        }),
      );
    },
    async listProposals(sessionId, limit = 50) {
      const response = await call("agent_store_list_proposals", {
        sessionId,
        limit,
      });
      if (!Array.isArray(response)) return malformedResponse();
      return response.map(validateProposal);
    },
    async markProposalStale(proposalId) {
      return validateProposal(
        await call("agent_store_mark_proposal_stale", { proposalId }),
      );
    },
    async discardProposal(proposalId) {
      return validateProposal(
        await call("agent_store_set_proposal_status", {
          proposalId,
          status: "discarded",
        }),
      );
    },
    async applyProposal(proposalId, appliedRevision, appliedDocumentHash) {
      return validateProposal(
        await call("agent_store_apply_proposal", {
          input: { proposalId, appliedRevision, appliedDocumentHash },
        }),
      );
    },
    async commitProposalApply(
      checkpoint,
      appliedRevision,
      appliedDocumentHash,
    ) {
      const validated = validateAgentApplyCheckpoint(checkpoint);
      return validateProposal(
        await call("agent_store_commit_proposal_apply", {
          input: {
            checkpoint: {
              checkpointId: validated.checkpointId,
              proposalId: validated.proposalId,
              sessionId: validated.sessionId,
              projectId: validated.projectId,
              checkpoint: validated,
            },
            appliedRevision,
            appliedDocumentHash,
          },
        }),
      );
    },
    async undoProposal(proposalId) {
      return validateProposal(
        await call("agent_store_undo_proposal", { proposalId }),
      );
    },
    async saveCheckpoint(checkpoint) {
      const validated = validateAgentApplyCheckpoint(checkpoint);
      await call("agent_store_save_checkpoint", {
        input: {
          checkpointId: validated.checkpointId,
          proposalId: validated.proposalId,
          sessionId: validated.sessionId,
          projectId: validated.projectId,
          checkpoint: validated,
        },
      });
    },
    async readLatestCheckpoint(sessionId) {
      const response = await call("agent_store_read_latest_checkpoint", {
        sessionId,
      });
      return response === null
        ? null
        : validateAgentApplyCheckpoint(response);
    },
    async beginProposalRecovery(operation) {
      return validateAgentProposalRecoveryOperation(
        await call("agent_store_begin_proposal_recovery", {
          input: {
            ...operation,
            checkpoint: validateAgentApplyCheckpoint(operation.checkpoint),
          },
        }),
      );
    },
    async listProposalRecovery(projectId) {
      const response = await call("agent_store_list_proposal_recovery", {
        projectId,
      });
      if (!Array.isArray(response)) return malformedResponse();
      return response.map(validateAgentProposalRecoveryOperation);
    },
    async finalizeProposalRecovery(operationId) {
      await call("agent_store_finalize_proposal_recovery", { operationId });
    },
    async abortProposalRecovery(operationId) {
      await call("agent_store_abort_proposal_recovery", { operationId });
    },
    async markProposalRecoveryConflict(operationId, error) {
      return validateAgentProposalRecoveryOperation(
        await call("agent_store_mark_proposal_recovery_conflict", {
          operationId,
          error,
        }),
      );
    },
    async recordProposalRecoveryError(operationId, error) {
      return validateAgentProposalRecoveryOperation(
        await call("agent_store_record_proposal_recovery_error", {
          operationId,
          error,
        }),
      );
    },
    async updateUsage(sessionId, usage, context, cost) {
      return validateSession(
        await call("agent_store_update_usage", {
          input: {
            sessionId,
            usage,
            ...(context
              ? {
                context: {
                  usedTokens: context.usedTokens,
                  ...(context.limitTokens === null
                    ? {}
                    : { limitTokens: context.limitTokens }),
                },
              }
              : {}),
            ...(cost ? { cost } : {}),
          },
        }),
      );
    },
    async deleteProject(projectId) {
      await call("agent_store_delete_project", { projectId });
    },
    async addCleanupTombstone(input) {
      return validateTombstone(
        await call("agent_store_add_cleanup_tombstone", { input }),
      );
    },
    async listCleanupTombstones(limit = 100) {
      const response = await call("agent_store_list_cleanup_tombstones", {
        limit,
      });
      if (!Array.isArray(response)) {
        return malformedResponse();
      }
      return response.map(validateTombstone);
    },
    async retryCleanupTombstone(tombstoneId, lastError) {
      return validateTombstone(
        await call("agent_store_retry_cleanup_tombstone", {
          tombstoneId,
          ...(lastError === undefined ? {} : { lastError }),
        }),
      );
    },
    async removeCleanupTombstone(tombstoneId) {
      await call("agent_store_remove_cleanup_tombstone", { tombstoneId });
    },
  };
}

export const tauriAgentMetadataStore = createTauriAgentMetadataStore();
