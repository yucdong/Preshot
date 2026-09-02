import {
  AgentDomainError,
  type AgentCleanupTombstone,
  type AgentMetadataStorePort,
  type AgentProjectMetadata,
  type AgentSessionMetadata,
  type AgentStoredProposal,
  type AgentApplyCheckpoint,
  type AgentTextEditProposal,
  type AgentProposalRecoveryOperation,
  validateAgentProposalRecoveryOperation,
} from "../../domain/agent";

interface Dependencies {
  readonly now?: () => string;
}

function storeError(message: string): AgentDomainError {
  return new AgentDomainError("store_failed", "store", message);
}

function canonicalPath(path: string): string {
  const normalized = path.trim().replaceAll("/", "\\").replace(/\\+$/, "");
  if (!normalized) throw storeError("Project path is required");
  return normalized;
}

function pathKey(path: string): string {
  return canonicalPath(path).toLocaleLowerCase("en-US");
}

function cloneSession(session: AgentSessionMetadata): AgentSessionMetadata {
  return {
    ...session,
    ...(session.lastError ? { lastError: { ...session.lastError } } : {}),
    ...(session.usage ? { usage: { ...session.usage } } : {}),
    ...(session.context ? { context: { ...session.context } } : {}),
    ...(session.cost ? { cost: { ...session.cost } } : {}),
  };
}

function cloneProposal(proposal: AgentStoredProposal): AgentStoredProposal {
  return {
    ...proposal,
    ...(proposal.operations
      ? {
        operations: structuredClone(proposal.operations),
      }
      : {}),
  };
}

function cloneRecovery(
  operation: AgentProposalRecoveryOperation,
): AgentProposalRecoveryOperation {
  return structuredClone(operation);
}

