export const AGENT_ERROR_CODES = [
  "model_not_configured",
  "proxy_unreachable",
  "invalid_model_list",
  "model_unavailable",
  "cli_start_failed",
  "cli_crashed",
  "session_create_failed",
  "session_resume_failed",
  "session_corrupt",
  "authentication_failed",
  "rate_limited",
  "context_too_large",
  "attachment_unavailable",
  "timeout",
  "cancelled",
  "refused",
  "safety_blocked",
  "tool_denied",
  "tool_failed",
  "proposal_invalid",
  "proposal_stale",
  "proposal_apply_conflict",
  "store_failed",
  "project_deleted",
] as const;

export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

export type AgentErrorPhase =
  | "settings"
  | "connection"
  | "runtime"
  | "session"
  | "generation"
  | "tool"
  | "proposal"
  | "apply"
  | "undo"
  | "store"
  | "workspace";

const RETRYABLE_CODES = new Set<AgentErrorCode>([
  "proxy_unreachable",
  "cli_start_failed",
  "cli_crashed",
  "rate_limited",
  "timeout",
  "store_failed",
  "attachment_unavailable",
]);

export interface AgentErrorDetails {
  readonly code: AgentErrorCode;
  readonly phase: AgentErrorPhase;
  readonly message: string;
  readonly retryable: boolean;
  readonly recovery?: string;
}

export class AgentDomainError extends Error {
  readonly code: AgentErrorCode;
  readonly phase: AgentErrorPhase;
  readonly retryable: boolean;
  readonly recovery?: string;

  constructor(
    code: AgentErrorCode,
    phase: AgentErrorPhase,
    message: string,
    options: {
      readonly retryable?: boolean;
      readonly recovery?: string;
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : {
      cause: options.cause,
    });
    this.name = "AgentDomainError";
    this.code = code;
    this.phase = phase;
    this.retryable = options.retryable ?? RETRYABLE_CODES.has(code);
    this.recovery = options.recovery;
  }

  toDetails(): AgentErrorDetails {
    return {
      code: this.code,
      phase: this.phase,
      message: this.message,
      retryable: this.retryable,
      ...(this.recovery ? { recovery: this.recovery } : {}),
    };
  }
}

export function isAgentDomainError(error: unknown): error is AgentDomainError {
  return error instanceof AgentDomainError;
}

export const AGENT_PROPOSAL_TEMPORARY_ERROR_CODES = [
  "PLAN_BRIDGE_NOT_READY",
  "PLAN_LOADING",
] as const;

export type AgentProposalTemporaryErrorCode =
  (typeof AGENT_PROPOSAL_TEMPORARY_ERROR_CODES)[number];

export class AgentProposalTemporaryError extends Error {
  readonly code: AgentProposalTemporaryErrorCode;

  constructor(code: AgentProposalTemporaryErrorCode, message: string) {
    super(message);
    this.name = "AgentProposalTemporaryError";
    this.code = code;
  }
}

export function isAgentProposalTemporaryError(
  error: unknown,
): error is AgentProposalTemporaryError {
  return error instanceof AgentProposalTemporaryError;
}

export function agentErrorDetails(
  error: unknown,
  fallback: {
    readonly code: AgentErrorCode;
    readonly phase: AgentErrorPhase;
    readonly retryable?: boolean;
    readonly recovery?: string;
  },
): AgentErrorDetails {
  if (isAgentDomainError(error)) return error.toDetails();
  return {
    code: fallback.code,
    phase: fallback.phase,
    message: error instanceof Error ? error.message : String(error),
    retryable: fallback.retryable ?? RETRYABLE_CODES.has(fallback.code),
    ...(fallback.recovery ? { recovery: fallback.recovery } : {}),
  };
}
