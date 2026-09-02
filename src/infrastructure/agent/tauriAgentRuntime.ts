import { Channel, invoke } from "@tauri-apps/api/core";
import {
  AGENT_ERROR_CODES,
  AgentDomainError,
  type AgentAttachmentTokenResolverPort,
  type AgentErrorDetails,
  type AgentEventBase,
  type AgentNormalizedEvent,
  type AgentRuntimePort,
  type AgentRuntimeSessionConfig,
  type AgentTokenUsage,
  type AgentWorkspaceBridgePort,
  normalizeAgentModelCapabilities,
  normalizeAgentTokenUsage,
} from "../../domain/agent";

type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

interface EventChannel<T> {
  onmessage: ((message: T) => void) | null;
}

interface TauriAgentRuntimeDependencies {
  readonly invokeCommand?: InvokeCommand;
  readonly createChannel?: <T>() => EventChannel<T>;
  readonly makeId?: () => string;
  readonly workspace: AgentWorkspaceBridgePort;
  readonly attachments: AgentAttachmentTokenResolverPort;
}

const EVENT_TYPES = new Set([
  "message_delta",
  "message_completed",
  "reasoning_delta",
  "reasoning_completed",
  "tool_started",
  "tool_progress",
  "tool_completed",
  "permission_requested",
  "permission_resolved",
  "input_requested",
  "input_resolved",
  "usage",
  "context",
  "compaction_started",
  "compaction_completed",
  "session_idle",
  "session_error",
  "task_completed",
]);

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AgentDomainError(
      "session_corrupt",
      "runtime",
      "Malformed native agent response",
    );
  }
  return value as Record<string, unknown>;
}

function requiredString(value: Record<string, unknown>, key: string): string {
  if (typeof value[key] !== "string" || value[key].length === 0) {
    throw new AgentDomainError(
      "session_corrupt",
      "runtime",
      `Native agent response is missing ${key}`,
    );
  }
  return value[key];
}

function optionalString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  return value[key] === undefined
    ? undefined
    : requiredString(value, key);
}

function integer(value: Record<string, unknown>, key: string): number {
  const candidate = value[key];
  if (
    typeof candidate !== "number" ||
    !Number.isSafeInteger(candidate) ||
    candidate < 0
  ) {
    throw new AgentDomainError(
      "session_corrupt",
      "runtime",
      `Native agent response has invalid ${key}`,
    );
  }
  return candidate;
}

function errorDetails(value: unknown): AgentErrorDetails {
  const candidate = record(value);
  const code = requiredString(candidate, "code");
  const phase = requiredString(candidate, "phase");
  if (
    !AGENT_ERROR_CODES.includes(
      code as (typeof AGENT_ERROR_CODES)[number],
    ) ||
    typeof candidate.retryable !== "boolean"
  ) {
    throw new AgentDomainError(
      "session_corrupt",
      "runtime",
      "Native agent error details are invalid",
    );
  }
  return {
    code: code as AgentErrorDetails["code"],
    phase: phase as AgentErrorDetails["phase"],
    message: requiredString(candidate, "message"),
    retryable: candidate.retryable,
    ...(optionalString(candidate, "recovery")
      ? { recovery: optionalString(candidate, "recovery") }
      : {}),
  };
}

function eventBase(value: Record<string, unknown>): AgentEventBase {
  return {
    eventId: requiredString(value, "eventId"),
    sessionId: requiredString(value, "sessionId"),
    sequence: integer(value, "sequence"),
    occurredAt: requiredString(value, "occurredAt"),
  };
}

