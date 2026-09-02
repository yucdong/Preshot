import type { ProjectPlanV14 } from "../plan/canvas/blockDocument";
import type { AgentErrorDetails } from "./errors";
import type { AgentNormalizedEvent } from "./eventReducer";
import type {
  AgentBlockCitation,
  AgentCitationNavigationResult,
  AgentContextReceipt,
  AgentDraft,
  AgentAttachmentReceipt,
  AgentImageCitation,
  AgentModelCapabilities,
  AgentModelSettings,
  AgentSessionMetadata,
  AgentWorkspaceSnapshot,
} from "./models";
import type {
  AgentApplyCheckpoint,
  AgentAppliedProposalReceipt,
  AgentDiscardedProposalReceipt,
} from "./proposalApply";
import type { AgentTextEditProposal } from "./proposal";
import type { AgentTokenUsage } from "./usage";

export interface AgentDiscoveredModel {
  readonly id: string;
  readonly displayName: string;
}

export interface AgentConnectionProbeResult {
  readonly modelId: string;
  readonly capabilities: AgentModelCapabilities;
  readonly usage: AgentTokenUsage | null;
}

export interface AgentModelProbePort {
  listModels(
    settings: AgentModelSettings,
    signal?: AbortSignal,
  ): Promise<readonly AgentDiscoveredModel[]>;
  probeModel(
    settings: AgentModelSettings,
    modelId: string,
    options: {
      readonly verifyVision: boolean;
      readonly signal?: AbortSignal;
    },
  ): Promise<AgentConnectionProbeResult>;
}

export interface AgentModelSettingsStorePort {
  load(): Promise<import("./settings").PersistedAgentModelSettings>;
  save(settings: import("./settings").PersistedAgentModelSettings): Promise<void>;
}

export interface AgentRuntimeSessionConfig {
  readonly projectId: string;
  readonly projectPath: string;
  readonly modelId: string;
  readonly settings: AgentModelSettings;
  readonly capabilities: AgentModelCapabilities;
  readonly toolPolicy: Readonly<{
    allowedTools: readonly [
      "get_project_summary",
      "read_text_blocks",
      "list_reference_images",
      "propose_text_block_edits",
    ];
    permissionMode: "request";
  }>;
  readonly continuePendingWork: false;
}

export interface AgentSendRequest {
  readonly sessionId: string;
  readonly text: string;
  readonly context: AgentContextReceipt;
  readonly attachment: AgentAttachmentReceipt | null;
}

export interface AgentRuntimePort {
  listModels(settings: AgentModelSettings): Promise<readonly AgentDiscoveredModel[]>;
  testConnection(
    settings: AgentModelSettings,
    modelId: string,
  ): Promise<AgentConnectionProbeResult>;
  createSession(config: AgentRuntimeSessionConfig): Promise<{ sessionId: string }>;
  resumeSession(
    sessionId: string,
    config: AgentRuntimeSessionConfig,
  ): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  disconnect(sessionId: string): Promise<void>;
  send(request: AgentSendRequest): Promise<void>;
  abort(sessionId: string): Promise<void>;
  getEvents(sessionId: string): Promise<readonly AgentNormalizedEvent[]>;
  subscribe(
    sessionId: string,
    listener: (event: AgentNormalizedEvent) => void,
  ): Promise<() => void>;
  resolvePermission(
    sessionId: string,
    requestId: string,
    decision: "allowed" | "denied",
  ): Promise<void>;
  resolveInput(
    sessionId: string,
    requestId: string,
    value: string | null,
  ): Promise<void>;
}

export interface AgentStorePort {
  loadSettings(): Promise<AgentModelSettings>;
  saveSettings(settings: AgentModelSettings): Promise<void>;
  listSessions(projectId: string): Promise<readonly AgentSessionMetadata[]>;
  saveSession(session: AgentSessionMetadata): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  loadDraft(sessionId: string): Promise<AgentDraft | null>;
  saveDraft(draft: AgentDraft): Promise<void>;
  saveProposal(proposal: AgentTextEditProposal): Promise<void>;
  saveProposalReceipt(
    receipt: AgentAppliedProposalReceipt | AgentDiscardedProposalReceipt,
  ): Promise<void>;
  saveCheckpoint(checkpoint: AgentApplyCheckpoint): Promise<void>;
  saveUsage(sessionId: string, usage: AgentTokenUsage): Promise<void>;
  saveError(sessionId: string, error: AgentErrorDetails): Promise<void>;
  deleteProjectSessions(projectId: string): Promise<void>;
}

