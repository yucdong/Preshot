import {
  createAgentEventState,
  type AgentModelSettings,
  type AgentNormalizedEvent,
  type AgentRuntimePort,
  type AgentRuntimeSessionConfig,
  type AgentSendRequest,
  DEFAULT_AGENT_MODEL_CAPABILITIES,
  EMPTY_AGENT_TOKEN_USAGE,
} from "../../domain/agent";

interface FakeSession {
  readonly config: AgentRuntimeSessionConfig;
  readonly events: AgentNormalizedEvent[];
  readonly listeners: Set<(event: AgentNormalizedEvent) => void>;
  sequence: number;
}

type FakeEventInput = AgentNormalizedEvent extends infer Event
  ? Event extends AgentNormalizedEvent
    ? Omit<Event, "eventId" | "sessionId" | "sequence" | "occurredAt">
    : never
  : never;

export interface FakeAgentRuntimeOptions {
  readonly makeId?: () => string;
  readonly onSend?: (
    request: AgentSendRequest,
    emit: (event: FakeEventInput) => void,
  ) => void | Promise<void>;
}

export class FakeAgentRuntime implements AgentRuntimePort {
  private readonly sessions = new Map<string, FakeSession>();
  private readonly makeId: () => string;
  private readonly onSend: FakeAgentRuntimeOptions["onSend"];
  private activeSessionId: string | null = null;

  constructor(options: FakeAgentRuntimeOptions = {}) {
    let sequence = 0;
    this.makeId = options.makeId ?? (() => `fake-${++sequence}`);
    this.onSend = options.onSend;
  }

  async listModels(_settings: AgentModelSettings) {
    return [{ id: "fake-model", displayName: "Fake model" }];
  }

  async testConnection(_settings: AgentModelSettings, modelId: string) {
    return {
      modelId,
      capabilities: {
        ...DEFAULT_AGENT_MODEL_CAPABILITIES,
        responsesApi: "verified" as const,
        streaming: "verified" as const,
        customTools: "verified" as const,
      },
      usage: EMPTY_AGENT_TOKEN_USAGE,
    };
  }

  async createSession(config: AgentRuntimeSessionConfig) {
    const sessionId = this.makeId();
    this.sessions.set(sessionId, {
      config,
      events: [],
      listeners: new Set(),
      sequence: 0,
    });
    return { sessionId };
  }

  async resumeSession(sessionId: string, config: AgentRuntimeSessionConfig) {
    const current = this.sessions.get(sessionId);
    this.sessions.set(sessionId, {
      config,
      events: current?.events ?? [],
      listeners: current?.listeners ?? new Set(),
      sequence: current?.sequence ?? 0,
    });
  }

  async deleteSession(sessionId: string) {
    this.sessions.delete(sessionId);
    if (this.activeSessionId === sessionId) this.activeSessionId = null;
  }

  async disconnect(sessionId: string) {
    if (!this.sessions.has(sessionId)) return;
    if (this.activeSessionId === sessionId) this.activeSessionId = null;
  }

  async send(request: AgentSendRequest) {
    if (this.activeSessionId) {
      throw new Error("Another fake generation is active");
    }
    const session = this.requiredSession(request.sessionId);
    this.activeSessionId = request.sessionId;
    this.emit(request.sessionId, {
      type: "message_completed",
      messageId: this.makeId(),
      role: "user",
      content: request.text,
    });
    if (this.onSend) {
      await this.onSend(
        request,
        (event) => this.emit(request.sessionId, event),
      );
    } else {
      queueMicrotask(() => {
        this.emit(request.sessionId, {
          type: "message_completed",
          messageId: this.makeId(),
          role: "assistant",
          content: "Deterministic fake response",
        });
        this.emit(request.sessionId, { type: "session_idle" });
      });
    }
    void session;
  }

  async abort(sessionId: string) {
    this.requiredSession(sessionId);
    this.activeSessionId = null;
    this.emit(sessionId, {
      type: "task_completed",
      finishReason: "cancelled",
    });
    this.emit(sessionId, { type: "session_idle" });
  }

  async getEvents(sessionId: string) {
    return [...this.requiredSession(sessionId).events];
  }

  async subscribe(
    sessionId: string,
    listener: (event: AgentNormalizedEvent) => void,
  ) {
    const session = this.requiredSession(sessionId);
    session.listeners.add(listener);
    return () => session.listeners.delete(listener);
  }

  async resolvePermission(
    sessionId: string,
    requestId: string,
    decision: "allowed" | "denied",
  ) {
    this.emit(sessionId, { type: "permission_resolved", requestId, decision });
  }

  async resolveInput(
    sessionId: string,
    requestId: string,
    value: string | null,
  ) {
    this.emit(sessionId, {
      type: "input_resolved",
      requestId,
      status: value === null ? "cancelled" : "submitted",
    });
  }

  emit(
    sessionId: string,
    event: FakeEventInput,
  ): void {
    const session = this.requiredSession(sessionId);
    const normalized = {
      ...event,
      eventId: this.makeId(),
      sessionId,
      sequence: ++session.sequence,
      occurredAt: new Date(0).toISOString(),
    } as AgentNormalizedEvent;
    session.events.push(normalized);
    if (
      normalized.type === "session_idle" ||
      normalized.type === "session_error" ||
      normalized.type === "task_completed"
    ) {
      this.activeSessionId = null;
    }
    session.listeners.forEach((listener) => listener(normalized));
  }

  sessionIds(): readonly string[] {
    return [...this.sessions.keys()];
  }

  private requiredSession(sessionId: string): FakeSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      createAgentEventState(sessionId);
      throw new Error(`Fake session "${sessionId}" was not found`);
    }
    return session;
  }
}
