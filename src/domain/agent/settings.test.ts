import { describe, expect, it } from "vitest";
import {
  canSendWithAgent,
  agentCapabilityCacheKey,
  DEFAULT_AGENT_MODEL_CAPABILITIES,
  defaultPersistedAgentModelSettings,
  deriveAgentApiBaseUrl,
  normalizeAgentModelCapabilities,
  normalizeAgentModelSettings,
  normalizePersistedAgentModelSettings,
  normalizeAgentUrl,
} from "./settings";

function settings(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    providerType: "openai",
    displayUrl: "http://localhost:4141/",
    apiBaseUrl: "http://localhost:4141/v1/",
    modelId: "gpt-test",
    wireApi: "responses",
    reasoningEffort: "medium",
    reasoningSummary: "concise",
    ...overrides,
  };
}

describe("agent settings and provider URLs", () => {
  it("normalizes loopback HTTP and remote HTTPS URLs", () => {
    expect(normalizeAgentUrl("http://localhost:4141/", "url"))
      .toBe("http://localhost:4141");
    expect(normalizeAgentUrl("http://127.22.3.4:8080/proxy/", "url"))
      .toBe("http://127.22.3.4:8080/proxy");
    expect(normalizeAgentUrl("http://[::1]:4141/", "url"))
      .toBe("http://[::1]:4141");
    expect(normalizeAgentUrl("https://models.example.com/openai/", "url"))
      .toBe("https://models.example.com/openai");
  });

  it("rejects remote HTTP, credentials, queries, fragments, paths, and schemes", () => {
    for (const value of [
      "http://models.example.com/v1",
      "https://user:secret@models.example.com/v1",
      "https://models.example.com/v1?key=value",
      "https://models.example.com/v1#fragment",
      "file:///C:/models",
      "C:\\models",
      "\\\\server\\models",
    ]) {
      expect(() => normalizeAgentUrl(value, "url")).toThrow();
    }
  });

  it("derives an API root exactly once", () => {
    expect(deriveAgentApiBaseUrl("http://localhost:4141"))
      .toBe("http://localhost:4141/v1");
    expect(deriveAgentApiBaseUrl("https://example.com/openai/v1/"))
      .toBe("https://example.com/openai/v1");
  });

  it("strictly normalizes settings and requires a matching v1 API origin", () => {
    expect(normalizeAgentModelSettings(settings())).toEqual({
      ...settings(),
      displayUrl: "http://localhost:4141",
      apiBaseUrl: "http://localhost:4141/v1",
    });
    expect(() => normalizeAgentModelSettings(settings({
      apiBaseUrl: "https://other.example.com/v1",
    }))).toThrow(/same origin/i);
    expect(() => normalizeAgentModelSettings(settings({
      apiBaseUrl: "http://localhost:4141/openai",
    }))).toThrow(/end in \/v1/i);
    expect(() => normalizeAgentModelSettings(settings({
      apiKey: "must-not-persist",
    }))).toThrow(/unsupported field/i);
    expect(() => normalizeAgentModelSettings(settings({
      reasoningEffort: "extreme",
    }))).toThrow(/reasoningEffort/i);
    expect(() => normalizeAgentModelSettings(settings({
      modelId: " model ",
    }))).toThrow(/modelId/i);
  });

  it("normalizes explicit capability evidence and gates Send", () => {
    const capabilities = normalizeAgentModelCapabilities({
      responsesApi: "verified",
      streaming: "verified",
      customTools: "verified",
      imageInput: "unknown",
      reasoningSummary: true,
      reasoningEffort: false,
      contextWindowTokens: 128_000,
    });
    expect(canSendWithAgent(normalizeAgentModelSettings(settings()), capabilities))
      .toBe(true);
    expect(canSendWithAgent(
      normalizeAgentModelSettings(settings()),
      DEFAULT_AGENT_MODEL_CAPABILITIES,
    )).toBe(false);
    expect(() => normalizeAgentModelCapabilities({
      ...capabilities,
      contextWindowTokens: 0,
    })).toThrow(/positive integer/i);
    expect(() => normalizeAgentModelCapabilities({
      ...capabilities,
      visionConfidence: 0.5,
    })).toThrow(/unsupported field/i);
  });

  it("strictly migrates persisted settings and rejects secret fields", () => {
    expect(defaultPersistedAgentModelSettings()).toMatchObject({
      settings: {
        enabled: false,
        displayUrl: "http://localhost:4141",
        apiBaseUrl: "http://localhost:4141/v1",
        modelId: null,
      },
      capabilityCache: null,
    });
    expect(() => normalizePersistedAgentModelSettings({
      settings: settings({ apiKey: "must-never-be-stored" }),
      capabilityCache: null,
    })).toThrow(/unsupported field/i);

    const normalized = normalizeAgentModelSettings(settings());
    const capabilities = normalizeAgentModelCapabilities({
      responsesApi: "verified",
      streaming: "verified",
      customTools: "verified",
      imageInput: "unknown",
      reasoningSummary: true,
      reasoningEffort: false,
      contextWindowTokens: null,
    });
    expect(normalizePersistedAgentModelSettings({
      settings: normalized,
      capabilityCache: {
        probeVersion: 1,
        proxyKey: agentCapabilityCacheKey(normalized, "gpt-test"),
        modelId: "gpt-test",
        capabilities,
        usage: null,
        testedAt: "2026-08-22T01:00:00.000Z",
      },
    }).capabilityCache?.modelId).toBe("gpt-test");

    expect(normalizePersistedAgentModelSettings({
      settings: normalized,
      capabilityCache: {
        probeVersion: 999,
        proxyKey: "old-probe-key",
        modelId: "gpt-test",
        capabilities,
        usage: null,
        testedAt: "2026-08-22T01:00:00.000Z",
      },
    })).toEqual({
      settings: { ...normalized, enabled: false },
      capabilityCache: null,
    });
  });
});
