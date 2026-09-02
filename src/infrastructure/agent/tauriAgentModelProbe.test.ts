import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_MODEL_SETTINGS } from "../../domain/agent";
import { createTauriAgentModelProbe } from "./tauriAgentModelProbe";

describe("Tauri agent model probe", () => {
  it("uses narrow native commands with no API key or renderer network", async () => {
    const rendererFetch = vi.spyOn(globalThis, "fetch");
    const invokeCommand = vi.fn()
      .mockResolvedValueOnce([{ id: "model-a", displayName: "Model A" }])
      .mockResolvedValueOnce({
        modelId: "model-a",
        capabilities: {
          responsesApi: "verified",
          streaming: "verified",
          customTools: "verified",
          imageInput: "unknown",
          reasoningSummary: true,
          reasoningEffort: false,
          contextWindowTokens: null,
        },
        usage: null,
      });
    const port = createTauriAgentModelProbe({ invokeCommand });

    await port.listModels(DEFAULT_AGENT_MODEL_SETTINGS);
    await port.probeModel(
      DEFAULT_AGENT_MODEL_SETTINGS,
      "model-a",
      { verifyVision: false },
    );

    expect(invokeCommand.mock.calls.map(([command]) => command)).toEqual([
      "agent_list_models",
      "agent_probe_model",
    ]);
    expect(JSON.stringify(invokeCommand.mock.calls)).not.toContain("apiKey");
    expect(rendererFetch).not.toHaveBeenCalled();
    rendererFetch.mockRestore();
  });

  it("maps native typed errors and rejects malformed data", async () => {
    const offline = createTauriAgentModelProbe({
      invokeCommand: vi.fn().mockRejectedValue({
        code: "proxy_unreachable",
        message: "offline",
      }),
    });
    await expect(offline.listModels(DEFAULT_AGENT_MODEL_SETTINGS))
      .rejects.toMatchObject({ code: "proxy_unreachable", phase: "connection" });

    const malformed = createTauriAgentModelProbe({
      invokeCommand: vi.fn().mockResolvedValue({ data: [] }),
    });
    await expect(malformed.listModels(DEFAULT_AGENT_MODEL_SETTINGS))
      .rejects.toMatchObject({ code: "invalid_model_list" });
  });
});
