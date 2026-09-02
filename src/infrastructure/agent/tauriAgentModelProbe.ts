import { invoke } from "@tauri-apps/api/core";
import {
  AGENT_ERROR_CODES,
  AgentDomainError,
  normalizeAgentModelCapabilities,
  normalizeAgentTokenUsage,
  type AgentConnectionProbeResult,
  type AgentDiscoveredModel,
  type AgentErrorCode,
  type AgentModelProbePort,
} from "../../domain/agent";

type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

interface Dependencies {
  readonly invokeCommand?: InvokeCommand;
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AgentDomainError(
      "model_unavailable",
      "connection",
      "The native model probe returned malformed data",
    );
  }
  return value as Record<string, unknown>;
}

function string(value: Record<string, unknown>, key: string): string {
  if (typeof value[key] !== "string" || value[key].length === 0) {
    throw new AgentDomainError(
      "model_unavailable",
      "connection",
      "The native model probe returned malformed data",
    );
  }
  return value[key];
}

function discoveredModels(value: unknown): readonly AgentDiscoveredModel[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AgentDomainError(
      "invalid_model_list",
      "connection",
      "The proxy returned an invalid or empty model list",
    );
  }
  return value.map((item) => {
    const model = record(item);
    return {
      id: string(model, "id"),
      displayName: string(model, "displayName"),
    };
  });
}

function probeResult(value: unknown): AgentConnectionProbeResult {
  const result = record(value);
  return {
    modelId: string(result, "modelId"),
    capabilities: normalizeAgentModelCapabilities(result.capabilities),
    usage: result.usage === null || result.usage === undefined
      ? null
      : normalizeAgentTokenUsage(result.usage),
  };
}

function nativeError(error: unknown): AgentDomainError {
  const candidate = typeof error === "object" && error !== null
    ? error as Record<string, unknown>
    : {};
  const code = typeof candidate.code === "string" &&
      AGENT_ERROR_CODES.includes(candidate.code as AgentErrorCode)
    ? candidate.code as AgentErrorCode
    : "proxy_unreachable";
  const message = typeof candidate.message === "string"
    ? candidate.message
    : error instanceof Error
      ? error.message
      : "The native model operation failed";
  return new AgentDomainError(code, "connection", message, { cause: error });
}

export function createTauriAgentModelProbe({
  invokeCommand = invoke,
}: Dependencies = {}): AgentModelProbePort {
  return {
    async listModels(settings, signal) {
      throwIfAborted(signal);
      try {
        const response = await invokeCommand("agent_list_models", { settings });
        throwIfAborted(signal);
        return discoveredModels(response);
      } catch (error) {
        if (signal?.aborted) throw abortError();
        throw nativeError(error);
      }
    },
    async probeModel(settings, modelId, { verifyVision, signal }) {
      throwIfAborted(signal);
      try {
        const response = await invokeCommand("agent_probe_model", {
          settings,
          modelId,
          verifyVision,
        });
        throwIfAborted(signal);
        return probeResult(response);
      } catch (error) {
        if (signal?.aborted) throw abortError();
        throw nativeError(error);
      }
    },
  };
}

export const tauriAgentModelProbe = createTauriAgentModelProbe();
