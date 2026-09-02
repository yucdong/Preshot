import { validateAgentApplyCheckpoint } from "./proposalCheckpoint";
import type { AgentApplyCheckpoint } from "./proposalApply";

export type AgentProposalRecoveryKind = "apply" | "undo";
export type AgentProposalRecoveryStatus = "pending" | "conflict";

export type AgentProposalFinalization =
  | {
      readonly status: "applied";
      readonly finalizedAt: string;
      readonly revision: number;
      readonly documentHash: string;
    }
  | {
      readonly status: "undone";
      readonly finalizedAt: string;
    };

export interface AgentProposalRecoveryOperation {
  readonly operationId: string;
  readonly kind: AgentProposalRecoveryKind;
  readonly proposalId: string;
  readonly sessionId: string;
  readonly projectId: string;
  readonly beforeDocumentHash: string;
  readonly beforeRevision: number;
  readonly afterDocumentHash: string;
  readonly afterRevision: number;
  readonly checkpoint: AgentApplyCheckpoint;
  readonly finalization: AgentProposalFinalization;
  readonly status: AgentProposalRecoveryStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly error?: string;
}

export type AgentProposalRecoveryResult =
  | {
      readonly status: "cleared";
      readonly operationId: string;
      readonly kind: AgentProposalRecoveryKind;
      readonly proposalId: string;
    }
  | {
      readonly status: "finalized";
      readonly operationId: string;
      readonly kind: AgentProposalRecoveryKind;
      readonly proposalId: string;
    }
  | {
      readonly status: "conflict";
      readonly operation: AgentProposalRecoveryOperation;
    }
  | {
      readonly status: "retryable";
      readonly operation: AgentProposalRecoveryOperation;
      readonly code: import("./errors").AgentProposalTemporaryErrorCode;
    };

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAX_ID_CHARS = 200;
const MAX_ERROR_CHARS = 4_000;
const MAX_CHECKPOINT_JSON_BYTES = 4 * 1024 * 1024;
const MAX_FINALIZATION_JSON_BYTES = 4 * 1024;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error(`${label} contains unsupported fields`);
  }
}

function identifier(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_ID_CHARS
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function revision(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function hash(value: unknown, label: string): string {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length > 100 ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function validateFinalization(
  raw: unknown,
  kind: AgentProposalRecoveryKind,
  afterRevision: number,
  afterDocumentHash: string,
): AgentProposalFinalization {
  const value = record(raw, "Proposal finalization");
  if (kind === "apply") {
    exactKeys(
      value,
      ["status", "finalizedAt", "revision", "documentHash"],
      "Proposal finalization",
    );
    if (
      value.status !== "applied" ||
      revision(value.revision, "Proposal finalization revision") !==
        afterRevision ||
      hash(value.documentHash, "Proposal finalization document hash") !==
        afterDocumentHash
    ) {
      throw new Error("Apply finalization does not match the journal");
    }
    return {
      status: "applied",
      finalizedAt: timestamp(
        value.finalizedAt,
        "Proposal finalization timestamp",
      ),
      revision: afterRevision,
      documentHash: afterDocumentHash,
    };
  }
  exactKeys(
    value,
    ["status", "finalizedAt"],
    "Proposal finalization",
  );
  if (value.status !== "undone") {
    throw new Error("Undo finalization does not match the journal");
  }
  return {
    status: "undone",
    finalizedAt: timestamp(
      value.finalizedAt,
      "Proposal finalization timestamp",
    ),
  };
}

export function validateAgentProposalRecoveryOperation(
  raw: unknown,
): AgentProposalRecoveryOperation {
  const value = record(raw, "Proposal recovery operation");
  exactKeys(value, [
    "operationId",
    "kind",
    "proposalId",
    "sessionId",
    "projectId",
    "beforeDocumentHash",
    "beforeRevision",
    "afterDocumentHash",
    "afterRevision",
    "checkpoint",
    "finalization",
    "status",
    "createdAt",
    "updatedAt",
    "error",
  ], "Proposal recovery operation");
  if (value.kind !== "apply" && value.kind !== "undo") {
    throw new Error("Proposal recovery kind is invalid");
  }
  if (value.status !== "pending" && value.status !== "conflict") {
    throw new Error("Proposal recovery status is invalid");
  }
  const beforeRevision = revision(
    value.beforeRevision,
    "Proposal recovery before revision",
  );
  const afterRevision = revision(
    value.afterRevision,
    "Proposal recovery after revision",
  );
  const beforeDocumentHash = hash(
    value.beforeDocumentHash,
    "Proposal recovery before document hash",
  );
  const afterDocumentHash = hash(
    value.afterDocumentHash,
    "Proposal recovery after document hash",
  );
  const checkpoint = validateAgentApplyCheckpoint(value.checkpoint);
  const checkpointJson = JSON.stringify(checkpoint);
  const checkpointLower = checkpointJson.toLowerCase();
  if (
    new TextEncoder().encode(checkpointJson).byteLength >
      MAX_CHECKPOINT_JSON_BYTES ||
    checkpointLower.includes("data:image") ||
    checkpointLower.includes("data:audio") ||
    checkpointLower.includes("data:video") ||
    /[a-z]:\\\\/i.test(checkpointJson) ||
    checkpointJson.includes("\\\\\\\\")
  ) {
    throw new Error(
      "Proposal recovery checkpoint contains a path, raw media, or exceeds its bound",
    );
  }
  const proposalId = identifier(value.proposalId, "Proposal ID");
  const sessionId = identifier(value.sessionId, "Session ID");
  const projectId = identifier(value.projectId, "Project ID");
  if (
    checkpoint.proposalId !== proposalId ||
    checkpoint.sessionId !== sessionId ||
    checkpoint.projectId !== projectId
  ) {
    throw new Error("Proposal recovery checkpoint identity does not match");
  }
  if (
    value.kind === "apply" &&
    (
      checkpoint.beforeRevision !== beforeRevision ||
      checkpoint.beforeDocumentHash !== beforeDocumentHash ||
      checkpoint.appliedRevision !== afterRevision ||
      checkpoint.appliedDocumentHash !== afterDocumentHash
    )
  ) {
    throw new Error("Apply recovery checkpoint does not match the journal");
  }
  const error = value.error;
  if (
    error !== undefined &&
    (
      typeof error !== "string" ||
      error.length < 1 ||
      error.length > MAX_ERROR_CHARS
    )
  ) {
    throw new Error("Proposal recovery error is invalid");
  }
  const finalization = validateFinalization(
    value.finalization,
    value.kind,
    afterRevision,
    afterDocumentHash,
  );
  if (
    new TextEncoder().encode(JSON.stringify(finalization)).byteLength >
      MAX_FINALIZATION_JSON_BYTES
  ) {
    throw new Error("Proposal finalization exceeds its bound");
  }
  return {
    operationId: identifier(value.operationId, "Recovery operation ID"),
    kind: value.kind,
    proposalId,
    sessionId,
    projectId,
    beforeDocumentHash,
    beforeRevision,
    afterDocumentHash,
    afterRevision,
    checkpoint,
    finalization,
    status: value.status,
    createdAt: timestamp(value.createdAt, "Recovery created timestamp"),
    updatedAt: timestamp(value.updatedAt, "Recovery updated timestamp"),
    ...(error === undefined ? {} : { error }),
  };
}
