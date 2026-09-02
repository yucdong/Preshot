import { AgentDomainError } from "./errors";

export interface AgentTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly requestCount: number;
}

export interface AgentContextUsage {
  readonly usedTokens: number;
  readonly limitTokens: number | null;
  readonly percentage: number | null;
  readonly level: "unknown" | "normal" | "warning" | "high";
}

export interface AgentTokenBudget {
  readonly capTokens: number | null;
  readonly usedTokens: number;
  readonly remainingTokens: number | null;
  readonly percentage: number | null;
  readonly exceeded: boolean;
}

export interface AgentMonetaryCost {
  readonly amount: number;
  readonly currency: string;
  readonly source: "proxy" | "configured_price_table";
}

export const EMPTY_AGENT_TOKEN_USAGE: AgentTokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  requestCount: 0,
};

function tokenCount(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new AgentDomainError(
      "session_corrupt",
      "session",
      `${field} must be a non-negative integer`,
    );
  }
  return value;
}

export function normalizeAgentTokenUsage(raw: unknown): AgentTokenUsage {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new AgentDomainError(
      "session_corrupt",
      "session",
      "Agent token usage must be an object",
    );
  }
  const value = raw as Record<string, unknown>;
  const fields = [
    "inputTokens",
    "outputTokens",
    "reasoningTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "requestCount",
  ] as const;
  const extra = Object.keys(value).find(
    (key) => !(fields as readonly string[]).includes(key),
  );
  if (extra) {
    throw new AgentDomainError(
      "session_corrupt",
      "session",
      `Agent token usage contains unsupported field "${extra}"`,
    );
  }
  return {
    inputTokens: tokenCount(value.inputTokens, "inputTokens"),
    outputTokens: tokenCount(value.outputTokens, "outputTokens"),
    reasoningTokens: tokenCount(value.reasoningTokens, "reasoningTokens"),
    cacheReadTokens: tokenCount(value.cacheReadTokens, "cacheReadTokens"),
    cacheWriteTokens: tokenCount(value.cacheWriteTokens, "cacheWriteTokens"),
    requestCount: tokenCount(value.requestCount, "requestCount"),
  };
}

export function addAgentTokenUsage(
  left: AgentTokenUsage,
  right: AgentTokenUsage,
): AgentTokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    requestCount: left.requestCount + right.requestCount,
  };
}

export function agentContextUsage(
  usedTokens: number,
  limitTokens: number | null,
): AgentContextUsage {
  tokenCount(usedTokens, "usedTokens");
  if (limitTokens === null) {
    return {
      usedTokens,
      limitTokens: null,
      percentage: null,
      level: "unknown",
    };
  }
  if (!Number.isSafeInteger(limitTokens) || limitTokens <= 0) {
    throw new AgentDomainError(
      "session_corrupt",
      "session",
      "limitTokens must be a positive integer or null",
    );
  }
  const percentage = Math.min(100, (usedTokens / limitTokens) * 100);
  return {
    usedTokens,
    limitTokens,
    percentage,
    level: percentage >= 90
      ? "high"
      : percentage >= 75
        ? "warning"
        : "normal",
  };
}

export function agentTokenBudget(
  usage: AgentTokenUsage,
  capTokens: number | null,
): AgentTokenBudget {
  const usedTokens = usage.inputTokens +
    usage.outputTokens +
    usage.reasoningTokens;
  if (capTokens === null) {
    return {
      capTokens: null,
      usedTokens,
      remainingTokens: null,
      percentage: null,
      exceeded: false,
    };
  }
  if (!Number.isSafeInteger(capTokens) || capTokens <= 0) {
    throw new AgentDomainError(
      "session_corrupt",
      "settings",
      "Token budget must be a positive integer or null",
    );
  }
  return {
    capTokens,
    usedTokens,
    remainingTokens: Math.max(0, capTokens - usedTokens),
    percentage: Math.min(100, (usedTokens / capTokens) * 100),
    exceeded: usedTokens >= capTokens,
  };
}

export function normalizeReliableMonetaryCost(
  value: unknown,
): AgentMonetaryCost | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.amount !== "number" ||
    !Number.isFinite(record.amount) ||
    record.amount < 0 ||
    typeof record.currency !== "string" ||
    !/^[A-Z]{3}$/.test(record.currency) ||
    (
      record.source !== "proxy" &&
      record.source !== "configured_price_table"
    )
  ) {
    return null;
  }
  return {
    amount: record.amount,
    currency: record.currency,
    source: record.source,
  };
}
