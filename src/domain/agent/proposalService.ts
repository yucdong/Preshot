import {
  AgentDomainError,
  AgentProposalTemporaryError,
  isAgentProposalTemporaryError,
} from "./errors";
import type {
  AgentMetadataStorePort,
  AgentStoredProposal,
} from "./metadataStore";
import type { AgentProposalApplicationPort } from "./ports";
import {
  createAgentTextEditProposal,
  hashPreshotDocument,
  type AgentTextEditProposal,
} from "./proposal";
import {
  applyAgentTextEditProposal,
  undoAgentProposalApply,
  type AgentApplyCheckpoint,
} from "./proposalApply";
import {
  createAgentProposalStackedDiff,
  type AgentProposalStackedDiff,
} from "./proposalDiff";
import type {
  AgentProposalRecoveryOperation,
  AgentProposalRecoveryResult,
} from "./proposalRecovery";

export type AgentProposalLifecycleKind =
  | "drafted"
  | "updated"
  | "applied"
  | "discarded"
  | "stale"
  | "undone";

export interface AgentProposalLifecycleEvent {
  readonly eventId: string;
  readonly sessionId: string;
  readonly proposalId: string;
  readonly kind: AgentProposalLifecycleKind;
  readonly occurredAt: string;
  readonly operationCount: number;
  readonly documentRevision?: number;
  readonly documentHash?: string;
  readonly affectedBlockIds?: readonly string[];
}

export interface AgentPreparedProposal {
  readonly proposal: AgentTextEditProposal;
  readonly diff: AgentProposalStackedDiff;
  readonly requiresDeleteConfirmation: boolean;
}

export type AgentProposalPrepareResult =
  | { readonly status: "ready"; readonly prepared: AgentPreparedProposal }
  | {
      readonly status: "stale";
      readonly proposalId: string;
      readonly currentRevision: number;
      readonly currentDocumentHash: string;
    }
  | {
      readonly status: "invalid";
      readonly proposalId: string;
      readonly message: string;
    };

export type AgentProposalApplyIntentResult =
  | {
      readonly status: "delete_confirmation_required";
      readonly proposalId: string;
      readonly deleteCount: number;
    }
  | {
      readonly status: "applied";
      readonly proposalId: string;
      readonly revision: number;
      readonly documentHash: string;
      readonly checkpointId: string;
    }
  | Exclude<AgentProposalPrepareResult, { readonly status: "ready" }>;

export type AgentProposalUndoIntentResult =
  | {
      readonly status: "undone";
      readonly proposalId: string;
      readonly revision: number;
      readonly documentHash: string;
    }
  | {
      readonly status: "conflict";
      readonly proposalId: string;
      readonly affectedBlockIds: readonly string[];
    }
  | { readonly status: "unavailable" };

export interface AgentProposalRevisionContext {
  readonly proposal: AgentTextEditProposal;
  readonly feedback: string;
  readonly currentRevision: number;
  readonly currentDocumentHash: string;
}

interface PreparedInternal extends AgentPreparedProposal {
  readonly projectedPlan: Awaited<
    ReturnType<AgentProposalApplicationPort["getCurrentPlan"]>
  >["plan"];
  readonly checkpoint: AgentApplyCheckpoint;
}

interface AgentProposalServiceDependencies {
  readonly metadata: AgentMetadataStorePort;
  readonly application: AgentProposalApplicationPort;
  readonly makeId?: () => string;
  readonly now?: () => string;
}

const MAX_REVISION_FEEDBACK_CHARS = 4_000;

function requiredProposal(
  proposals: readonly AgentStoredProposal[],
  proposalId: string,
): AgentStoredProposal {
  const stored = proposals.find((proposal) => proposal.proposalId === proposalId);
  if (!stored) {
    throw new AgentDomainError(
      "proposal_invalid",
      "proposal",
      "The proposal is not available in the active session",
    );
  }
  if (!stored.operations) {
    throw new AgentDomainError(
      "proposal_invalid",
      "proposal",
      "The proposal operation receipt is unavailable",
    );
  }
  return stored;
}

function proposalFromStored(stored: AgentStoredProposal): AgentTextEditProposal {
  return createAgentTextEditProposal({
    proposalId: stored.proposalId,
    sessionId: stored.sessionId,
    baseRevision: stored.baseRevision,
    baseDocumentHash: stored.baseDocumentHash,
  }, {
    summary: stored.summary,
    operations: stored.operations,
  });
}

