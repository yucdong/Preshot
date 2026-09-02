import { describe, expect, it } from "vitest";
import {
  AgentDomainError,
  agentErrorDetails,
} from "./errors";
import {
  addAgentTokenUsage,
  agentContextUsage,
  agentTokenBudget,
  normalizeAgentTokenUsage,
  normalizeReliableMonetaryCost,
} from "./usage";

describe("agent usage, budget, and error semantics", () => {
  it("normalizes and accumulates non-negative token counters", () => {
    const usage = normalizeAgentTokenUsage({
      inputTokens: 100,
      outputTokens: 20,
      reasoningTokens: 5,
      cacheReadTokens: 10,
      cacheWriteTokens: 2,
      requestCount: 1,
    });
    expect(addAgentTokenUsage(usage, usage)).toEqual({
      inputTokens: 200,
      outputTokens: 40,
      reasoningTokens: 10,
      cacheReadTokens: 20,
      cacheWriteTokens: 4,
      requestCount: 2,
    });
    expect(() => normalizeAgentTokenUsage({
      ...usage,
      outputTokens: -1,
    })).toThrow(/non-negative/i);
    expect(() => normalizeAgentTokenUsage({
      ...usage,
      cost: 1,
    })).toThrow(/unsupported field/i);
  });

  it("omits unknown context percentages and uses 75/90 percent levels", () => {
    expect(agentContextUsage(500, null)).toEqual({
      usedTokens: 500,
      limitTokens: null,
      percentage: null,
      level: "unknown",
    });
    expect(agentContextUsage(749, 1_000).level).toBe("normal");
    expect(agentContextUsage(750, 1_000).level).toBe("warning");
    expect(agentContextUsage(900, 1_000).level).toBe("high");
    expect(agentContextUsage(2_000, 1_000).percentage).toBe(100);
  });

  it("treats budget as a token cap without inventing currency", () => {
    const usage = normalizeAgentTokenUsage({
      inputTokens: 70,
      outputTokens: 20,
      reasoningTokens: 10,
      cacheReadTokens: 500,
      cacheWriteTokens: 500,
      requestCount: 1,
    });
    expect(agentTokenBudget(usage, 100)).toEqual({
      capTokens: 100,
      usedTokens: 100,
      remainingTokens: 0,
      percentage: 100,
      exceeded: true,
    });
    expect(agentTokenBudget(usage, null).percentage).toBeNull();
    expect(normalizeReliableMonetaryCost(null)).toBeNull();
    expect(normalizeReliableMonetaryCost({ amount: 1, currency: "USD" }))
      .toBeNull();
    expect(normalizeReliableMonetaryCost({
      amount: 1.25,
      currency: "USD",
      source: "proxy",
    })).toEqual({
      amount: 1.25,
      currency: "USD",
      source: "proxy",
    });
  });

  it("preserves typed phase, retryability, recovery, and unknown failures", () => {
    const error = new AgentDomainError(
      "rate_limited",
      "generation",
      "Rate limited",
      { recovery: "Retry later" },
    );
    expect(agentErrorDetails(error, {
      code: "tool_failed",
      phase: "tool",
    })).toEqual({
      code: "rate_limited",
      phase: "generation",
      message: "Rate limited",
      retryable: true,
      recovery: "Retry later",
    });
    expect(agentErrorDetails(new Error("Unexpected"), {
      code: "session_resume_failed",
      phase: "session",
      recovery: "Create a new session",
    })).toEqual({
      code: "session_resume_failed",
      phase: "session",
      message: "Unexpected",
      retryable: false,
      recovery: "Create a new session",
    });
  });
});
