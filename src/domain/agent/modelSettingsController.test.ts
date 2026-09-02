import { describe, expect, it, vi } from "vitest";
import type {
  AgentModelProbePort,
  AgentModelSettingsStorePort,
} from "./ports";
import { AgentDomainError } from "./errors";
import { AgentModelSettingsController } from "./modelSettingsController";
import {
  AGENT_CAPABILITY_PROBE_VERSION,
  agentCapabilityCacheKey,
  defaultPersistedAgentModelSettings,
  normalizeAgentModelSettings,
  normalizePersistedAgentModelSettings,
  type PersistedAgentModelSettings,
} from "./settings";

function store(initial = defaultPersistedAgentModelSettings()) {
  let persisted = normalizePersistedAgentModelSettings(initial);
  const port: AgentModelSettingsStorePort = {
    load: vi.fn(async () => structuredClone(persisted)),
    save: vi.fn(async (next) => {
      persisted = normalizePersistedAgentModelSettings(next);
    }),
  };
  return { port, read: () => persisted };
}

function probe(): AgentModelProbePort {
  return {
    listModels: vi.fn(async () => [
      { id: "model-a", displayName: "Model A" },
      { id: "model-b", displayName: "Model B" },
    ]),
    probeModel: vi.fn(async (_settings, modelId, options) => ({
      modelId,
      capabilities: {
        responsesApi: "verified" as const,
        streaming: "verified" as const,
        customTools: "verified" as const,
        imageInput: options.verifyVision
          ? "verified" as const
          : "unknown" as const,
        reasoningSummary: true,
        reasoningEffort: true,
        contextWindowTokens: 64_000,
      },
      usage: {
        inputTokens: 8,
        outputTokens: 2,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        requestCount: 1,
      },
    })),
  };
}

