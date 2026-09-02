import type { AgentErrorDetails } from "./errors";
import type { AgentTokenUsage } from "./usage";

export interface AgentEventBase {
  readonly eventId: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly occurredAt: string;
}

export type AgentNormalizedEvent =
  | (AgentEventBase & {
      readonly type: "message_delta";
      readonly messageId: string;
      readonly role: "user" | "assistant";
      readonly delta: string;
    })
  | (AgentEventBase & {
      readonly type: "message_completed";
      readonly messageId: string;
      readonly role: "user" | "assistant";
      readonly content?: string;
    })
  | (AgentEventBase & {
      readonly type: "reasoning_delta";
      readonly reasoningId: string;
      readonly delta: string;
    })
  | (AgentEventBase & {
      readonly type: "reasoning_completed";
      readonly reasoningId: string;
      readonly summary?: string;
    })
  | (AgentEventBase & {
      readonly type: "tool_started";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly summary: string;
    })
  | (AgentEventBase & {
      readonly type: "tool_progress";
      readonly toolCallId: string;
      readonly progress: string;
    })
  | (AgentEventBase & {
      readonly type: "tool_completed";
      readonly toolCallId: string;
      readonly status: "succeeded" | "failed" | "denied";
      readonly output: string;
    })
  | (AgentEventBase & {
      readonly type: "permission_requested";
      readonly requestId: string;
      readonly toolName: string;
      readonly summary: string;
    })
  | (AgentEventBase & {
      readonly type: "permission_resolved";
      readonly requestId: string;
      readonly decision: "allowed" | "denied";
    })
  | (AgentEventBase & {
      readonly type: "input_requested";
      readonly requestId: string;
      readonly prompt: string;
      readonly choices: readonly string[];
    })
  | (AgentEventBase & {
      readonly type: "input_resolved";
      readonly requestId: string;
      readonly status: "submitted" | "cancelled" | "interrupted";
    })
  | (AgentEventBase & {
      readonly type: "usage";
      readonly scope: "turn" | "session";
      readonly usage: AgentTokenUsage;
    })
  | (AgentEventBase & {
      readonly type: "context";
      readonly usedTokens: number;
      readonly limitTokens: number | null;
    })
  | (AgentEventBase & {
      readonly type: "compaction_started";
    })
  | (AgentEventBase & {
      readonly type: "compaction_completed";
      readonly compactedTokens: number | null;
    })
  | (AgentEventBase & {
      readonly type: "session_idle";
    })
  | (AgentEventBase & {
      readonly type: "session_error";
      readonly error: AgentErrorDetails;
    })
  | (AgentEventBase & {
      readonly type: "task_completed";
      readonly finishReason: "stop" | "length" | "cancelled" | "error";
    });

export interface AgentMessageState {
  readonly messageId: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly completed: boolean;
}

export interface AgentReasoningState {
  readonly reasoningId: string;
  readonly summary: string;
  readonly completed: boolean;
}

export interface AgentToolState {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly summary: string;
  readonly progress: string;
  readonly status: "running" | "succeeded" | "failed" | "denied";
  readonly output: string;
}

export interface AgentPermissionState {
  readonly requestId: string;
  readonly toolName: string;
  readonly summary: string;
  readonly decision: "pending" | "allowed" | "denied" | "interrupted";
}

export interface AgentInputState {
  readonly requestId: string;
  readonly prompt: string;
  readonly choices: readonly string[];
  readonly status: "pending" | "submitted" | "cancelled" | "interrupted";
}

export interface AgentEventReducerLimits {
  readonly maxEvents: number;
  readonly maxSeenEventIds: number;
  readonly maxTranscriptItems: number;
  readonly maxTextCharacters: number;
  readonly maxToolOutputCharacters: number;
}

export const DEFAULT_AGENT_EVENT_LIMITS: AgentEventReducerLimits = {
  maxEvents: 2_000,
  maxSeenEventIds: 4_000,
  maxTranscriptItems: 500,
  maxTextCharacters: 100_000,
  maxToolOutputCharacters: 16_000,
};

export interface AgentEventState {
  readonly sessionId: string;
  readonly events: readonly AgentNormalizedEvent[];
  readonly seenEventIds: readonly string[];
  readonly messages: readonly AgentMessageState[];
  readonly reasoning: readonly AgentReasoningState[];
  readonly tools: readonly AgentToolState[];
  readonly permissions: readonly AgentPermissionState[];
  readonly inputs: readonly AgentInputState[];
  readonly turnUsage: AgentTokenUsage | null;
  readonly sessionUsage: AgentTokenUsage | null;
  readonly context: Readonly<{
    usedTokens: number;
    limitTokens: number | null;
  }> | null;
  readonly compaction: "idle" | "running" | "completed";
  readonly idle: boolean;
  readonly lastError: AgentErrorDetails | null;
  readonly finishReason: "stop" | "length" | "cancelled" | "error" | null;
}

