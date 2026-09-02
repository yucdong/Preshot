import { AgentDomainError } from "./errors";
import type {
  AgentCapabilityStatus,
  AgentModelCapabilities,
  AgentModelSettings,
  AgentReasoningEffort,
  AgentReasoningSummary,
} from "./models";
import {
  normalizeAgentTokenUsage,
  type AgentTokenUsage,
} from "./usage";

export const DEFAULT_AGENT_DISPLAY_URL = "http://localhost:4141";
export const DEFAULT_AGENT_API_BASE_URL = "http://localhost:4141/v1";
export const AGENT_CAPABILITY_PROBE_VERSION = 1;

export const DEFAULT_AGENT_MODEL_CAPABILITIES: AgentModelCapabilities = {
  responsesApi: "unknown",
  streaming: "unknown",
  customTools: "unknown",
  imageInput: "unknown",
  reasoningSummary: false,
  reasoningEffort: false,
  contextWindowTokens: null,
};

export const DEFAULT_AGENT_MODEL_SETTINGS: AgentModelSettings = {
  enabled: false,
  providerType: "openai",
  displayUrl: DEFAULT_AGENT_DISPLAY_URL,
  apiBaseUrl: DEFAULT_AGENT_API_BASE_URL,
  modelId: null,
  wireApi: "responses",
  reasoningEffort: null,
  reasoningSummary: "concise",
};

export interface AgentCapabilityCache {
  readonly probeVersion: number;
  readonly proxyKey: string;
  readonly modelId: string;
  readonly capabilities: AgentModelCapabilities;
  readonly usage: AgentTokenUsage | null;
  readonly testedAt: string;
}

export interface PersistedAgentModelSettings {
  readonly settings: AgentModelSettings;
  readonly capabilityCache: AgentCapabilityCache | null;
}

export function defaultPersistedAgentModelSettings(): PersistedAgentModelSettings {
  return {
    settings: { ...DEFAULT_AGENT_MODEL_SETTINGS },
    capabilityCache: null,
  };
}

function settingsError(message: string): never {
  throw new AgentDomainError(
    "model_not_configured",
    "settings",
    message,
    { recovery: "Review the assistant proxy and model settings." },
  );
}

function recordOf(
  value: unknown,
  name: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return settingsError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  name: string,
): void {
  const allowed = new Set(keys);
  const extra = Object.keys(record).find((key) => !allowed.has(key));
  if (extra) settingsError(`${name} contains unsupported field "${extra}"`);
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "[::1]" || host === "::1") return true;
  const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return match !== null && match.slice(1).every((part) => Number(part) <= 255);
}

export function normalizeAgentUrl(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() !== value || !value) {
    return settingsError(`${field} must be a non-empty trimmed URL`);
  }
  if (value.startsWith("\\\\") || /^[a-zA-Z]:[\\/]/.test(value)) {
    return settingsError(`${field} must not be a file or UNC path`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return settingsError(`${field} is not a valid URL`);
  }
  if (url.username || url.password) {
    return settingsError(`${field} must not contain credentials`);
  }
  if (url.hash) settingsError(`${field} must not contain a fragment`);
  if (url.search) settingsError(`${field} must not contain a query`);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return settingsError(`${field} must use HTTP or HTTPS`);
  }
  if (url.protocol === "http:" && !isLoopback(url.hostname)) {
    return settingsError(`${field} may use HTTP only for a loopback host`);
  }
  if (!url.hostname) settingsError(`${field} must include a host`);

  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path || "/";
  return url.toString().replace(/\/$/, "");
}

export function deriveAgentApiBaseUrl(displayUrl: string): string {
  const normalized = normalizeAgentUrl(displayUrl, "displayUrl");
  return /\/v1$/i.test(new URL(normalized).pathname)
    ? normalized
    : `${normalized}/v1`;
}

function normalizedModelId(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !value ||
    value.length > 200
  ) {
    return settingsError("modelId must be null or a trimmed model identifier");
  }
  return value;
}

function reasoningEffortOf(value: unknown): AgentReasoningEffort | null {
  if (value === null) return null;
  if (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  ) {
    return value;
  }
  return settingsError("reasoningEffort is unsupported");
}

function reasoningSummaryOf(value: unknown): AgentReasoningSummary {
  if (value === "none" || value === "concise" || value === "detailed") {
    return value;
  }
  return settingsError("reasoningSummary is unsupported");
}

export function normalizeAgentModelSettings(
  raw: unknown,
): AgentModelSettings {
  const value = recordOf(raw, "Agent model settings");
  assertOnlyKeys(value, [
    "enabled",
    "providerType",
    "displayUrl",
    "apiBaseUrl",
    "modelId",
    "wireApi",
    "reasoningEffort",
    "reasoningSummary",
  ], "Agent model settings");
  if (typeof value.enabled !== "boolean") {
    return settingsError("enabled must be a boolean");
  }
  if (value.providerType !== "openai") {
    return settingsError("providerType must be openai");
  }
  if (value.wireApi !== "responses") {
    return settingsError("wireApi must be responses");
  }

  const displayUrl = normalizeAgentUrl(value.displayUrl, "displayUrl");
  const apiBaseUrl = normalizeAgentUrl(value.apiBaseUrl, "apiBaseUrl");
  const display = new URL(displayUrl);
  const api = new URL(apiBaseUrl);
  if (display.origin !== api.origin) {
    return settingsError("displayUrl and apiBaseUrl must use the same origin");
  }
  if (!/\/v1$/i.test(api.pathname)) {
    return settingsError("apiBaseUrl must end in /v1");
  }

  return {
    enabled: value.enabled,
    providerType: "openai",
    displayUrl,
    apiBaseUrl,
    modelId: normalizedModelId(value.modelId),
    wireApi: "responses",
    reasoningEffort: reasoningEffortOf(value.reasoningEffort),
    reasoningSummary: reasoningSummaryOf(value.reasoningSummary),
  };
}

