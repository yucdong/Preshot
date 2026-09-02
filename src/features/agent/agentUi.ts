import type { TFunction } from "i18next";
import type {
  AgentCitation,
  AgentErrorCode,
  AgentSessionState,
} from "../../domain/agent";

export function sessionStatusLabel(
  t: TFunction,
  state: AgentSessionState | null,
): string {
  switch (state) {
    case "creating":
      return t("agent.status.creating");
    case "idle":
      return t("agent.status.idle");
    case "running":
      return t("agent.status.running");
    case "waiting_permission":
      return t("agent.status.waitingPermission");
    case "waiting_user_input":
      return t("agent.status.waitingInput");
    case "stopping":
      return t("agent.status.stopping");
    case "disconnected":
      return t("agent.status.disconnected");
    case "error":
      return t("agent.status.error");
    case "deleting":
      return t("agent.status.deleting");
    default:
      return t("agent.status.noSession");
  }
}

export function toolLabel(t: TFunction, toolName: string): string {
  switch (toolName) {
    case "get_project_summary":
      return t("agent.toolProjectSummary");
    case "read_text_blocks":
      return t("agent.toolReadBlocks");
    case "list_reference_images":
      return t("agent.toolListImages");
    case "propose_text_block_edits":
      return t("agent.toolProposeEdits");
    default:
      return t("agent.toolUnknown");
  }
}

export function errorLabel(t: TFunction, code: AgentErrorCode): string {
  switch (code) {
    case "model_not_configured":
      return t("agent.errors.model_not_configured");
    case "proxy_unreachable":
      return t("agent.errors.proxy_unreachable");
    case "invalid_model_list":
      return t("agent.errors.invalid_model_list");
    case "model_unavailable":
      return t("agent.errors.model_unavailable");
    case "cli_start_failed":
      return t("agent.errors.cli_start_failed");
    case "cli_crashed":
      return t("agent.errors.cli_crashed");
    case "session_create_failed":
      return t("agent.errors.session_create_failed");
    case "session_resume_failed":
      return t("agent.errors.session_resume_failed");
    case "session_corrupt":
      return t("agent.errors.session_corrupt");
    case "authentication_failed":
      return t("agent.errors.authentication_failed");
    case "rate_limited":
      return t("agent.errors.rate_limited");
    case "context_too_large":
      return t("agent.errors.context_too_large");
    case "attachment_unavailable":
      return t("agent.errors.attachment_unavailable");
    case "timeout":
      return t("agent.errors.timeout");
    case "cancelled":
      return t("agent.errors.cancelled");
    case "refused":
      return t("agent.errors.refused");
    case "safety_blocked":
      return t("agent.errors.safety_blocked");
    case "tool_denied":
      return t("agent.errors.tool_denied");
    case "tool_failed":
      return t("agent.errors.tool_failed");
    case "proposal_invalid":
      return t("agent.errors.proposal_invalid");
    case "proposal_stale":
      return t("agent.errors.proposal_stale");
    case "proposal_apply_conflict":
      return t("agent.errors.proposal_apply_conflict");
    case "store_failed":
      return t("agent.errors.store_failed");
    case "project_deleted":
      return t("agent.errors.project_deleted");
  }
}

export function formatAgentTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatAgentDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatTokenCount(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

export interface AgentDisplayCitation {
  readonly citation: AgentCitation;
  readonly index: number;
}

export function extractAgentCitations(
  content: string,
  projectId: string,
): Readonly<{
  text: string;
  citations: readonly AgentDisplayCitation[];
}> {
  const citations: AgentDisplayCitation[] = [];
  const text = content.replace(
    /\[\[(block|image):([^\]\r\n]{1,400})\]\]/g,
    (_marker, kind: string, identifier: string) => {
      if (kind === "block") {
        citations.push({
          citation: {
            kind: "block",
            projectId,
            blockId: identifier,
          },
          index: citations.length + 1,
        });
      } else {
        const separator = identifier.indexOf(":");
        if (separator > 0 && separator < identifier.length - 1) {
          citations.push({
            citation: {
              kind: "image",
              projectId,
              groupId: identifier.slice(0, separator),
              imageId: identifier.slice(separator + 1),
            },
            index: citations.length + 1,
          });
        }
      }
      return "";
    },
  );
  return Object.freeze({
    text: text.trim(),
    citations: Object.freeze(citations),
  });
}