function reconciliationFailure(
  phase: "apply" | "undo",
  primary: unknown,
  rollback: unknown,
): AgentDomainError {
  const primaryMessage = primary instanceof Error
    ? primary.message
    : String(primary);
  const rollbackMessage = rollback instanceof Error
    ? rollback.message
    : String(rollback);
  return new AgentDomainError(
    "store_failed",
    phase,
    `Proposal metadata failed (${primaryMessage}) and plan reconciliation failed (${rollbackMessage})`,
    {
      cause: primary,
      recovery:
        "Reload the project before retrying; the persisted plan and proposal metadata may require reconciliation.",
    },
  );
}

function recoveryConflict(
  operation: AgentProposalRecoveryOperation,
  message: string,
  cause?: unknown,
): AgentDomainError {
  return new AgentDomainError(
    "proposal_apply_conflict",
    operation.kind,
    message,
    {
      cause,
      recovery:
        "Reload the project after resolving the conflicting plan state. Preshot retained the recovery record in agent.db.",
    },
  );
}

export class AgentProposalService {
  private readonly metadata: AgentMetadataStorePort;
  private readonly application: AgentProposalApplicationPort;
  private readonly makeId: () => string;
  private readonly now: () => string;
  private readonly prepared = new Map<string, PreparedInternal>();
  private readonly recoveryRuns = new Map<
    string,
    Promise<readonly AgentProposalRecoveryResult[]>
  >();

