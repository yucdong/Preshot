import { AgentDomainError } from "./errors";
import type {
  AgentDraft,
  AgentSessionState,
} from "./models";

export const AGENT_DRAFT_MAX_LENGTH = 20_000;

const SESSION_TRANSITIONS: Readonly<
  Record<AgentSessionState, readonly AgentSessionState[]>
> = {
  creating: ["idle", "error", "deleting"],
  idle: ["running", "disconnected", "deleting", "error"],
  running: [
    "waiting_permission",
    "waiting_user_input",
    "stopping",
    "idle",
    "disconnected",
    "error",
  ],
  waiting_permission: ["running", "stopping", "idle", "disconnected", "error"],
  waiting_user_input: ["running", "stopping", "idle", "disconnected", "error"],
  stopping: ["idle", "disconnected", "error"],
  disconnected: ["creating", "idle", "deleting", "error"],
  error: ["creating", "idle", "disconnected", "deleting"],
  deleting: [],
};

export function transitionAgentSession(
  current: AgentSessionState,
  next: AgentSessionState,
): AgentSessionState {
  if (current === next) return current;
  if (!SESSION_TRANSITIONS[current].includes(next)) {
    throw new AgentDomainError(
      "session_corrupt",
      "session",
      `Invalid agent session transition from ${current} to ${next}`,
      { recovery: "Reconnect or create a new assistant session." },
    );
  }
  return next;
}

export function isAgentTurnActive(state: AgentSessionState): boolean {
  return state === "running" ||
    state === "waiting_permission" ||
    state === "waiting_user_input" ||
    state === "stopping";
}

export type AgentProjectSwitchChoice = "wait" | "stop" | "cancel";

export type AgentProjectSwitchState =
  | { readonly status: "none" }
  | { readonly status: "choosing"; readonly targetProjectId: string }
  | { readonly status: "waiting"; readonly targetProjectId: string }
  | { readonly status: "stopping"; readonly targetProjectId: string };

export type AgentProjectSwitchEffect =
  | { readonly type: "none" }
  | { readonly type: "show_choices"; readonly targetProjectId: string }
  | { readonly type: "abort_turn"; readonly targetProjectId: string }
  | { readonly type: "switch_project"; readonly targetProjectId: string };

export interface AgentProjectSwitchTransition {
  readonly state: AgentProjectSwitchState;
  readonly effect: AgentProjectSwitchEffect;
}

export type AgentProjectSwitchEvent =
  | {
      readonly type: "request";
      readonly targetProjectId: string;
      readonly sessionState: AgentSessionState;
    }
  | { readonly type: "choose"; readonly choice: AgentProjectSwitchChoice }
  | { readonly type: "cancel_wait" }
  | { readonly type: "turn_settled" }
  | { readonly type: "stop_timeout" };

const NO_SWITCH: AgentProjectSwitchState = { status: "none" };
const NO_EFFECT: AgentProjectSwitchEffect = { type: "none" };

export function reduceAgentProjectSwitch(
  state: AgentProjectSwitchState,
  event: AgentProjectSwitchEvent,
): AgentProjectSwitchTransition {
  if (event.type === "request") {
    if (!event.targetProjectId) {
      throw new AgentDomainError(
        "project_deleted",
        "workspace",
        "A target project is required",
      );
    }
    if (!isAgentTurnActive(event.sessionState)) {
      return {
        state: NO_SWITCH,
        effect: {
          type: "switch_project",
          targetProjectId: event.targetProjectId,
        },
      };
    }
    return {
      state: { status: "choosing", targetProjectId: event.targetProjectId },
      effect: {
        type: "show_choices",
        targetProjectId: event.targetProjectId,
      },
    };
  }

  if (event.type === "choose") {
    if (state.status !== "choosing") return { state, effect: NO_EFFECT };
    if (event.choice === "cancel") {
      return { state: NO_SWITCH, effect: NO_EFFECT };
    }
    if (event.choice === "wait") {
      return {
        state: {
          status: "waiting",
          targetProjectId: state.targetProjectId,
        },
        effect: NO_EFFECT,
      };
    }
    return {
      state: {
        status: "stopping",
        targetProjectId: state.targetProjectId,
      },
      effect: {
        type: "abort_turn",
        targetProjectId: state.targetProjectId,
      },
    };
  }

  if (event.type === "cancel_wait") {
    return state.status === "waiting"
      ? { state: NO_SWITCH, effect: NO_EFFECT }
      : { state, effect: NO_EFFECT };
  }

  if (
    (event.type === "turn_settled" || event.type === "stop_timeout") &&
    (state.status === "waiting" || state.status === "stopping")
  ) {
    return {
      state: NO_SWITCH,
      effect: {
        type: "switch_project",
        targetProjectId: state.targetProjectId,
      },
    };
  }

  return { state, effect: NO_EFFECT };
}

export function createAgentDraft(
  sessionId: string,
  text: string,
  updatedAt: string,
): AgentDraft {
  if (!sessionId) {
    throw new AgentDomainError(
      "session_corrupt",
      "session",
      "Draft sessionId is required",
    );
  }
  if (text.length > AGENT_DRAFT_MAX_LENGTH) {
    throw new AgentDomainError(
      "context_too_large",
      "generation",
      `Draft exceeds ${AGENT_DRAFT_MAX_LENGTH} characters`,
    );
  }
  if (!updatedAt) {
    throw new AgentDomainError(
      "store_failed",
      "store",
      "Draft updatedAt is required",
    );
  }
  return Object.freeze({ sessionId, text, updatedAt });
}