function capabilityStatusOf(
  value: unknown,
  field: string,
): AgentCapabilityStatus {
  if (value === "verified" || value === "unsupported" || value === "unknown") {
    return value;
  }
  return settingsError(`${field} has an invalid capability status`);
}

export function normalizeAgentModelCapabilities(
  raw: unknown,
): AgentModelCapabilities {
  const value = recordOf(raw, "Agent model capabilities");
  assertOnlyKeys(value, [
    "responsesApi",
    "streaming",
    "customTools",
    "imageInput",
    "reasoningSummary",
    "reasoningEffort",
    "contextWindowTokens",
  ], "Agent model capabilities");
  if (
    typeof value.reasoningSummary !== "boolean" ||
    typeof value.reasoningEffort !== "boolean"
  ) {
    return settingsError("Reasoning capabilities must be booleans");
  }
  if (
    value.contextWindowTokens !== null &&
    (
      typeof value.contextWindowTokens !== "number" ||
      !Number.isSafeInteger(value.contextWindowTokens) ||
      value.contextWindowTokens <= 0
    )
  ) {
    return settingsError("contextWindowTokens must be a positive integer or null");
  }
  return {
    responsesApi: capabilityStatusOf(value.responsesApi, "responsesApi"),
    streaming: capabilityStatusOf(value.streaming, "streaming"),
    customTools: capabilityStatusOf(value.customTools, "customTools"),
    imageInput: capabilityStatusOf(value.imageInput, "imageInput"),
    reasoningSummary: value.reasoningSummary,
    reasoningEffort: value.reasoningEffort,
    contextWindowTokens: value.contextWindowTokens,
  };
}

export function agentCapabilityCacheKey(
  settings: AgentModelSettings,
  modelId: string,
): string {
  const normalized = normalizeAgentModelSettings({
    ...settings,
    modelId,
  });
  return JSON.stringify([
    AGENT_CAPABILITY_PROBE_VERSION,
    normalized.apiBaseUrl,
    modelId,
  ]);
}

export function normalizePersistedAgentModelSettings(
  raw: unknown,
): PersistedAgentModelSettings {
  const value = recordOf(raw, "Persisted agent model settings");
  assertOnlyKeys(
    value,
    ["settings", "capabilityCache"],
    "Persisted agent model settings",
  );
  const settings = normalizeAgentModelSettings(value.settings);
  if (value.capabilityCache === null) {
    return { settings, capabilityCache: null };
  }

  const cache = recordOf(value.capabilityCache, "Agent capability cache");
  assertOnlyKeys(
    cache,
    [
      "probeVersion",
      "proxyKey",
      "modelId",
      "capabilities",
      "usage",
      "testedAt",
    ],
    "Agent capability cache",
  );
  if (
    typeof cache.probeVersion !== "number" ||
    !Number.isSafeInteger(cache.probeVersion) ||
    cache.probeVersion <= 0 ||
    typeof cache.proxyKey !== "string" ||
    typeof cache.modelId !== "string" ||
    typeof cache.testedAt !== "string" ||
    !Number.isFinite(Date.parse(cache.testedAt))
  ) {
    return settingsError("Agent capability cache is invalid or outdated");
  }
  if (cache.probeVersion !== AGENT_CAPABILITY_PROBE_VERSION) {
    return {
      settings: { ...settings, enabled: false },
      capabilityCache: null,
    };
  }
  const modelId = normalizedModelId(cache.modelId);
  if (modelId === null) {
    return settingsError("Agent capability cache requires a model identifier");
  }
  const expectedKey = agentCapabilityCacheKey(settings, modelId);
  if (cache.proxyKey !== expectedKey) {
    return {
      settings: { ...settings, enabled: false },
      capabilityCache: null,
    };
  }
  return {
    settings,
    capabilityCache: {
      probeVersion: AGENT_CAPABILITY_PROBE_VERSION,
      proxyKey: expectedKey,
      modelId,
      capabilities: normalizeAgentModelCapabilities(cache.capabilities),
      usage: cache.usage === null
        ? null
        : normalizeAgentTokenUsage(cache.usage),
      testedAt: cache.testedAt,
    },
  };
}

export function isAgentCapabilityCacheCurrent(
  settings: AgentModelSettings,
  cache: AgentCapabilityCache | null,
): cache is AgentCapabilityCache {
  return settings.modelId !== null &&
    cache !== null &&
    cache.probeVersion === AGENT_CAPABILITY_PROBE_VERSION &&
    cache.modelId === settings.modelId &&
    cache.proxyKey === agentCapabilityCacheKey(settings, settings.modelId);
}

export function canSendWithAgent(
  settings: AgentModelSettings,
  capabilities: AgentModelCapabilities,
): boolean {
  return settings.enabled &&
    settings.modelId !== null &&
    capabilities.responsesApi === "verified" &&
    capabilities.streaming === "verified" &&
    capabilities.customTools === "verified";
}