function normalizedEvent(raw: unknown): AgentNormalizedEvent {
  const value = record(raw);
  const type = requiredString(value, "type");
  if (!EVENT_TYPES.has(type)) {
    throw new AgentDomainError(
      "session_corrupt",
      "runtime",
      `Unsupported native agent event "${type}"`,
    );
  }
  const base = eventBase(value);
  switch (type) {
    case "message_delta":
      return {
        ...base,
        type,
        messageId: requiredString(value, "messageId"),
        role: requiredString(value, "role") as "user" | "assistant",
        delta: requiredString(value, "delta"),
      };
    case "message_completed":
      return {
        ...base,
        type,
        messageId: requiredString(value, "messageId"),
        role: requiredString(value, "role") as "user" | "assistant",
        ...(optionalString(value, "content")
          ? { content: optionalString(value, "content") }
          : {}),
      };
    case "reasoning_delta":
      return {
        ...base,
        type,
        reasoningId: requiredString(value, "reasoningId"),
        delta: requiredString(value, "delta"),
      };
    case "reasoning_completed":
      return {
        ...base,
        type,
        reasoningId: requiredString(value, "reasoningId"),
        ...(optionalString(value, "summary")
          ? { summary: optionalString(value, "summary") }
          : {}),
      };
    case "tool_started":
      return {
        ...base,
        type,
        toolCallId: requiredString(value, "toolCallId"),
        toolName: requiredString(value, "toolName"),
        summary: requiredString(value, "summary"),
      };
    case "tool_progress":
      return {
        ...base,
        type,
        toolCallId: requiredString(value, "toolCallId"),
        progress: requiredString(value, "progress"),
      };
    case "tool_completed":
      return {
        ...base,
        type,
        toolCallId: requiredString(value, "toolCallId"),
        status: requiredString(value, "status") as
          | "succeeded"
          | "failed"
          | "denied",
        output: typeof value.output === "string" ? value.output : "",
      };
    case "permission_requested":
      return {
        ...base,
        type,
        requestId: requiredString(value, "requestId"),
        toolName: requiredString(value, "toolName"),
        summary: requiredString(value, "summary"),
      };
    case "permission_resolved":
      return {
        ...base,
        type,
        requestId: requiredString(value, "requestId"),
        decision: requiredString(value, "decision") as "allowed" | "denied",
      };
    case "input_requested":
      return {
        ...base,
        type,
        requestId: requiredString(value, "requestId"),
        prompt: requiredString(value, "prompt"),
        choices: Array.isArray(value.choices)
          ? value.choices.filter(
            (choice): choice is string => typeof choice === "string",
          )
          : [],
      };
    case "input_resolved":
      return {
        ...base,
        type,
        requestId: requiredString(value, "requestId"),
        status: requiredString(value, "status") as
          | "submitted"
          | "cancelled"
          | "interrupted",
      };
    case "usage":
      return {
        ...base,
        type,
        scope: requiredString(value, "scope") as "turn" | "session",
        usage: normalizeAgentTokenUsage(value.usage),
      };
    case "context":
      return {
        ...base,
        type,
        usedTokens: integer(value, "usedTokens"),
        limitTokens: value.limitTokens === null
          ? null
          : integer(value, "limitTokens"),
      };
    case "compaction_started":
      return { ...base, type };
    case "compaction_completed":
      return {
        ...base,
        type,
        compactedTokens: value.compactedTokens === null
          ? null
          : integer(value, "compactedTokens"),
      };
    case "session_idle":
      return { ...base, type };
    case "session_error":
      return { ...base, type, error: errorDetails(value.error) };
    default:
      return {
        ...base,
        type: "task_completed",
        finishReason: requiredString(value, "finishReason") as
          | "stop"
          | "length"
          | "cancelled"
          | "error",
      };
  }
}

function assertClosedRuntimeConfig(config: AgentRuntimeSessionConfig): void {
  if (
    config.continuePendingWork !== false ||
    config.toolPolicy.permissionMode !== "request" ||
    config.toolPolicy.allowedTools.join(",") !==
      "get_project_summary,read_text_blocks,list_reference_images,propose_text_block_edits"
  ) {
    throw new AgentDomainError(
      "tool_denied",
      "runtime",
      "The agent runtime configuration is not closed to Preshot tools",
    );
  }
}

function nativeConfig(config: AgentRuntimeSessionConfig) {
  assertClosedRuntimeConfig(config);
  return {
    projectId: config.projectId,
    projectPath: config.projectPath,
    modelId: config.modelId,
    settings: config.settings,
    capabilities: config.capabilities,
  };
}

function responseSessionId(value: unknown): string {
  return requiredString(record(value), "sessionId");
}

function attachmentFailure(error: unknown): unknown {
  if (error instanceof AgentDomainError) return error;
  const candidate = typeof error === "object" && error !== null
    ? error as Record<string, unknown>
    : {};
  const code = typeof candidate.code === "string" ? candidate.code : "";
  if (!code.startsWith("attachment_")) return error;
  return new AgentDomainError(
    "attachment_unavailable",
    "workspace",
    typeof candidate.message === "string"
      ? candidate.message
      : "The selected image is unavailable",
    { retryable: true, cause: error },
  );
}

