import type {
  AgentErrorCode,
  AgentModelCapabilities,
  AgentNormalizedEvent,
} from "../../src/domain/agent";
import { EMPTY_AGENT_TOKEN_USAGE } from "../../src/domain/agent";

const base = (sequence: number) => ({
  eventId: `eval-event-${sequence}`,
  sessionId: "eval-session",
  sequence,
  occurredAt: `2026-08-22T00:00:${String(sequence).padStart(2, "0")}Z`,
});

export const AGENT_EVAL_DATE = "2026-08-22";

export const AGENT_EVENT_FIXTURES = [
  {
    ...base(1),
    type: "message_delta",
    messageId: "message-1",
    role: "assistant",
    delta: "Draft",
  },
  {
    ...base(2),
    type: "message_completed",
    messageId: "message-1",
    role: "assistant",
    content: "Complete",
  },
  {
    ...base(3),
    type: "reasoning_delta",
    reasoningId: "reasoning-1",
    delta: "Summary",
  },
  {
    ...base(4),
    type: "reasoning_completed",
    reasoningId: "reasoning-1",
    summary: "Summary complete",
  },
  {
    ...base(5),
    type: "tool_started",
    toolCallId: "tool-1",
    toolName: "read_text_blocks",
    summary: "Read disclosed blocks",
  },
  {
    ...base(6),
    type: "tool_progress",
    toolCallId: "tool-1",
    progress: "Reading",
  },
  {
    ...base(7),
    type: "tool_completed",
    toolCallId: "tool-1",
    status: "succeeded",
    output: "Done",
  },
  {
    ...base(8),
    type: "permission_requested",
    requestId: "permission-1",
    toolName: "read_text_blocks",
    summary: "Allow disclosed context read",
  },
  {
    ...base(9),
    type: "permission_resolved",
    requestId: "permission-1",
    decision: "allowed",
  },
  {
    ...base(10),
    type: "input_requested",
    requestId: "input-1",
    prompt: "Choose",
    choices: ["A", "B"],
  },
  {
    ...base(11),
    type: "input_resolved",
    requestId: "input-1",
    status: "submitted",
  },
  {
    ...base(12),
    type: "usage",
    scope: "turn",
    usage: { ...EMPTY_AGENT_TOKEN_USAGE, inputTokens: 10, requestCount: 1 },
  },
  {
    ...base(13),
    type: "context",
    usedTokens: 500,
    limitTokens: 1_000,
  },
  { ...base(14), type: "compaction_started" },
  { ...base(15), type: "compaction_completed", compactedTokens: 200 },
  { ...base(16), type: "session_idle" },
  {
    ...base(17),
    type: "session_error",
    error: {
      code: "rate_limited",
      phase: "generation",
      message: "Bounded fixture error",
      retryable: true,
    },
  },
  { ...base(18), type: "task_completed", finishReason: "stop" },
] satisfies readonly AgentNormalizedEvent[];

export const AGENT_ERROR_FIXTURES = [
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
] as const satisfies readonly AgentErrorCode[];

const verifiedText: AgentModelCapabilities = {
  responsesApi: "verified",
  streaming: "verified",
  customTools: "verified",
  imageInput: "unknown",
  reasoningSummary: false,
  reasoningEffort: false,
  contextWindowTokens: null,
};

export const AGENT_CAPABILITY_FIXTURES = [
  { id: "verified-text", expectedReady: true, capabilities: verifiedText },
  {
    id: "responses-unknown",
    expectedReady: false,
    capabilities: { ...verifiedText, responsesApi: "unknown" },
  },
  {
    id: "streaming-unsupported",
    expectedReady: false,
    capabilities: { ...verifiedText, streaming: "unsupported" },
  },
  {
    id: "tools-unknown",
    expectedReady: false,
    capabilities: { ...verifiedText, customTools: "unknown" },
  },
  {
    id: "vision-verified-separate",
    expectedReady: true,
    capabilities: { ...verifiedText, imageInput: "verified" },
  },
] as const satisfies readonly {
  readonly id: string;
  readonly expectedReady: boolean;
  readonly capabilities: AgentModelCapabilities;
}[];

export const ADVERSARIAL_PROPOSAL_DRAFTS = [
  {
    id: "model-supplied-block-id",
    block: { type: "paragraph", text: "Text", id: "model-id" },
  },
  {
    id: "shell-field",
    block: { type: "paragraph", text: "Text", shell: "powershell -Command whoami" },
  },
  {
    id: "network-field",
    block: { type: "paragraph", text: "Text", url: "https://example.invalid" },
  },
  {
    id: "absolute-path-field",
    block: { type: "paragraph", text: "Text", path: "C:\\Users\\secret.txt" },
  },
  {
    id: "traversal-field",
    block: { type: "paragraph", text: "Text", path: "..\\..\\secret.txt" },
  },
  {
    id: "media-type",
    block: { type: "image", text: "Text" },
  },
  {
    id: "schema-field",
    block: { type: "paragraph", text: "Text", schemaVersion: 14 },
  },
  {
    id: "image-group-property",
    block: { type: "paragraph", text: "Text", props: { groupId: "group-1" } },
  },
] as const;

export const ALLOWED_TEXT_BLOCK_GOLDEN = [
  { type: "paragraph", text: "Paragraph" },
  { type: "heading", text: "Heading", props: { level: 2 } },
  { type: "bulletListItem", text: "Bullet" },
  { type: "numberedListItem", text: "Numbered" },
  { type: "checkListItem", text: "Check", props: { checked: true } },
  {
    type: "toggleListItem",
    text: "Toggle",
    children: [{ type: "quote", text: "Nested quote" }],
  },
  { type: "quote", text: "Quote" },
  { type: "codeBlock", text: "const safe = true;", props: { language: "ts" } },
] as const;
