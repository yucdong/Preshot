import type { AgentErrorDetails } from "./errors";
import type {
  AgentDraft,
  AgentProjectMetadata,
  AgentSessionMetadata,
  AgentSessionState,
} from "./models";
import type {
  AgentTextEditOperation,
  AgentTextEditProposal,
} from "./proposal";
import type { AgentApplyCheckpoint } from "./proposalApply";
import type {
  AgentProposalRecoveryOperation,
} from "./proposalRecovery";
import type {
  AgentContextUsage,
  AgentMonetaryCost,
  AgentTokenUsage,
} from "./usage";

export interface AgentProjectAdoption {
  readonly projectId: string;
  readonly projectPath: string;
  readonly projectName: string;
}

export interface AgentSessionCreateInput {
  readonly sessionId: string;
  readonly projectId: string;
  readonly title: string;
  readonly state: AgentSessionState;
  readonly modelId?: string;
}

export interface AgentSessionUpdateInput {
  readonly sessionId: string;
  readonly state: AgentSessionState;
  readonly modelId?: string;
  readonly lastError?: AgentErrorDetails;
  readonly interruptedAt?: string;
}

export type AgentStoredProposalStatus =
  | "staged"
  | "stale"
  | "applied"
  | "discarded"
  | "undone";

export interface AgentStoredProposal {
  readonly proposalId: string;
  readonly sessionId: string;
  readonly status: AgentStoredProposalStatus;
  readonly summary: string;
  readonly baseRevision: number;
  readonly baseDocumentHash: string;
  readonly operationCount: number;
  readonly operations?: readonly AgentTextEditOperation[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly appliedAt?: string;
  readonly appliedRevision?: number;
  readonly appliedDocumentHash?: string;
  readonly discardedAt?: string;
  readonly undoneAt?: string;
}

export interface AgentCleanupTombstone {
  readonly tombstoneId: string;
  readonly projectId: string;
  readonly resourceKind: "copilot_session";
  readonly resourceId: string;
  readonly attemptCount: number;
  readonly lastError?: string;
  readonly retryAfter?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentMetadataStorePort {
  adoptProject(project: AgentProjectAdoption): Promise<AgentProjectMetadata>;
  listSessions(projectId: string): Promise<readonly AgentSessionMetadata[]>;
  createSession(input: AgentSessionCreateInput): Promise<AgentSessionMetadata>;
  updateSession(input: AgentSessionUpdateInput): Promise<AgentSessionMetadata>;
  renameSession(sessionId: string, title: string): Promise<AgentSessionMetadata>;
  deleteSession(sessionId: string): Promise<void>;
  readDraft(sessionId: string): Promise<AgentDraft | null>;
  writeDraft(sessionId: string, text: string): Promise<AgentDraft>;
  createProposal(
    proposal: AgentTextEditProposal,
    retainOperations?: boolean,
  ): Promise<AgentStoredProposal>;
  listProposals(
    sessionId: string,
    limit?: number,
  ): Promise<readonly AgentStoredProposal[]>;
  markProposalStale(proposalId: string): Promise<AgentStoredProposal>;
  discardProposal(proposalId: string): Promise<AgentStoredProposal>;
  applyProposal(
    proposalId: string,
    appliedRevision: number,
    appliedDocumentHash: string,
  ): Promise<AgentStoredProposal>;
  commitProposalApply(
    checkpoint: AgentApplyCheckpoint,
    appliedRevision: number,
    appliedDocumentHash: string,
  ): Promise<AgentStoredProposal>;
  undoProposal(proposalId: string): Promise<AgentStoredProposal>;
  saveCheckpoint(checkpoint: AgentApplyCheckpoint): Promise<void>;
  readLatestCheckpoint(
    sessionId: string,
  ): Promise<AgentApplyCheckpoint | null>;
  beginProposalRecovery(
    operation: Omit<
      AgentProposalRecoveryOperation,
      "status" | "createdAt" | "updatedAt" | "error"
    >,
  ): Promise<AgentProposalRecoveryOperation>;
  listProposalRecovery(
    projectId: string,
  ): Promise<readonly AgentProposalRecoveryOperation[]>;
  finalizeProposalRecovery(operationId: string): Promise<void>;
  abortProposalRecovery(operationId: string): Promise<void>;
  markProposalRecoveryConflict(
    operationId: string,
    error: string,
  ): Promise<AgentProposalRecoveryOperation>;
  recordProposalRecoveryError(
    operationId: string,
    error: string,
  ): Promise<AgentProposalRecoveryOperation>;
  updateUsage(
    sessionId: string,
    usage: AgentTokenUsage,
    context?: AgentContextUsage,
    cost?: AgentMonetaryCost,
  ): Promise<AgentSessionMetadata>;
  deleteProject(projectId: string): Promise<void>;
  addCleanupTombstone(input: {
    readonly projectId: string;
    readonly resourceKind: "copilot_session";
    readonly resourceId: string;
    readonly lastError?: string;
  }): Promise<AgentCleanupTombstone>;
  listCleanupTombstones(limit?: number): Promise<readonly AgentCleanupTombstone[]>;
  retryCleanupTombstone(
    tombstoneId: string,
    lastError?: string,
  ): Promise<AgentCleanupTombstone>;
  removeCleanupTombstone(tombstoneId: string): Promise<void>;
}