export function createTauriAgentRuntime({
  invokeCommand = invoke,
  createChannel = <T>() => new Channel<T>(),
  makeId = () => crypto.randomUUID(),
  workspace,
  attachments,
}: TauriAgentRuntimeDependencies): AgentRuntimePort {
  return {
    async listModels(settings) {
      const result = await invokeCommand("agent_list_models", { settings });
      if (!Array.isArray(result)) throw new Error("Malformed model list");
      return result.map((model) => {
        const value = record(model);
        return {
          id: requiredString(value, "id"),
          displayName: requiredString(value, "displayName"),
        };
      });
    },
    async testConnection(settings, modelId) {
      const value = record(await invokeCommand("agent_probe_model", {
        settings,
        modelId,
        verifyVision: true,
      }));
      return {
        modelId: requiredString(value, "modelId"),
        capabilities: normalizeAgentModelCapabilities(value.capabilities),
        usage: value.usage === null
          ? null
          : normalizeAgentTokenUsage(value.usage),
      };
    },
    async createSession(config) {
      return {
        sessionId: responseSessionId(
          await invokeCommand("agent_create_session", {
            request: nativeConfig(config),
          }),
        ),
      };
    },
    async resumeSession(sessionId, config) {
      await invokeCommand("agent_resume_session", {
        request: { sessionId, ...nativeConfig(config) },
      });
    },
    async deleteSession(sessionId) {
      await invokeCommand("agent_delete_session", { sessionId });
    },
    async disconnect(sessionId) {
      await invokeCommand("agent_disconnect_session", { sessionId });
    },
    async send(request) {
      const requestId = makeId();
      const snapshot = workspace.captureSnapshot();
      if (
        snapshot.projectId !== request.context.projectId ||
        snapshot.documentRevision !== request.context.documentRevision ||
        snapshot.documentHash !== request.context.documentHash
      ) {
        throw new AgentDomainError(
          "proposal_stale",
          "workspace",
          "The disclosed request context is stale",
        );
      }
      const blockIds = [
        ...request.context.selectedBlockIds,
        ...(request.context.cursorBlockId &&
            !request.context.selectedBlockIds.includes(
              request.context.cursorBlockId,
            )
          ? [request.context.cursorBlockId]
          : []),
      ];
      const textBlocks = workspace.readTextBlocks(snapshot, blockIds);
      let attachmentToken: string | null = null;
      try {
        const resolvedAttachment = request.attachment
          ? await (async () => {
            attachmentToken = workspace.issueAttachment(
              request.attachment!,
              request.context.projectId,
              request.context.documentRevision,
            );
            return attachments.resolveAttachment({
              token: attachmentToken,
              expectedProjectId: request.context.projectId,
              expectedDocumentRevision: request.context.documentRevision,
            });
          })()
          : null;
        await invokeCommand("agent_register_request_context", {
          input: {
            sessionId: request.sessionId,
            requestId,
            contextId: requestId,
            receipt: request.context,
            textBlocks,
            ...(resolvedAttachment && attachmentToken
              ? {
                attachment: {
                  token: attachmentToken,
                  groupId: resolvedAttachment.groupId,
                  imageId: resolvedAttachment.imageId,
                  absolutePath: resolvedAttachment.absolutePath,
                },
              }
              : {}),
          },
        });
        await invokeCommand("agent_send", {
          request: {
            sessionId: request.sessionId,
            requestId,
            text:
              `[Preshot disclosedContextId: ${requestId}]\n${request.text}`,
            attachmentToken,
          },
        });
      } catch (error) {
        throw attachmentFailure(error);
      } finally {
        if (attachmentToken) {
          attachments.revokeAttachment(attachmentToken);
        }
      }
    },
    async abort(sessionId) {
      await invokeCommand("agent_abort", { sessionId });
    },
    async getEvents(sessionId) {
      const events = await invokeCommand("agent_get_events", { sessionId });
      if (!Array.isArray(events)) throw new Error("Malformed event replay");
      return events.map(normalizedEvent);
    },
    async subscribe(sessionId, listener) {
      const channel = createChannel<unknown>();
      channel.onmessage = (message) => listener(normalizedEvent(message));
      const subscriptionId = requiredString(record(
        {
          subscriptionId: await invokeCommand("agent_subscribe_events", {
            sessionId,
            channel,
          }),
        },
      ), "subscriptionId");
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        channel.onmessage = null;
        void invokeCommand("agent_unsubscribe_events", { subscriptionId });
      };
    },
    async resolvePermission(sessionId, requestId, decision) {
      await invokeCommand("agent_resolve_permission", {
        sessionId,
        requestId,
        decision,
      });
    },
    async resolveInput(sessionId, requestId, value) {
      await invokeCommand("agent_resolve_input", {
        sessionId,
        requestId,
        value,
      });
    },
  };
}

export type { AgentTokenUsage };