export function createMemoryAgentMetadataStore({
  now = () => new Date().toISOString(),
}: Dependencies = {}): AgentMetadataStorePort {
  const projects = new Map<string, AgentProjectMetadata>();
  const projectPaths = new Map<string, string>();
  const sessions = new Map<string, AgentSessionMetadata>();
  const drafts = new Map<string, {
    readonly sessionId: string;
    readonly text: string;
    readonly updatedAt: string;
  }>();
  const proposals = new Map<string, AgentStoredProposal>();
  const checkpoints = new Map<string, AgentApplyCheckpoint>();
  const recovery = new Map<string, AgentProposalRecoveryOperation>();
  const tombstones = new Map<string, AgentCleanupTombstone>();
  let tombstoneSequence = 0;

  function session(sessionId: string): AgentSessionMetadata {
    const value = sessions.get(sessionId);
    if (!value) throw storeError(`Agent session "${sessionId}" was not found`);
    return value;
  }

  function proposal(proposalId: string): AgentStoredProposal {
    const value = proposals.get(proposalId);
    if (!value) throw storeError(`Agent proposal "${proposalId}" was not found`);
    return value;
  }

  function saveProposal(
    value: AgentStoredProposal,
  ): AgentStoredProposal {
    proposals.set(value.proposalId, value);
    return cloneProposal(value);
  }

  return {
    async adoptProject(input) {
      const normalizedPath = canonicalPath(input.projectPath);
      const normalizedKey = pathKey(normalizedPath);
      const existingPathOwner = projectPaths.get(normalizedKey);
      if (existingPathOwner && existingPathOwner !== input.projectId) {
        throw storeError("Project path is already adopted by another project");
      }
      const existing = projects.get(input.projectId);
      if (existing) projectPaths.delete(pathKey(existing.projectPath));
      const timestamp = now();
      const project: AgentProjectMetadata = {
        projectId: input.projectId,
        projectPath: normalizedPath,
        projectName: input.projectName,
        state: "active",
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      projects.set(project.projectId, project);
      projectPaths.set(normalizedKey, project.projectId);
      return { ...project };
    },
    async listSessions(projectId) {
      return [...sessions.values()]
        .filter((candidate) => candidate.projectId === projectId)
        .sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          right.createdAt.localeCompare(left.createdAt) ||
          left.sessionId.localeCompare(right.sessionId)
        )
        .map(cloneSession);
    },
    async createSession(input) {
      if (sessions.has(input.sessionId)) {
        throw storeError(`Agent session "${input.sessionId}" already exists`);
      }
      const project = projects.get(input.projectId);
      if (!project) throw storeError("Agent project was not adopted");
      const timestamp = now();
      const value: AgentSessionMetadata = {
        ...input,
        projectPath: project.projectPath,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      sessions.set(value.sessionId, value);
      return cloneSession(value);
    },
    async updateSession(input) {
      const existing = session(input.sessionId);
      const value: AgentSessionMetadata = {
        sessionId: existing.sessionId,
        projectId: existing.projectId,
        projectPath: existing.projectPath,
        title: existing.title,
        state: input.state,
        createdAt: existing.createdAt,
        updatedAt: now(),
        ...(input.modelId ? { modelId: input.modelId } : {}),
        ...(input.lastError ? { lastError: { ...input.lastError } } : {}),
        ...(input.interruptedAt
          ? { interruptedAt: input.interruptedAt }
          : {}),
        ...(existing.usage ? { usage: { ...existing.usage } } : {}),
        ...(existing.context ? { context: { ...existing.context } } : {}),
        ...(existing.cost ? { cost: { ...existing.cost } } : {}),
      };
      sessions.set(value.sessionId, value);
      return cloneSession(value);
    },
    async renameSession(sessionId, title) {
      const existing = session(sessionId);
      const value = { ...existing, title, updatedAt: now() };
      sessions.set(sessionId, value);
      return cloneSession(value);
    },
    async deleteSession(sessionId) {
      session(sessionId);
      sessions.delete(sessionId);
      drafts.delete(sessionId);
      for (const [proposalId, candidate] of proposals) {
        if (candidate.sessionId !== sessionId) continue;
        proposals.delete(proposalId);
        for (const [checkpointId, checkpoint] of checkpoints) {
          if (checkpoint.proposalId === proposalId) {
            checkpoints.delete(checkpointId);
          }
        }
      }
    },
    async readDraft(sessionId) {
      session(sessionId);
      const draft = drafts.get(sessionId);
      return draft ? { ...draft } : null;
    },
    async writeDraft(sessionId, text) {
      session(sessionId);
      if (text.length > 20_000) {
        throw storeError("Agent draft exceeds 20000 characters");
      }
      const draft = { sessionId, text, updatedAt: now() };
      drafts.set(sessionId, draft);
      return { ...draft };
    },
    async createProposal(
      input: AgentTextEditProposal,
      retainOperations = true,
    ) {
      session(input.sessionId);
      if (proposals.has(input.proposalId)) {
        throw storeError(`Agent proposal "${input.proposalId}" already exists`);
      }
      const timestamp = now();
      return saveProposal({
        proposalId: input.proposalId,
        sessionId: input.sessionId,
        status: "staged",
        summary: input.summary,
        baseRevision: input.baseRevision,
        baseDocumentHash: input.baseDocumentHash,
        operationCount: input.operations.length,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...(retainOperations
          ? { operations: structuredClone(input.operations) }
          : {}),
      });
    },
    async listProposals(sessionId, limit = 50) {
      session(sessionId);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw storeError("Proposal limit must be between 1 and 100");
      }
      return [...proposals.values()]
        .filter((candidate) => candidate.sessionId === sessionId)
        .sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          right.proposalId.localeCompare(left.proposalId)
        )
        .slice(0, limit)
        .map(cloneProposal);
    },
    async markProposalStale(proposalId) {
      const existing = proposal(proposalId);
      if (existing.status !== "staged") {
        throw storeError("Only a staged proposal can be marked stale");
      }
      return saveProposal({
        ...existing,
        status: "stale",
        updatedAt: now(),
      });
    },
    async discardProposal(proposalId) {
      const existing = proposal(proposalId);
      if (existing.status !== "staged") {
        throw storeError("Only a staged proposal can be discarded");
      }
      const timestamp = now();
      return saveProposal({
        ...existing,
        status: "discarded",
        discardedAt: timestamp,
        updatedAt: timestamp,
      });
    },
    async applyProposal(
      proposalId,
      appliedRevision,
      appliedDocumentHash,
    ) {
      const existing = proposal(proposalId);
      if (existing.status !== "staged") {
        throw storeError("Only a staged proposal can be applied");
      }
      const timestamp = now();
      return saveProposal({
        ...existing,
        status: "applied",
        appliedAt: timestamp,
        appliedRevision,
        appliedDocumentHash,
        updatedAt: timestamp,
      });
    },
    async commitProposalApply(
      checkpoint,
      appliedRevision,
      appliedDocumentHash,
    ) {
      const existing = proposal(checkpoint.proposalId);
      if (
        existing.status !== "staged" ||
        checkpoint.sessionId !== existing.sessionId ||
        checkpoint.appliedRevision !== appliedRevision ||
        checkpoint.appliedDocumentHash !== appliedDocumentHash
      ) {
        throw storeError("Proposal checkpoint does not match the staged apply");
      }
      const timestamp = now();
      const applied = {
        ...existing,
        status: "applied" as const,
        appliedAt: timestamp,
        appliedRevision,
        appliedDocumentHash,
        updatedAt: timestamp,
      };
      checkpoints.set(
        checkpoint.checkpointId,
        structuredClone(checkpoint),
      );
      proposals.set(existing.proposalId, applied);
      return cloneProposal(applied);
    },
    async undoProposal(proposalId) {
      const existing = proposal(proposalId);
      if (existing.status !== "applied") {
        throw storeError("Only an applied proposal can be undone");
      }
      const timestamp = now();
      return saveProposal({
        ...existing,
        status: "undone",
        undoneAt: timestamp,
        updatedAt: timestamp,
      });
    },
    async saveCheckpoint(checkpoint) {
      proposal(checkpoint.proposalId);
      if (checkpoint.sessionId !== proposal(checkpoint.proposalId).sessionId) {
        throw storeError("Checkpoint session does not match its proposal");
      }
      checkpoints.set(
        checkpoint.checkpointId,
        structuredClone(checkpoint),
      );
    },
    async readLatestCheckpoint(sessionId) {
      session(sessionId);
      const appliedProposalIds = new Set(
        [...proposals.values()]
          .filter((candidate) =>
            candidate.sessionId === sessionId &&
            candidate.status === "applied"
          )
          .map((candidate) => candidate.proposalId),
      );
      const checkpoint = [...checkpoints.values()]
        .reverse()
        .find((candidate) =>
          candidate.sessionId === sessionId &&
          appliedProposalIds.has(candidate.proposalId)
        );
      return checkpoint ? structuredClone(checkpoint) : null;
    },
    async beginProposalRecovery(input) {
      const existingProposal = proposal(input.proposalId);
      const existingSession = session(input.sessionId);
      if (
        existingSession.projectId !== input.projectId ||
        existingProposal.sessionId !== input.sessionId ||
        (input.kind === "apply" && existingProposal.status !== "staged") ||
        (input.kind === "apply" &&
          (
            existingProposal.baseRevision !== input.beforeRevision ||
            existingProposal.baseDocumentHash !== input.beforeDocumentHash
          )) ||
        (input.kind === "undo" &&
          (
            existingProposal.status !== "applied" ||
            JSON.stringify(checkpoints.get(input.checkpoint.checkpointId)) !==
              JSON.stringify(input.checkpoint)
          ))
      ) {
        throw storeError("Proposal recovery identity or status is invalid");
      }
      if (
        [...recovery.values()].some((operation) =>
          operation.projectId === input.projectId &&
          operation.status === "pending"
        )
      ) {
        throw storeError(
          "Another proposal recovery operation is pending for this project",
        );
      }
      const timestamp = now();
      const operation = validateAgentProposalRecoveryOperation({
        ...structuredClone(input),
        status: "pending",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      recovery.set(operation.operationId, operation);
      return cloneRecovery(operation);
    },
    async listProposalRecovery(projectId) {
      return [...recovery.values()]
        .filter((operation) => operation.projectId === projectId)
        .sort((left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.operationId.localeCompare(right.operationId)
        )
        .map(cloneRecovery);
    },
    async finalizeProposalRecovery(operationId) {
      const operation = recovery.get(operationId);
      if (!operation) return;
      if (operation.status !== "pending") {
        throw storeError("Conflicted proposal recovery cannot be finalized");
      }
      const existing = proposal(operation.proposalId);
      if (operation.kind === "apply") {
        if (
          existing.status !== "staged" &&
          !(
            existing.status === "applied" &&
            existing.appliedAt === operation.finalization.finalizedAt &&
            existing.appliedRevision === operation.afterRevision &&
            existing.appliedDocumentHash === operation.afterDocumentHash
          )
        ) {
          throw storeError("Proposal apply finalization status is invalid");
        }
        if (existing.status === "staged") {
          checkpoints.set(
            operation.checkpoint.checkpointId,
            structuredClone(operation.checkpoint),
          );
          proposals.set(existing.proposalId, {
            ...existing,
            status: "applied",
            appliedAt: operation.finalization.finalizedAt,
            appliedRevision: operation.afterRevision,
            appliedDocumentHash: operation.afterDocumentHash,
            updatedAt: operation.finalization.finalizedAt,
          });
        }
      } else {
        if (
          operation.finalization.status !== "undone" ||
          (
            existing.status !== "applied" &&
            !(
              existing.status === "undone" &&
              existing.undoneAt === operation.finalization.finalizedAt
            )
          )
        ) {
          throw storeError("Proposal undo finalization status is invalid");
        }
        if (existing.status === "applied") {
          proposals.set(existing.proposalId, {
            ...existing,
            status: "undone",
            undoneAt: operation.finalization.finalizedAt,
            updatedAt: operation.finalization.finalizedAt,
          });
        }
      }
      recovery.delete(operationId);
    },
    async abortProposalRecovery(operationId) {
      const operation = recovery.get(operationId);
      if (!operation) return;
      if (operation.status !== "pending") {
        throw storeError("Conflicted proposal recovery evidence is retained");
      }
      recovery.delete(operationId);
    },
    async markProposalRecoveryConflict(operationId, error) {
      const operation = recovery.get(operationId);
      if (!operation) throw storeError("Proposal recovery was not found");
      if (!error || error.length > 4_000) {
        throw storeError("Proposal recovery error is invalid");
      }
      const conflicted: AgentProposalRecoveryOperation = {
        ...operation,
        status: "conflict",
        error,
        updatedAt: now(),
      };
      recovery.set(operationId, conflicted);
      return cloneRecovery(conflicted);
    },
    async recordProposalRecoveryError(operationId, error) {
      const operation = recovery.get(operationId);
      if (!operation) throw storeError("Proposal recovery was not found");
      if (
        operation.status !== "pending" ||
        !error ||
        error.length > 4_000
      ) {
        throw storeError("Pending proposal recovery error is invalid");
      }
      const updated: AgentProposalRecoveryOperation = {
        ...operation,
        error,
        updatedAt: now(),
      };
      recovery.set(operationId, updated);
      return cloneRecovery(updated);
    },
    async updateUsage(sessionId, usage, context, cost) {
      const existing = session(sessionId);
      const value: AgentSessionMetadata = {
        ...existing,
        usage: { ...usage },
        ...(context ? { context: { ...context } } : {}),
        ...(cost ? { cost: { ...cost } } : {}),
        updatedAt: now(),
      };
      sessions.set(sessionId, value);
      return cloneSession(value);
    },
    async deleteProject(projectId) {
      const project = projects.get(projectId);
      if (!project) throw storeError(`Agent project "${projectId}" was not found`);
      projects.delete(projectId);
      projectPaths.delete(pathKey(project.projectPath));
      for (const [operationId, operation] of recovery) {
        if (operation.projectId !== projectId) continue;
        recovery.set(operationId, {
          ...operation,
          status: "conflict",
          error: "The project was deleted before proposal recovery completed",
          updatedAt: now(),
        });
      }
      for (const [sessionId, candidate] of sessions) {
        if (candidate.projectId !== projectId) continue;
        sessions.delete(sessionId);
        drafts.delete(sessionId);
        for (const [proposalId, stored] of proposals) {
          if (stored.sessionId === sessionId) {
            proposals.delete(proposalId);
            for (const [checkpointId, checkpoint] of checkpoints) {
              if (checkpoint.proposalId === proposalId) {
                checkpoints.delete(checkpointId);
              }
            }
          }
        }
      }
    },
    async addCleanupTombstone(input) {
      const existing = [...tombstones.values()].find((candidate) =>
        candidate.resourceKind === input.resourceKind &&
        candidate.resourceId === input.resourceId
      );
      const timestamp = now();
      const value: AgentCleanupTombstone = {
        tombstoneId: existing?.tombstoneId ??
          `memory-tombstone-${++tombstoneSequence}`,
        projectId: input.projectId,
        resourceKind: input.resourceKind,
        resourceId: input.resourceId,
        attemptCount: existing?.attemptCount ?? 0,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        ...(input.lastError ? { lastError: input.lastError } : {}),
      };
      tombstones.set(value.tombstoneId, value);
      return { ...value };
    },
    async listCleanupTombstones(limit = 100) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
        throw storeError("Cleanup tombstone limit must be between 1 and 1000");
      }
      return [...tombstones.values()]
        .sort((left, right) =>
          (left.retryAfter ?? left.createdAt).localeCompare(
            right.retryAfter ?? right.createdAt,
          ) || left.tombstoneId.localeCompare(right.tombstoneId)
        )
        .slice(0, limit)
        .map((value) => ({ ...value }));
    },
    async retryCleanupTombstone(tombstoneId, lastError) {
      const existing = tombstones.get(tombstoneId);
      if (!existing) throw storeError("Cleanup tombstone was not found");
      const timestamp = now();
      const value: AgentCleanupTombstone = {
        ...existing,
        attemptCount: existing.attemptCount + 1,
        retryAfter: timestamp,
        updatedAt: timestamp,
        ...(lastError === undefined ? {} : { lastError }),
      };
      tombstones.set(tombstoneId, value);
      return { ...value };
    },
    async removeCleanupTombstone(tombstoneId) {
      if (!tombstones.delete(tombstoneId)) {
        throw storeError("Cleanup tombstone was not found");
      }
    },
  };
}
