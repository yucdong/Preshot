import { describe, expect, it } from "vitest";
import {
  createAgentDraft,
  reduceAgentProjectSwitch,
  transitionAgentSession,
} from "./sessionService";

describe("agent session and project-switch state", () => {
  it("accepts lifecycle transitions and rejects impossible transitions", () => {
    expect(transitionAgentSession("creating", "idle")).toBe("idle");
    expect(transitionAgentSession("idle", "running")).toBe("running");
    expect(transitionAgentSession("running", "waiting_permission"))
      .toBe("waiting_permission");
    expect(transitionAgentSession("waiting_permission", "stopping"))
      .toBe("stopping");
    expect(transitionAgentSession("stopping", "idle")).toBe("idle");
    expect(() => transitionAgentSession("idle", "waiting_permission"))
      .toThrow(/invalid agent session transition/i);
    expect(() => transitionAgentSession("deleting", "idle")).toThrow();
  });

  it("switches immediately while idle", () => {
    expect(reduceAgentProjectSwitch(
      { status: "none" },
      { type: "request", targetProjectId: "project-2", sessionState: "idle" },
    )).toEqual({
      state: { status: "none" },
      effect: { type: "switch_project", targetProjectId: "project-2" },
    });
  });

  it("queues Wait, supports cancelling it, and switches after errors settle", () => {
    const choosing = reduceAgentProjectSwitch(
      { status: "none" },
      {
        type: "request",
        targetProjectId: "project-2",
        sessionState: "running",
      },
    );
    expect(choosing.effect.type).toBe("show_choices");
    const waiting = reduceAgentProjectSwitch(
      choosing.state,
      { type: "choose", choice: "wait" },
    );
    expect(waiting).toEqual({
      state: { status: "waiting", targetProjectId: "project-2" },
      effect: { type: "none" },
    });
    expect(reduceAgentProjectSwitch(
      waiting.state,
      { type: "cancel_wait" },
    ).state).toEqual({ status: "none" });
    expect(reduceAgentProjectSwitch(
      waiting.state,
      { type: "turn_settled" },
    )).toEqual({
      state: { status: "none" },
      effect: { type: "switch_project", targetProjectId: "project-2" },
    });
  });

  it("aborts for Stop and switch, then switches on idle or timeout", () => {
    const choosing = {
      status: "choosing" as const,
      targetProjectId: "project-2",
    };
    const stopping = reduceAgentProjectSwitch(
      choosing,
      { type: "choose", choice: "stop" },
    );
    expect(stopping.effect).toEqual({
      type: "abort_turn",
      targetProjectId: "project-2",
    });
    expect(reduceAgentProjectSwitch(
      stopping.state,
      { type: "stop_timeout" },
    ).effect).toEqual({
      type: "switch_project",
      targetProjectId: "project-2",
    });
    expect(reduceAgentProjectSwitch(
      choosing,
      { type: "choose", choice: "cancel" },
    )).toEqual({
      state: { status: "none" },
      effect: { type: "none" },
    });
  });

  it("creates bounded immutable per-session drafts", () => {
    const draft = createAgentDraft("session-1", "Draft", "2026-08-22T00:00:00Z");
    expect(draft).toEqual({
      sessionId: "session-1",
      text: "Draft",
      updatedAt: "2026-08-22T00:00:00Z",
    });
    expect(Object.isFrozen(draft)).toBe(true);
    expect(() => createAgentDraft("session-1", "x".repeat(20_001), "now"))
      .toThrow(/exceeds/i);
  });
});