export function createAgentEventState(sessionId: string): AgentEventState {
  return {
    sessionId,
    events: [],
    seenEventIds: [],
    messages: [],
    reasoning: [],
    tools: [],
    permissions: [],
    inputs: [],
    turnUsage: null,
    sessionUsage: null,
    context: null,
    compaction: "idle",
    idle: true,
    lastError: null,
    finishReason: null,
  };
}

function replaceById<T>(
  items: readonly T[],
  id: string,
  idOf: (item: T) => string,
  create: () => T,
  update: (item: T) => T,
): T[] {
  const index = items.findIndex((item) => idOf(item) === id);
  if (index < 0) return [...items, create()];
  const next = [...items];
  next[index] = update(items[index]);
  return next;
}

function tail<T>(items: readonly T[], limit: number): readonly T[] {
  return items.length <= limit ? items : items.slice(items.length - limit);
}

function appendBounded(current: string, value: string, limit: number): string {
  const combined = current + value;
  return combined.length <= limit ? combined : combined.slice(-limit);
}

function applyOrderedEvent(
  state: AgentEventState,
  event: AgentNormalizedEvent,
  limits: AgentEventReducerLimits,
): AgentEventState {
  if (event.type === "message_delta") {
    return {
      ...state,
      idle: false,
      messages: tail(replaceById(
        state.messages,
        event.messageId,
        (message) => message.messageId,
        () => ({
          messageId: event.messageId,
          role: event.role,
          content: event.delta.slice(-limits.maxTextCharacters),
          completed: false,
        }),
        (message) => ({
          ...message,
          content: appendBounded(
            message.content,
            event.delta,
            limits.maxTextCharacters,
          ),
        }),
      ), limits.maxTranscriptItems),
    };
  }
  if (event.type === "message_completed") {
    return {
      ...state,
      messages: tail(replaceById(
        state.messages,
        event.messageId,
        (message) => message.messageId,
        () => ({
          messageId: event.messageId,
          role: event.role,
          content: (event.content ?? "").slice(-limits.maxTextCharacters),
          completed: true,
        }),
        (message) => ({
          ...message,
          content: event.content === undefined
            ? message.content
            : event.content.slice(-limits.maxTextCharacters),
          completed: true,
        }),
      ), limits.maxTranscriptItems),
    };
  }
  if (event.type === "reasoning_delta") {
    return {
      ...state,
      idle: false,
      reasoning: tail(replaceById(
        state.reasoning,
        event.reasoningId,
        (reasoning) => reasoning.reasoningId,
        () => ({
          reasoningId: event.reasoningId,
          summary: event.delta.slice(-limits.maxTextCharacters),
          completed: false,
        }),
        (reasoning) => ({
          ...reasoning,
          summary: appendBounded(
            reasoning.summary,
            event.delta,
            limits.maxTextCharacters,
          ),
        }),
      ), limits.maxTranscriptItems),
    };
  }
  if (event.type === "reasoning_completed") {
    return {
      ...state,
      reasoning: tail(replaceById(
        state.reasoning,
        event.reasoningId,
        (reasoning) => reasoning.reasoningId,
        () => ({
          reasoningId: event.reasoningId,
          summary: (event.summary ?? "").slice(-limits.maxTextCharacters),
          completed: true,
        }),
        (reasoning) => ({
          ...reasoning,
          summary: event.summary === undefined
            ? reasoning.summary
            : event.summary.slice(-limits.maxTextCharacters),
          completed: true,
        }),
      ), limits.maxTranscriptItems),
    };
  }
  if (event.type === "tool_started") {
    return {
      ...state,
      idle: false,
      tools: tail(replaceById(
        state.tools,
        event.toolCallId,
        (tool) => tool.toolCallId,
        () => ({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          summary: event.summary,
          progress: "",
          status: "running",
          output: "",
        }),
        (tool) => ({ ...tool, status: "running" }),
      ), limits.maxTranscriptItems),
    };
  }
  if (event.type === "tool_progress") {
    return {
      ...state,
      tools: replaceById(
        state.tools,
        event.toolCallId,
        (tool) => tool.toolCallId,
        () => ({
          toolCallId: event.toolCallId,
          toolName: "unknown",
          summary: "",
          progress: event.progress.slice(-limits.maxToolOutputCharacters),
          status: "running",
          output: "",
        }),
        (tool) => ({
          ...tool,
          progress: appendBounded(
            tool.progress,
            event.progress,
            limits.maxToolOutputCharacters,
          ),
        }),
      ),
    };
  }
  if (event.type === "tool_completed") {
    return {
      ...state,
      tools: replaceById(
        state.tools,
        event.toolCallId,
        (tool) => tool.toolCallId,
        () => ({
          toolCallId: event.toolCallId,
          toolName: "unknown",
          summary: "",
          progress: "",
          status: event.status,
          output: event.output.slice(-limits.maxToolOutputCharacters),
        }),
        (tool) => ({
          ...tool,
          status: event.status,
          output: event.output.slice(-limits.maxToolOutputCharacters),
        }),
      ),
    };
  }
  if (event.type === "permission_requested") {
    return {
      ...state,
      idle: false,
      permissions: replaceById(
        state.permissions,
        event.requestId,
        (permission) => permission.requestId,
        () => ({
          requestId: event.requestId,
          toolName: event.toolName,
          summary: event.summary,
          decision: "pending",
        }),
        (permission) => permission,
      ),
    };
  }
  if (event.type === "permission_resolved") {
    return {
      ...state,
      permissions: replaceById(
        state.permissions,
        event.requestId,
        (permission) => permission.requestId,
        () => ({
          requestId: event.requestId,
          toolName: "unknown",
          summary: "",
          decision: event.decision,
        }),
        (permission) => ({ ...permission, decision: event.decision }),
      ),
    };
  }
  if (event.type === "input_requested") {
    return {
      ...state,
      idle: false,
      inputs: replaceById(
        state.inputs,
        event.requestId,
        (input) => input.requestId,
        () => ({
          requestId: event.requestId,
          prompt: event.prompt,
          choices: [...event.choices],
          status: "pending",
        }),
        (input) => input,
      ),
    };
  }
  if (event.type === "input_resolved") {
    return {
      ...state,
      inputs: replaceById(
        state.inputs,
        event.requestId,
        (input) => input.requestId,
        () => ({
          requestId: event.requestId,
          prompt: "",
          choices: [],
          status: event.status,
        }),
        (input) => ({ ...input, status: event.status }),
      ),
    };
  }
  if (event.type === "usage") {
    return {
      ...state,
      [event.scope === "turn" ? "turnUsage" : "sessionUsage"]: event.usage,
    };
  }
  if (event.type === "context") {
    return {
      ...state,
      context: {
        usedTokens: event.usedTokens,
        limitTokens: event.limitTokens,
      },
    };
  }
  if (event.type === "compaction_started") {
    return { ...state, compaction: "running", idle: false };
  }
  if (event.type === "compaction_completed") {
    return { ...state, compaction: "completed" };
  }
  if (event.type === "session_idle") {
    return { ...state, idle: true };
  }
  if (event.type === "session_error") {
    return { ...state, lastError: event.error, idle: true };
  }
  return {
    ...state,
    finishReason: event.finishReason,
    idle: true,
  };
}

