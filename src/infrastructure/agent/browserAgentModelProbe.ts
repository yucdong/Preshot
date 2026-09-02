import {
  type AgentDiscoveredModel,
  type AgentModelProbePort,
} from "../../domain/agent";

const MODELS: readonly AgentDiscoveredModel[] = [
  { id: "preshot-text", displayName: "Preshot Text (deterministic)" },
  { id: "preshot-vision", displayName: "Preshot Vision (deterministic)" },
];

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
}

export function createBrowserAgentModelProbe(): AgentModelProbePort {
  return {
    async listModels(_settings, signal) {
      throwIfAborted(signal);
      return MODELS.map((model) => ({ ...model }));
    },
    async probeModel(_settings, modelId, { verifyVision, signal }) {
      throwIfAborted(signal);
      if (!MODELS.some((model) => model.id === modelId)) {
        throw new Error("Deterministic model is unavailable");
      }
      return {
        modelId,
        capabilities: {
          responsesApi: "verified",
          streaming: "verified",
          customTools: "verified",
          imageInput: verifyVision ? "verified" : "unknown",
          reasoningSummary: true,
          reasoningEffort: true,
          contextWindowTokens: 128_000,
        },
        usage: {
          inputTokens: verifyVision ? 14 : 9,
          outputTokens: 2,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          requestCount: verifyVision ? 2 : 1,
        },
      };
    },
  };
}

export const browserAgentModelProbe = createBrowserAgentModelProbe();