export interface AgentTextBlockRead {
  readonly blockId: string;
  readonly blockHash: string;
  readonly type: string;
  readonly text: string;
}

export interface AgentWorkspaceBridgePort {
  captureSnapshot(): AgentWorkspaceSnapshot;
  issueAttachment(
    attachment: AgentAttachmentReceipt,
    expectedProjectId: string,
    expectedDocumentRevision: number,
  ): string;
  revokeAttachment(attachment: AgentAttachmentReceipt): void;
  readTextBlocks(
    snapshot: AgentWorkspaceSnapshot,
    blockIds: readonly string[],
  ): readonly AgentTextBlockRead[];
  navigateToBlock(
    citation: AgentBlockCitation,
  ): AgentCitationNavigationResult;
  navigateToImage(
    citation: AgentImageCitation,
    open: boolean,
  ): AgentCitationNavigationResult;
}

export interface AgentProjectRegistration {
  readonly projectId: string;
  readonly projectPath: string;
}

export interface AgentAttachmentTokenIssue {
  readonly projectId: string;
  readonly projectHandle: string;
  readonly documentRevision: number;
  readonly groupId: string;
  readonly imageId: string;
  readonly relativeFile: string;
  readonly pinned: boolean;
}

export interface AgentAttachmentTokenResolve {
  readonly token: string;
  readonly expectedProjectId: string;
  readonly expectedDocumentRevision: number;
}

export interface AgentResolvedAttachment {
  readonly projectId: string;
  readonly documentRevision: number;
  readonly groupId: string;
  readonly imageId: string;
  readonly absolutePath: string;
}

export interface AgentAttachmentTokenResolverPort {
  registerProject(registration: AgentProjectRegistration): string;
  issueAttachment(input: AgentAttachmentTokenIssue): string;
  resolveAttachment(
    input: AgentAttachmentTokenResolve,
  ): Promise<AgentResolvedAttachment>;
  revokeAttachment(token: string): void;
  revokeImage(projectId: string, groupId: string, imageId: string): void;
  retainProjectRevision(projectId: string, documentRevision: number): void;
  pruneExpired(): void;
  revokeProject(projectId: string): void;
}

export interface AgentProposalMutationPort {
  getCurrentPlan(projectId: string): Promise<{
    readonly plan: ProjectPlanV14;
    readonly revision: number;
  }>;
  applyAtomically(input: {
    readonly projectId: string;
    readonly expectedRevision: number;
    readonly expectedDocumentHash: string;
    readonly projectedPlan: ProjectPlanV14;
  }): Promise<void>;
  restoreCheckpointAtomically(input: {
    readonly projectId: string;
    readonly expectedRevision: number;
    readonly expectedDocumentHash: string;
    readonly restoredPlan: ProjectPlanV14;
  }): Promise<void>;
  rollbackAtomically(input: {
    readonly projectId: string;
    readonly expectedRevision: number;
    readonly expectedDocumentHash: string;
    readonly snapshotPlan: ProjectPlanV14;
    readonly snapshotRevision: number;
  }): Promise<void>;
}

export type AgentProposalApplicationReadiness =
  | {
      readonly status: "ready";
      readonly projectId: string;
      readonly revision: number;
    }
  | {
      readonly status: "loading" | "bridge_not_ready";
      readonly projectId: string;
    };

export interface AgentProposalApplicationPort
  extends AgentProposalMutationPort {
  getReadiness(projectId: string): AgentProposalApplicationReadiness;
  subscribeReadiness(
    listener: (readiness: AgentProposalApplicationReadiness) => void,
  ): () => void;
}