function compareEvents(
  left: AgentNormalizedEvent,
  right: AgentNormalizedEvent,
): number {
  return left.sequence - right.sequence ||
    left.eventId.localeCompare(right.eventId);
}

export function reduceAgentEvent(
  state: AgentEventState,
  event: AgentNormalizedEvent,
  limits: AgentEventReducerLimits = DEFAULT_AGENT_EVENT_LIMITS,
): AgentEventState {
  if (
    !event.eventId ||
    event.sessionId !== state.sessionId ||
    !Number.isSafeInteger(event.sequence) ||
    event.sequence < 0
  ) {
    return state;
  }
  if (state.seenEventIds.includes(event.eventId)) return state;

  const events = tail(
    [...state.events, event].sort(compareEvents),
    limits.maxEvents,
  );
  const seenEventIds = tail(
    [...state.seenEventIds, event.eventId],
    limits.maxSeenEventIds,
  );
  let rebuilt = createAgentEventState(state.sessionId);
  for (const orderedEvent of events) {
    rebuilt = applyOrderedEvent(rebuilt, orderedEvent, limits);
  }
  return {
    ...rebuilt,
    events,
    seenEventIds,
  };
}

export function interruptAgentPendingInteractions(
  state: AgentEventState,
): AgentEventState {
  return {
    ...state,
    permissions: state.permissions.map((permission) =>
      permission.decision === "pending"
        ? { ...permission, decision: "interrupted" as const }
        : permission
    ),
    inputs: state.inputs.map((input) =>
      input.status === "pending"
        ? { ...input, status: "interrupted" as const }
        : input
    ),
    idle: true,
  };
}