describe("AgentModelSettingsController", () => {
  it("discovers a model, verifies the complete text capability gate, and caches it", async () => {
    const persistence = store();
    const runtime = probe();
    const controller = new AgentModelSettingsController({
      store: persistence.port,
      probe: runtime,
      now: () => "2026-08-22T01:02:03.000Z",
    });

    await controller.initialize();
    await controller.testConnection();

    expect(runtime.listModels).toHaveBeenCalledTimes(1);
    expect(runtime.probeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        displayUrl: "http://localhost:4141",
        apiBaseUrl: "http://localhost:4141/v1",
        modelId: "model-a",
        wireApi: "responses",
      }),
      "model-a",
      expect.objectContaining({ verifyVision: false }),
    );
    expect(controller.getSnapshot()).toMatchObject({
      status: "ready",
      canSend: true,
      settings: { enabled: true, modelId: "model-a" },
      capabilities: {
        responsesApi: "verified",
        streaming: "verified",
        customTools: "verified",
        imageInput: "unknown",
      },
    });
    expect(persistence.read().capabilityCache).toMatchObject({
      probeVersion: 1,
      modelId: "model-a",
      testedAt: "2026-08-22T01:02:03.000Z",
    });
    expect(JSON.stringify(persistence.read())).not.toContain("apiKey");

    const reloadedProbe = probe();
    const reloaded = new AgentModelSettingsController({
      store: persistence.port,
      probe: reloadedProbe,
    });
    await reloaded.initialize();
    expect(reloaded.getSnapshot()).toMatchObject({
      status: "ready",
      canSend: true,
      settings: { modelId: "model-a" },
    });
    expect(reloadedProbe.listModels).not.toHaveBeenCalled();
    expect(reloadedProbe.probeModel).not.toHaveBeenCalled();
  });

  it("invalidates capability evidence when proxy or model changes", async () => {
    const persistence = store();
    const controller = new AgentModelSettingsController({
      store: persistence.port,
      probe: probe(),
    });
    await controller.initialize();
    await controller.testConnection();

    controller.editDisplayUrl("http://127.0.0.1:4141/");
    expect(controller.getSnapshot()).toMatchObject({
      status: "requires_retest",
      canSend: false,
      capabilities: null,
    });
    await controller.commitDisplayUrl();
    expect(persistence.read().capabilityCache).toBeNull();
    expect(persistence.read().settings.apiBaseUrl)
      .toBe("http://127.0.0.1:4141/v1");

    await controller.testConnection();
    vi.mocked(persistence.port.save).mockClear();
    await controller.selectModel("model-a");
    expect(persistence.port.save).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      status: "ready",
      canSend: true,
      settings: { modelId: "model-a" },
    });

    await controller.selectModel("model-b");
    expect(controller.getSnapshot()).toMatchObject({
      status: "requires_retest",
      settings: { enabled: false, modelId: "model-b" },
      capabilities: null,
    });
    expect(persistence.read().capabilityCache).toBeNull();
  });

  it("treats exact, whitespace, and trailing-slash blur as the same verified endpoint", async () => {
    const persistence = store();
    const controller = new AgentModelSettingsController({
      store: persistence.port,
      probe: probe(),
      now: () => "2026-08-22T01:02:03.000Z",
    });
    await controller.initialize();
    await controller.testConnection();
    const cached = structuredClone(persistence.read().capabilityCache);
    vi.mocked(persistence.port.save).mockClear();

    await controller.commitDisplayUrl();
    controller.editDisplayUrl("  http://localhost:4141/  ");
    expect(controller.getSnapshot()).toMatchObject({
      status: "ready",
      canSend: true,
    });
    await controller.commitDisplayUrl();

    expect(controller.getSnapshot()).toMatchObject({
      status: "ready",
      canSend: true,
      displayUrlDraft: "http://localhost:4141",
      settings: {
        displayUrl: "http://localhost:4141",
        apiBaseUrl: "http://localhost:4141/v1",
        enabled: true,
      },
    });
    expect(persistence.port.save).not.toHaveBeenCalled();
    expect(persistence.read().capabilityCache).toEqual(cached);
  });

  it("disables and clears persisted capability evidence for an invalid changed URL", async () => {
    const persistence = store();
    const controller = new AgentModelSettingsController({
      store: persistence.port,
      probe: probe(),
    });
    await controller.initialize();
    await controller.testConnection();

    controller.editDisplayUrl("http://models.example.com");
    await expect(controller.commitDisplayUrl()).resolves.toBe(false);

    expect(controller.getSnapshot()).toMatchObject({
      status: "error",
      canSend: false,
      settings: { enabled: false, modelId: "model-a" },
      capabilities: null,
      error: { code: "model_not_configured", phase: "settings" },
    });
    expect(persistence.read()).toMatchObject({
      settings: { enabled: false, modelId: "model-a" },
      capabilityCache: null,
    });
  });

  it("runs an optional bundled-image probe without making text readiness fake", async () => {
    const persistence = store();
    const runtime = probe();
    const controller = new AgentModelSettingsController({
      store: persistence.port,
      probe: runtime,
    });
    await controller.initialize();
    await controller.testConnection();
    await controller.verifyVision();

    expect(runtime.probeModel).toHaveBeenLastCalledWith(
      expect.anything(),
      "model-a",
      expect.objectContaining({ verifyVision: true }),
    );
    expect(controller.getSnapshot()).toMatchObject({
      status: "ready",
      canSend: true,
      capabilities: { imageInput: "verified" },
    });

    vi.mocked(runtime.probeModel).mockRejectedValueOnce(
      new AgentDomainError("timeout", "connection", "vision timeout"),
    );
    await controller.verifyVision();
    expect(controller.getSnapshot()).toMatchObject({
      status: "ready",
      canSend: true,
      capabilities: { imageInput: "verified" },
      error: { code: "timeout" },
    });
  });

  it("deduplicates probes and ignores a cancelled stale result", async () => {
    let resolveModels!: (
      models: readonly { id: string; displayName: string }[],
    ) => void;
    const listPromise = new Promise<
      readonly { id: string; displayName: string }[]
    >((resolve) => {
      resolveModels = resolve;
    });
    const runtime = probe();
    vi.mocked(runtime.listModels).mockReturnValue(listPromise);
    const controller = new AgentModelSettingsController({
      store: store().port,
      probe: runtime,
    });
    await controller.initialize();

    const first = controller.testConnection();
    const duplicate = controller.testConnection();
    expect(first).toBe(duplicate);
    await vi.waitFor(() => expect(runtime.listModels).toHaveBeenCalledTimes(1));
    controller.cancelProbe();
    resolveModels([{ id: "model-a", displayName: "Model A" }]);
    await first;

    expect(runtime.probeModel).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      status: "unconfigured",
      canSend: false,
      error: { code: "cancelled" },
    });
  });

  it("deduplicates a concurrent unchanged blur and connection probe", async () => {
    const persistence = store();
    const runtime = probe();
    const controller = new AgentModelSettingsController({
      store: persistence.port,
      probe: runtime,
    });
    await controller.initialize();
    vi.mocked(persistence.port.save).mockClear();

    const blur = controller.commitDisplayUrl();
    const connection = controller.testConnection();
    await Promise.all([blur, connection]);

    expect(runtime.listModels).toHaveBeenCalledTimes(1);
    expect(runtime.probeModel).toHaveBeenCalledTimes(1);
    expect(persistence.port.save).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({
      status: "ready",
      canSend: true,
    });
  });

  it("invalidates stale probe versions and keeps offline settings disabled on blur", async () => {
    const settings = normalizeAgentModelSettings({
      ...defaultPersistedAgentModelSettings().settings,
      enabled: true,
      modelId: "model-a",
    });
    const staleStore: AgentModelSettingsStorePort = {
      load: vi.fn(async (): Promise<PersistedAgentModelSettings> => ({
        settings,
        capabilityCache: {
          probeVersion: AGENT_CAPABILITY_PROBE_VERSION + 1,
          proxyKey: agentCapabilityCacheKey(settings, "model-a"),
          modelId: "model-a",
          capabilities: {
            responsesApi: "verified",
            streaming: "verified",
            customTools: "verified",
            imageInput: "unknown",
            reasoningSummary: true,
            reasoningEffort: true,
            contextWindowTokens: 64_000,
          },
          usage: null,
          testedAt: "2026-08-22T01:00:00.000Z",
        },
      })),
      save: vi.fn(async () => undefined),
    };
    const stale = new AgentModelSettingsController({
      store: staleStore,
      probe: probe(),
    });
    await stale.initialize();
    expect(stale.getSnapshot()).toMatchObject({
      status: "requires_retest",
      canSend: false,
      settings: { enabled: false },
      capabilities: null,
    });
    expect(staleStore.save).toHaveBeenCalledWith({
      settings: { ...settings, enabled: false },
      capabilityCache: null,
    });

    const persistence = store();
    const runtime = probe();
    vi.mocked(runtime.listModels).mockRejectedValueOnce(
      new AgentDomainError("proxy_unreachable", "connection", "offline"),
    );
    const offline = new AgentModelSettingsController({
      store: persistence.port,
      probe: runtime,
    });
    await offline.initialize();
    await offline.testConnection();
    vi.mocked(persistence.port.save).mockClear();

    await offline.commitDisplayUrl();
    expect(offline.getSnapshot()).toMatchObject({
      status: "error",
      canSend: false,
      error: { code: "proxy_unreachable" },
    });
    expect(persistence.port.save).not.toHaveBeenCalled();
  });

  it("surfaces invalid URLs, offline proxies, model lists, capability failures, and timeouts", async () => {
    const cases = [
      ["proxy_unreachable", "offline"],
      ["invalid_model_list", "invalid list"],
      ["model_unavailable", "capability failure"],
      ["timeout", "timeout"],
      ["refused", "refusal"],
    ] as const;
    for (const [code, message] of cases) {
      const runtime = probe();
      vi.mocked(runtime.listModels).mockRejectedValueOnce(
        new AgentDomainError(code, "connection", message),
      );
      const controller = new AgentModelSettingsController({
        store: store().port,
        probe: runtime,
      });
      await controller.initialize();
      await controller.testConnection();
      expect(controller.getSnapshot()).toMatchObject({
        status: "error",
        error: { code },
      });
    }

    const controller = new AgentModelSettingsController({
      store: store().port,
      probe: probe(),
    });
    await controller.initialize();
    controller.editDisplayUrl("http://models.example.com");
    await controller.commitDisplayUrl();
    expect(controller.getSnapshot()).toMatchObject({
      status: "error",
      error: { code: "model_not_configured", phase: "settings" },
    });
  });
});
