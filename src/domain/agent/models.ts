import type { AgentErrorDetails } from "./errors";
import type {
  AgentContextUsage,
  AgentMonetaryCost,
  AgentTokenUsage,
} from "./usage";

export type AgentProviderType = "openai";
export type AgentWireApi = "responses";
export type AgentReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type AgentReasoningSummary = "none" | "concise" | "detailed";
export type AgentCapabilityStatus = "verified" | "unsupported" | "unknown";

export interface AgentModelCapabilities {
  readonly responsesApi: AgentCapabilityStatus;
  readonly streaming: AgentCapabilityStatus;
  readonly customTools: AgentCapabilityStatus;
  readonly imageInput: AgentCapabilityStatus;
  readonly reasoningSummary: boolean;
  readonly reasoningEffort: boolean;
  readonly contextWindowTokens: number | null;
}

export interface AgentModelSettings {
  readonly enabled: boolean;
  readonly providerType: AgentProviderType;
  readonly displayUrl: string;
  readonly apiBaseUrl: string;
  readonly modelId: string | null;
  readonly wireApi: AgentWireApi;
  readonly reasoningEffort: AgentReasoningEffort | null;
  readonly reasoningSummary: AgentReasoningSummary;
}

export type AgentSessionState =
  | "creating"
  | "idle"
  | "running"
  | "waiting_permission"
  | "waiting_user_input"
  | "stopping"
  | "disconnected"
  | "error"
  | "deleting";

export type AgentProjectMetadataState =
  | "active"
  | "deleting"
  | "cleanup_pending";

export interface AgentProjectMetadata {
  readonly projectId: string;
  readonly projectPath: string;
  readonly projectName: string;
  readonly state: AgentProjectMetadataState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentSessionMetadata {
  readonly sessionId: string;
  readonly projectId: string;
  readonly projectPath: string;
  readonly title: string;
  readonly modelId?: string;
  readonly state: AgentSessionState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastError?: AgentErrorDetails;
  readonly interruptedAt?: string;
  readonly usage?: AgentTokenUsage;
  readonly context?: AgentContextUsage;
  readonly cost?: AgentMonetaryCost;
}

export interface AgentDraft {
  readonly sessionId: string;
  readonly text: string;
  readonly updatedAt: string;
}

export type AgentSaveState = "saved" | "unsaved" | "saving";

export interface AgentImageReference {
  readonly projectId: string;
  readonly groupId: string;
  readonly imageId: string;
  readonly selectionVersion: number;
  readonly displayName: string;
  readonly thumbnailDataUrl: string;
}

export interface AgentReferenceImageMetadata {
  readonly groupId: string;
  readonly imageId: string;
  readonly displayName: string;
  readonly groupLabel: string;
  readonly width: number | null;
  readonly height: number | null;
}

export interface AgentWorkspaceSnapshot {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectHandle: string;
  readonly documentRevision: number;
  readonly documentHash: string;
  readonly selectedBlockIds: readonly string[];
  readonly referenceImages?: readonly AgentReferenceImageMetadata[];
  readonly cursorBlockId?: string;
  readonly selectedImage?: AgentImageReference;
  readonly saveState: AgentSaveState;
}

export interface AgentContextChip {
  readonly id: string;
  readonly kind:
    | "project"
    | "document"
    | "selected_blocks"
    | "cursor_block"
    | "selected_image";
  readonly label: string;
  readonly removable: boolean;
}

export interface AgentContextReceipt {
  readonly projectId: string;
  readonly projectName: string;
  readonly documentRevision: number;
  readonly documentHash: string;
  readonly selectedBlockIds: readonly string[];
  readonly referenceImages?: readonly AgentReferenceImageMetadata[];
  readonly cursorBlockId?: string;
  readonly selectedImage?: Readonly<{
    groupId: string;
    imageId: string;
    displayName: string;
  }>;
  readonly capturedAt: string;
}

export interface AgentImageAttachment {
  readonly kind: "selected_image";
  readonly projectId: string;
  readonly groupId: string;
  readonly imageId: string;
  readonly selectionVersion: number;
  readonly displayName: string;
  readonly thumbnailDataUrl: string;
  readonly pinned: boolean;
}

export interface AgentAttachmentReceipt {
  readonly kind: "selected_image";
  readonly projectId: string;
  readonly groupId: string;
  readonly imageId: string;
  readonly displayName: string;
  readonly pinned: boolean;
}

export interface AgentRequestContextDraft {
  readonly projectId: string;
  readonly snapshot: AgentWorkspaceSnapshot;
  readonly includeSelectedBlocks: boolean;
  readonly includeCursorBlock: boolean;
  readonly attachment: AgentImageAttachment | null;
  readonly dismissedAutoImageKey?: string;
}

export interface AgentTurnContext {
  readonly receipt: AgentContextReceipt;
  readonly attachment: AgentAttachmentReceipt | null;
}

export interface AgentBlockCitation {
  readonly kind: "block";
  readonly projectId: string;
  readonly blockId: string;
}

export interface AgentImageCitation {
  readonly kind: "image";
  readonly projectId: string;
  readonly groupId: string;
  readonly imageId: string;
}

export type AgentCitation = AgentBlockCitation | AgentImageCitation;

export type AgentCitationNavigationResult =
  | { readonly status: "navigated" }
  | {
      readonly status: "unavailable";
      readonly reason:
        | "project_changed"
        | "source_deleted"
        | "navigation_unavailable";
    };
