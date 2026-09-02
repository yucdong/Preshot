import { describe, expect, it } from "vitest";
import {
  createAgentEventState,
  type AgentEventBase,
  type AgentNormalizedEvent,
  reduceAgentEvent,
} from "./eventReducer";
import { EMPTY_AGENT_TOKEN_USAGE } from "./usage";

function base(sequence: number): AgentEventBase {
  return {
    eventId: `event-${sequence}`,
    sessionId: "session-1",
    sequence,
    occurredAt: `2026-08-22T00:00:${String(sequence).padStart(2, "0")}Z`,
  };
}

function reduce(events: readonly AgentNormalizedEvent[]) {
  return events.reduce(
    (state, event) => reduceAgentEvent(state, event),
    createAgentEventState("session-1"),
  );
}

describe("bounded normalized agent event reducer", () => {
  it("orders out-of-order deltas and deduplicates replayed event IDs", () => {
    const second: AgentNormalizedEvent = {
      ...base(2),
      type: "message_delta",
      messageId: "message-1",
      role: "assistant",
      delta: "B",
    };
    const first: AgentNormalizedEvent = {
      ...base(1),
      type: "message_delta",
      messageId: "message-1",
      role: "assistant",
      delta: "A",
    };
    let state = reduce([second, first]);
    expect(state.messages).toEqual([{
      messageId: "message-1",
      role: "assistant",
      content: "AB",
      completed: false,
    }]);
    state = reduceAgentEvent(state, first);
    expect(state.messages[0].content).toBe("AB");
    expect(state.events).toHaveLength(2);
  });

  it("maps the complete event surface into typed state", () => {
    const events: AgentNormalizedEvent[] = [
      {
        ...base(1),
        type: "reasoning_delta",
        reasoningId: "reasoning-1",
        delta: "Summary",
      },
      {
        ...base(2),
        type: "reasoning_completed",
        reasoningId: "reasoning-1",
      },
      {
        ...base(3),
        type: "tool_started",
        toolCallId: "tool-1",
        toolName: "read_text_blocks",
        summary: "Read selected blocks",
      },
      {
        ...base(4),
        type: "tool_progress",
        toolCallId: "tool-1",
        progress: "Reading",
      },
      {
        ...base(5),
        type: "tool_completed",
        toolCallId: "tool-1",
        status: "succeeded",
        output: "Done",
      },
      {
        ...base(6),
        type: "permission_requested",
        requestId: "permission-1",
        toolName: "read_text_blocks",
        summary: "Read",
      },
      {
        ...base(7),
        type: "permission_resolved",
        requestId: "permission-1",
        decision: "allowed",
      },
      {
        ...base(8),
        type: "input_requested",
        requestId: "input-1",
        prompt: "Choose",
        choices: ["A", "B"],
      },
      {
        ...base(9),
        type: "input_resolved",
        requestId: "input-1",
        status: "submitted",
      },
      {
        ...base(10),
        type: "usage",
        scope: "turn",
        usage: { ...EMPTY_AGENT_TOKEN_USAGE, inputTokens: 10, requestCount: 1 },
      },
      {
        ...base(11),
        type: "context",
        usedTokens: 500,
        limitTokens: 1_000,
      },
      { ...base(12), type: "compaction_started" },
      { ...base(13), type: "compaction_completed", compactedTokens: 200 },
      {
        ...base(14),
        type: "message_completed",
        messageId: "message-1",
        role: "assistant",
        content: "Complete",
      },
      { ...base(15), type: "task_completed", finishReason: "stop" },
      { ...base(16), type: "session_idle" },
    ];
    const state = reduce(events);
    expect(state.reasoning[0]).toMatchObject({
      summary: "Summary",
      completed: true,
    });
    expect(state.tools[0]).toMatchObject({
      toolName: "read_text_blocks",
      progress: "Reading",
      status: "succeeded",
      output: "Done",
    });
    expect(state.permissions[0].decision).toBe("allowed");
    expect(state.inputs[0].status).toBe("submitted");
    expect(state.turnUsage?.inputTokens).toBe(10);
    expect(state.context).toEqual({ usedTokens: 500, limitTokens: 1_000 });
    expect(state.compaction).toBe("completed");
    expect(state.messages[0]).toMatchObject({
      content: "Complete",
      completed: true,
    });
    expect(state.finishReason).toBe("stop");
    expect(state.idle).toBe(true);
  });

  it("retains typed errors and bounds events, transcript, and tool output", () => {
    let state = createAgentEventState("session-1");
    state = reduceAgentEvent(state, {
      ...base(1),
      type: "session_error",
      error: {
        code: "rate_limited",
        phase: "generation",
        message: "Try later",
        retryable: true,
      },
    }, {
      maxEvents: 2,
      maxSeenEventIds: 3,
      maxTranscriptItems: 1,
      maxTextCharacters: 4,
      maxToolOutputCharacters: 3,
    });
    expect(state.lastError?.code).toBe("rate_limited");
    state = reduceAgentEvent(state, {
      ...base(2),
      type: "tool_completed",
      toolCallId: "tool-1",
      status: "failed",
      output: "abcdef",
    }, {
      maxEvents: 2,
      maxSeenEventIds: 3,
      maxTranscriptItems: 1,
      maxTextCharacters: 4,
      maxToolOutputCharacters: 3,
    });
    state = reduceAgentEvent(state, {
      ...base(3),
      type: "message_completed",
      messageId: "message-1",
      role: "assistant",
      content: "123456",
    }, {
      maxEvents: 2,
      maxSeenEventIds: 3,
      maxTranscriptItems: 1,
      maxTextCharacters: 4,
      maxToolOutputCharacters: 3,
    });
    expect(state.events.map((event) => event.sequence)).toEqual([2, 3]);
    expect(state.tools[0].output).toBe("def");
    expect(state.messages[0].content).toBe("3456");
    expect(state.lastError).toBeNull();
  });

  it("ignores malformed sequence and cross-session events", () => {
    const state = createAgentEventState("session-1");
    expect(reduceAgentEvent(state, {
      ...base(1),
      sessionId: "other",
      type: "session_idle",
    })).toBe(state);
    expect(reduceAgentEvent(state, {
      ...base(-1),
      type: "session_idle",
    })).toBe(state);
  });
});