  constructor(dependencies: AgentProposalServiceDependencies) {
    this.metadata = dependencies.metadata;
    this.application = dependencies.application;
    this.makeId = dependencies.makeId ?? (() => crypto.randomUUID());
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  async list(sessionId: string): Promise<readonly AgentStoredProposal[]> {
    return this.metadata.listProposals(sessionId, 50);
  }

  private async resolveRecoveryOperation(
    operation: AgentProposalRecoveryOperation,
  ): Promise<AgentProposalRecoveryResult> {
    if (operation.status === "conflict") {
      return { status: "conflict", operation };
    }
    let current: Awaited<
      ReturnType<AgentProposalApplicationPort["getCurrentPlan"]>
    >;
    try {
      current = await this.application.getCurrentPlan(operation.projectId);
    } catch (error) {
      if (isAgentProposalTemporaryError(error)) {
        const retained = await this.metadata.recordProposalRecoveryError(
          operation.operationId,
          `[${error.code}] ${error.message}`,
        );
        return {
          status: "retryable",
          operation: retained,
          code: error.code,
        };
      }
      const message = `Unable to read the project for proposal recovery: ${
        error instanceof Error ? error.message : String(error)
      }`;
      const conflict = await this.metadata.markProposalRecoveryConflict(
        operation.operationId,
        message,
      );
      return { status: "conflict", operation: conflict };
    }
    const currentHash = hashPreshotDocument(current.plan.document);
    if (currentHash === operation.beforeDocumentHash) {
      await this.metadata.abortProposalRecovery(operation.operationId);
      return {
        status: "cleared",
        operationId: operation.operationId,
        kind: operation.kind,
        proposalId: operation.proposalId,
      };
    }
    if (currentHash === operation.afterDocumentHash) {
      await this.metadata.finalizeProposalRecovery(operation.operationId);
      return {
        status: "finalized",
        operationId: operation.operationId,
        kind: operation.kind,
        proposalId: operation.proposalId,
      };
    }
    const conflict = await this.metadata.markProposalRecoveryConflict(
      operation.operationId,
      `Current document hash ${currentHash} matches neither journal boundary`,
    );
    return { status: "conflict", operation: conflict };
  }

  private async recoverProjectOnce(
    projectId: string,
  ): Promise<readonly AgentProposalRecoveryResult[]> {
    const operations = await this.metadata.listProposalRecovery(projectId);
    const results: AgentProposalRecoveryResult[] = [];
    for (const operation of operations) {
      results.push(await this.resolveRecoveryOperation(operation));
    }
    return results;
  }

  recoverProject(
    projectId: string,
  ): Promise<readonly AgentProposalRecoveryResult[]> {
    const active = this.recoveryRuns.get(projectId);
    if (active) return active;
    const run = this.recoverProjectOnce(projectId).finally(() => {
      if (this.recoveryRuns.get(projectId) === run) {
        this.recoveryRuns.delete(projectId);
      }
    });
    this.recoveryRuns.set(projectId, run);
    return run;
  }

  private async requireRecoveryReady(projectId: string): Promise<void> {
    const results = await this.recoverProject(projectId);
    const retryable = results.find((result) =>
      result.status === "retryable"
    );
    if (retryable?.status === "retryable") {
      throw new AgentProposalTemporaryError(
        retryable.code,
        retryable.operation.error ??
          "Proposal recovery is waiting for the active plan",
      );
    }
    const conflict = results.find((result) => result.status === "conflict");
    if (conflict?.status === "conflict") {
      throw recoveryConflict(
        conflict.operation,
        conflict.operation.error ??
          "A proposal recovery conflict must be resolved before continuing",
      );
    }
  }

  private async finalizeOrInspect(
    operation: AgentProposalRecoveryOperation,
  ): Promise<
    | { readonly status: "finalized" }
    | { readonly status: "pending"; readonly error: unknown }
    | { readonly status: "conflict"; readonly error: unknown }
  > {
    try {
      await this.metadata.finalizeProposalRecovery(operation.operationId);
      return { status: "finalized" };
    } catch (error) {
      const entries = await this.metadata.listProposalRecovery(
        operation.projectId,
      ).catch(() => {
        throw error;
      });
      const retained = entries.find(
        (candidate) => candidate.operationId === operation.operationId,
      );
      if (!retained) return { status: "finalized" };
      return { status: retained.status, error };
    }
  }

  private async reconcileMutationFailure(
    operation: AgentProposalRecoveryOperation,
    primary: unknown,
  ): Promise<"finalized" | "cleared"> {
    let current: Awaited<
      ReturnType<AgentProposalApplicationPort["getCurrentPlan"]>
    >;
    try {
      current = await this.application.getCurrentPlan(operation.projectId);
    } catch (readError) {
      await this.metadata.recordProposalRecoveryError(
        operation.operationId,
        `Mutation failed and current project state is unavailable: ${
          readError instanceof Error ? readError.message : String(readError)
        }`,
      ).catch(() => undefined);
      throw reconciliationFailure(operation.kind, primary, readError);
    }
    const hash = hashPreshotDocument(current.plan.document);
    if (hash === operation.beforeDocumentHash) {
      await this.metadata.abortProposalRecovery(operation.operationId);
      return "cleared";
    }
    if (hash === operation.afterDocumentHash) {
      const finalized = await this.finalizeOrInspect(operation);
      if (finalized.status === "finalized") return "finalized";
      if (finalized.status === "conflict") {
        throw recoveryConflict(
          operation,
          "Proposal recovery was marked conflicted while finalizing",
          primary,
        );
      }
      await this.metadata.recordProposalRecoveryError(
        operation.operationId,
        `Project mutation persisted but metadata finalization failed: ${
          primary instanceof Error ? primary.message : String(primary)
        }`,
      ).catch(() => undefined);
      throw reconciliationFailure(
        operation.kind,
        primary,
        new Error("The durable recovery journal remains pending"),
      );
    }
    const conflict = await this.metadata.markProposalRecoveryConflict(
      operation.operationId,
      `Mutation failed and current document hash ${hash} matches neither journal boundary`,
    );
    throw recoveryConflict(
      conflict,
      "The plan changed during proposal recovery; no automatic mutation was attempted",
      primary,
    );
  }

  async prepare(
    projectId: string,
    sessionId: string,
    proposalId: string,
  ): Promise<AgentProposalPrepareResult> {
    await this.requireRecoveryReady(projectId);
    const stored = requiredProposal(
      await this.metadata.listProposals(sessionId, 50),
      proposalId,
    );
    if (stored.sessionId !== sessionId || stored.status !== "staged") {
      throw new AgentDomainError(
        "proposal_invalid",
        "proposal",
        "The proposal is not staged for the active session",
      );
    }
    const proposal = proposalFromStored(stored);
    const current = await this.application.getCurrentPlan(projectId);
    const applied = applyAgentTextEditProposal(
      current.plan,
      current.revision,
      proposal,
      {
        projectId,
        makeId: this.makeId,
        makeCheckpointId: this.makeId,
        appliedAt: this.now(),
      },
    );
    if (applied.status === "stale" || applied.status === "conflict") {
      await this.metadata.markProposalStale(proposalId);
      this.prepared.delete(proposalId);
      return {
        status: "stale",
        proposalId,
        currentRevision: current.revision,
        currentDocumentHash: hashPreshotDocument(current.plan.document),
      };
    }
    if (applied.status === "invalid") {
      this.prepared.delete(proposalId);
      return { status: "invalid", proposalId, message: applied.message };
    }
    const prepared: PreparedInternal = Object.freeze({
      proposal,
      projectedPlan: applied.plan,
      checkpoint: applied.checkpoint,
      diff: createAgentProposalStackedDiff(
        proposal,
        current.plan,
        applied.plan,
      ),
      requiresDeleteConfirmation: proposal.operations.some(
        (operation) => operation.op === "delete",
      ),
    });
    this.prepared.set(proposalId, prepared);
    return { status: "ready", prepared };
  }

  async apply(
    projectId: string,
    sessionId: string,
    proposalId: string,
    confirmDeletion = false,
  ): Promise<AgentProposalApplyIntentResult> {
    await this.requireRecoveryReady(projectId);
    let prepared = this.prepared.get(proposalId);
    if (!prepared) {
      const result = await this.prepare(projectId, sessionId, proposalId);
      if (result.status !== "ready") return result;
      prepared = this.prepared.get(proposalId);
      if (!prepared) {
        throw new AgentDomainError(
          "proposal_invalid",
          "proposal",
          "The prepared proposal projection was not retained",
        );
      }
    }
    if (prepared.proposal.sessionId !== sessionId) {
      throw new AgentDomainError(
        "tool_denied",
        "proposal",
        "The proposal belongs to another session",
      );
    }
    const deleteCount = prepared.proposal.operations.filter(
      (operation) => operation.op === "delete",
    ).length;
    if (deleteCount > 0 && !confirmDeletion) {
      return {
        status: "delete_confirmation_required",
        proposalId,
        deleteCount,
      };
    }
    const current = await this.application.getCurrentPlan(projectId);
    if (
      current.revision !== prepared.proposal.baseRevision ||
      hashPreshotDocument(current.plan.document) !==
        prepared.proposal.baseDocumentHash
    ) {
      await this.metadata.markProposalStale(proposalId);
      this.prepared.delete(proposalId);
      return {
        status: "stale",
        proposalId,
        currentRevision: current.revision,
        currentDocumentHash: hashPreshotDocument(current.plan.document),
      };
    }
    const checkpoint: AgentApplyCheckpoint = {
      ...prepared.checkpoint,
      appliedDocumentHash: hashPreshotDocument(
        prepared.projectedPlan.document,
      ),
    };
    const finalizationAt = this.now();
    const operation = await this.metadata.beginProposalRecovery({
      operationId: this.makeId(),
      kind: "apply",
      proposalId,
      sessionId,
      projectId,
      beforeDocumentHash: prepared.proposal.baseDocumentHash,
      beforeRevision: current.revision,
      afterDocumentHash: checkpoint.appliedDocumentHash,
      afterRevision: current.revision + 1,
      checkpoint,
      finalization: {
        status: "applied",
        finalizedAt: finalizationAt,
        revision: current.revision + 1,
        documentHash: checkpoint.appliedDocumentHash,
      },
    });
    try {
      await this.application.applyAtomically({
        projectId,
        expectedRevision: current.revision,
        expectedDocumentHash: prepared.proposal.baseDocumentHash,
        projectedPlan: prepared.projectedPlan,
      });
    } catch (error) {
      const reconciled = await this.reconcileMutationFailure(operation, error);
      if (reconciled === "cleared") throw error;
    }
    const finalized = await this.finalizeOrInspect(operation);
    if (finalized.status === "pending") {
      try {
        await this.application.rollbackAtomically({
          projectId,
          expectedRevision: current.revision + 1,
          expectedDocumentHash: checkpoint.appliedDocumentHash,
          snapshotPlan: checkpoint.beforePlan,
          snapshotRevision: current.revision,
        });
      } catch (rollbackError) {
        await this.metadata.recordProposalRecoveryError(
          operation.operationId,
          `Metadata finalization and plan rollback failed: ${
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError)
          }`,
        ).catch(() => undefined);
        throw reconciliationFailure("apply", finalized.error, rollbackError);
      }
      await this.metadata.abortProposalRecovery(operation.operationId);
      throw new AgentDomainError(
        "store_failed",
        "apply",
        `Proposal metadata finalization failed; the plan was restored: ${
          finalized.error instanceof Error
            ? finalized.error.message
            : String(finalized.error)
        }`,
        { cause: finalized.error },
      );
    }
    if (finalized.status === "conflict") {
      throw recoveryConflict(
        operation,
        "Proposal metadata finalization is conflicted",
      );
    }
    this.prepared.delete(proposalId);
    return {
      status: "applied",
      proposalId,
      revision: current.revision + 1,
      documentHash: checkpoint.appliedDocumentHash,
      checkpointId: checkpoint.checkpointId,
    };
  }

  async discard(sessionId: string, proposalId: string): Promise<void> {
    const stored = requiredProposal(
      await this.metadata.listProposals(sessionId, 50),
      proposalId,
    );
    if (stored.sessionId !== sessionId) {
      throw new AgentDomainError(
        "tool_denied",
        "proposal",
        "The proposal belongs to another session",
      );
    }
    await this.metadata.discardProposal(proposalId);
    this.prepared.delete(proposalId);
  }

  async revisionContext(
    projectId: string,
    sessionId: string,
    proposalId: string,
    feedback: string,
  ): Promise<AgentProposalRevisionContext> {
    const normalized = feedback.trim();
    if (
      !normalized ||
      normalized.length > MAX_REVISION_FEEDBACK_CHARS
    ) {
      throw new AgentDomainError(
        "proposal_invalid",
        "proposal",
        `Revision feedback must contain 1-${MAX_REVISION_FEEDBACK_CHARS} characters`,
      );
    }
    const stored = requiredProposal(
      await this.metadata.listProposals(sessionId, 50),
      proposalId,
    );
    if (stored.sessionId !== sessionId || stored.status !== "staged") {
      throw new AgentDomainError(
        "tool_denied",
        "proposal",
        "Only the active session proposal may be revised",
      );
    }
    const current = await this.application.getCurrentPlan(projectId);
    return Object.freeze({
      proposal: proposalFromStored(stored),
      feedback: normalized,
      currentRevision: current.revision,
      currentDocumentHash: hashPreshotDocument(current.plan.document),
    });
  }

  async undo(
    projectId: string,
    sessionId: string,
  ): Promise<AgentProposalUndoIntentResult> {
    await this.requireRecoveryReady(projectId);
    const checkpoint = await this.metadata.readLatestCheckpoint(sessionId);
    if (!checkpoint) return { status: "unavailable" };
    if (
      checkpoint.projectId !== projectId ||
      checkpoint.sessionId !== sessionId
    ) {
      throw new AgentDomainError(
        "tool_denied",
        "proposal",
        "The proposal checkpoint belongs to another project or session",
      );
    }
    const current = await this.application.getCurrentPlan(projectId);
    const undone = undoAgentProposalApply(
      checkpoint,
      current.plan,
      current.revision,
    );
    if (undone.status === "conflict") {
      return {
        status: "conflict",
        proposalId: checkpoint.proposalId,
        affectedBlockIds: undone.affectedBlockIds,
      };
    }
    const beforeDocumentHash = hashPreshotDocument(current.plan.document);
    const operation = await this.metadata.beginProposalRecovery({
      operationId: this.makeId(),
      kind: "undo",
      proposalId: checkpoint.proposalId,
      sessionId,
      projectId,
      beforeDocumentHash,
      beforeRevision: current.revision,
      afterDocumentHash: undone.documentHash,
      afterRevision: undone.revision,
      checkpoint,
      finalization: {
        status: "undone",
        finalizedAt: this.now(),
      },
    });
    try {
      await this.application.restoreCheckpointAtomically({
        projectId,
        expectedRevision: current.revision,
        expectedDocumentHash: beforeDocumentHash,
        restoredPlan: undone.plan,
      });
    } catch (error) {
      const reconciled = await this.reconcileMutationFailure(operation, error);
      if (reconciled === "cleared") throw error;
    }
    const finalized = await this.finalizeOrInspect(operation);
    if (finalized.status === "pending") {
      try {
        await this.application.rollbackAtomically({
          projectId,
          expectedRevision: undone.revision,
          expectedDocumentHash: undone.documentHash,
          snapshotPlan: current.plan,
          snapshotRevision: current.revision,
        });
      } catch (rollbackError) {
        await this.metadata.recordProposalRecoveryError(
          operation.operationId,
          `Undo metadata finalization and plan rollback failed: ${
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError)
          }`,
        ).catch(() => undefined);
        throw reconciliationFailure("undo", finalized.error, rollbackError);
      }
      await this.metadata.abortProposalRecovery(operation.operationId);
      throw new AgentDomainError(
        "store_failed",
        "undo",
        `Undo metadata finalization failed; the plan was restored: ${
          finalized.error instanceof Error
            ? finalized.error.message
            : String(finalized.error)
        }`,
        { cause: finalized.error },
      );
    }
    if (finalized.status === "conflict") {
      throw recoveryConflict(
        operation,
        "Undo metadata finalization is conflicted",
      );
    }
    return {
      status: "undone",
      proposalId: checkpoint.proposalId,
      revision: undone.revision,
      documentHash: undone.documentHash,
    };
  }
}
