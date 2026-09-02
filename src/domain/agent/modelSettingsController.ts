import {
  AgentDomainError,
  agentErrorDetails,
  type AgentErrorDetails,
} from "./errors";
import type {
  AgentDiscoveredModel,
  AgentModelProbePort,
  AgentModelSettingsStorePort,
} from "./ports";
import type {
  AgentModelCapabilities,
  AgentModelSettings,
  AgentReasoningEffort,
  AgentReasoningSummary,
} from "./models";
import {
  AGENT_CAPABILITY_PROBE_VERSION,
  agentCapabilityCacheKey,
  canSendWithAgent,
  defaultPersistedAgentModelSettings,
  deriveAgentApiBaseUrl,
  isAgentCapabilityCacheCurrent,
  normalizeAgentModelSettings,
  type AgentCapabilityCache,
  type PersistedAgentModelSettings,
} from "./settings";
import type { AgentTokenUsage } from "./usage";

export type AgentModelSettingsStatus =
  | "loading"
  | "unconfigured"
  | "requires_retest"
  | "testing"
  | "ready"
  | "error";

export interface AgentModelSettingsSnapshot {
  readonly status: AgentModelSettingsStatus;
  readonly settings: AgentModelSettings;
  readonly displayUrlDraft: string;
  readonly models: readonly AgentDiscoveredModel[];
  readonly capabilities: AgentModelCapabilities | null;
  readonly usage: AgentTokenUsage | null;
  readonly error: AgentErrorDetails | null;
  readonly operation: "connection" | "vision" | null;
  readonly canSend: boolean;
}

interface Dependencies {
  readonly store: AgentModelSettingsStorePort;
  readonly probe: AgentModelProbePort;
  readonly now?: () => string;
}

function initialSnapshot(): AgentModelSettingsSnapshot {
  const persisted = defaultPersistedAgentModelSettings();
  return {
    status: "loading",
    settings: persisted.settings,
    displayUrlDraft: persisted.settings.displayUrl,
    models: [],
    capabilities: null,
    usage: null,
    error: null,
    operation: null,
    canSend: false,
  };
}

function configuredStatus(
  settings: AgentModelSettings,
  cache: AgentCapabilityCache | null,
): AgentModelSettingsStatus {
  if (settings.modelId === null) return "unconfigured";
  if (
    isAgentCapabilityCacheCurrent(settings, cache) &&
    canSendWithAgent(settings, cache.capabilities)
  ) {
    return "ready";
  }
  return "requires_retest";
}

function connectionError(error: unknown): AgentErrorDetails {
  if (error instanceof DOMException && error.name === "AbortError") {
    return new AgentDomainError(
      "cancelled",
      "connection",
      "The model probe was cancelled",
    ).toDetails();
  }
  return agentErrorDetails(error, {
    code: "proxy_unreachable",
    phase: "connection",
    retryable: true,
  });
}

export class AgentModelSettingsController {
  private readonly listeners = new Set<() => void>();
  private readonly store: AgentModelSettingsStorePort;
  private readonly probe: AgentModelProbePort;
  private readonly now: () => string;
  private snapshot = initialSnapshot();
  private operation: Promise<void> | null = null;
  private operationGeneration = 0;
  private abortController: AbortController | null = null;
  private visionBaseline: PersistedAgentModelSettings | null = null;
  private committedCache: AgentCapabilityCache | null = null;
  private displayUrlCommit: {
    readonly draft: string;
    readonly promise: Promise<boolean>;
  } | null = null;

  constructor({
    store,
    probe,
    now = () => new Date().toISOString(),
  }: Dependencies) {
    this.store = store;
    this.probe = probe;
    this.now = now;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): AgentModelSettingsSnapshot => this.snapshot;

  async initialize(): Promise<void> {
    try {
      const persisted = await this.store.load();
      const cache = isAgentCapabilityCacheCurrent(
        persisted.settings,
        persisted.capabilityCache,
      )
        ? persisted.capabilityCache
        : null;
      const enabled = cache &&
          canSendWithAgent({ ...persisted.settings, enabled: true }, cache.capabilities)
        ? true
        : false;
      const settings = { ...persisted.settings, enabled };
      if (settings.enabled !== persisted.settings.enabled || cache !== persisted.capabilityCache) {
        await this.store.save({ settings, capabilityCache: cache });
      }
      this.committedCache = cache;
      this.update({
        status: configuredStatus(settings, cache),
        settings,
        displayUrlDraft: settings.displayUrl,
        models: settings.modelId
          ? [{ id: settings.modelId, displayName: settings.modelId }]
          : [],
        capabilities: cache?.capabilities ?? null,
        usage: cache?.usage ?? null,
        error: null,
        operation: null,
        canSend: cache ? canSendWithAgent(settings, cache.capabilities) : false,
      });
    } catch (error) {
      this.update({
        ...initialSnapshot(),
        status: "error",
        error: agentErrorDetails(error, {
          code: "store_failed",
          phase: "store",
          retryable: true,
        }),
      });
    }
  }

  editDisplayUrl(value: string): void {
    let unchanged = false;
    try {
      const displayUrl = value.trim();
      const normalized = normalizeAgentModelSettings({
        ...this.snapshot.settings,
        displayUrl,
        apiBaseUrl: deriveAgentApiBaseUrl(displayUrl),
      });
      unchanged =
        normalized.displayUrl === this.snapshot.settings.displayUrl &&
        normalized.apiBaseUrl === this.snapshot.settings.apiBaseUrl;
    } catch {
      unchanged = false;
    }
    const cache = unchanged ? this.currentCache() : null;
    const ready = cache !== null &&
      canSendWithAgent(this.snapshot.settings, cache.capabilities);
    this.update({
      ...this.snapshot,
      displayUrlDraft: value,
      status: unchanged
        ? ready ? "ready" : this.snapshot.status
        : "requires_retest",
      capabilities: unchanged
        ? cache?.capabilities ?? this.snapshot.capabilities
        : null,
      usage: unchanged ? cache?.usage ?? this.snapshot.usage : null,
      error: unchanged ? this.snapshot.error : null,
      canSend: unchanged ? ready || this.snapshot.canSend : false,
    });
  }

  commitDisplayUrl(): Promise<boolean> {
    const draft = this.snapshot.displayUrlDraft;
    if (this.displayUrlCommit?.draft === draft) {
      return this.displayUrlCommit.promise;
    }
    const promise = this.performDisplayUrlCommit(draft).finally(() => {
      if (this.displayUrlCommit?.promise === promise) {
        this.displayUrlCommit = null;
      }
    });
    this.displayUrlCommit = { draft, promise };
    return promise;
  }

  private async performDisplayUrlCommit(draft: string): Promise<boolean> {
    let normalized: AgentModelSettings;
    try {
      const displayUrl = draft.trim();
      normalized = normalizeAgentModelSettings({
        ...this.snapshot.settings,
        displayUrl,
        apiBaseUrl: deriveAgentApiBaseUrl(displayUrl),
      });
    } catch (error) {
      return this.disableInvalidDisplayUrl(draft, error);
    }

    const endpointChanged =
      normalized.displayUrl !== this.snapshot.settings.displayUrl ||
      normalized.apiBaseUrl !== this.snapshot.settings.apiBaseUrl;
    const cache = isAgentCapabilityCacheCurrent(
      normalized,
      this.committedCache,
    )
      ? this.committedCache
      : null;

    if (!endpointChanged && cache) {
      const enabledSettings = { ...normalized, enabled: true };
      const ready = canSendWithAgent(enabledSettings, cache.capabilities);
      if (!ready) {
        if (
          this.snapshot.displayUrlDraft === draft &&
          draft !== normalized.displayUrl
        ) {
          this.update({
            ...this.snapshot,
            displayUrlDraft: normalized.displayUrl,
          });
        }
        return true;
      }
      if (
        this.snapshot.displayUrlDraft === normalized.displayUrl &&
        this.snapshot.settings.enabled === enabledSettings.enabled &&
        this.snapshot.capabilities === cache.capabilities &&
        this.snapshot.usage === cache.usage &&
        this.snapshot.status === "ready" &&
        this.snapshot.canSend
      ) {
        return true;
      }
      if (this.snapshot.displayUrlDraft === draft) {
        this.update({
          ...this.snapshot,
          settings: enabledSettings,
          displayUrlDraft: normalized.displayUrl,
          capabilities: cache.capabilities,
          usage: cache.usage,
          status: "ready",
          canSend: true,
        });
      }
      return true;
    }

    if (!endpointChanged && this.committedCache === null) {
      if (
        this.snapshot.displayUrlDraft === draft &&
        draft !== normalized.displayUrl
      ) {
        this.update({
          ...this.snapshot,
          displayUrlDraft: normalized.displayUrl,
        });
      }
      return true;
    }

    const settings = { ...normalized, enabled: false };
    try {
      await this.store.save({ settings, capabilityCache: null });
    } catch (error) {
      if (this.snapshot.displayUrlDraft === draft) {
        this.update({
          ...this.snapshot,
          status: "error",
          error: agentErrorDetails(error, {
            code: "store_failed",
            phase: "store",
            retryable: true,
          }),
          canSend: false,
        });
      }
      return false;
    }
    this.committedCache = null;
    if (this.snapshot.displayUrlDraft === draft) {
      this.update({
        ...this.snapshot,
        settings,
        displayUrlDraft: settings.displayUrl,
        capabilities: null,
        usage: null,
        error: null,
        status: configuredStatus(settings, null),
        canSend: false,
      });
    }
    return true;
  }

  private async disableInvalidDisplayUrl(
    draft: string,
    error: unknown,
  ): Promise<boolean> {
    const settings = { ...this.snapshot.settings, enabled: false };
    if (this.committedCache !== null || this.snapshot.settings.enabled) {
      try {
        await this.store.save({ settings, capabilityCache: null });
        this.committedCache = null;
      } catch (storeError) {
        if (this.snapshot.displayUrlDraft === draft) {
          this.update({
            ...this.snapshot,
            status: "error",
            error: agentErrorDetails(storeError, {
              code: "store_failed",
              phase: "store",
              retryable: true,
            }),
            canSend: false,
          });
        }
        return false;
      }
    }
    if (this.snapshot.displayUrlDraft === draft) {
      this.update({
        ...this.snapshot,
        settings,
        capabilities: null,
        usage: null,
        status: "error",
        error: agentErrorDetails(error, {
          code: "model_not_configured",
          phase: "settings",
        }),
        canSend: false,
      });
    }
    return false;
  }

  async selectModel(modelId: string): Promise<void> {
    if (!this.snapshot.models.some((model) => model.id === modelId)) {
      throw new AgentDomainError(
        "model_unavailable",
        "settings",
        "The selected model is not in the discovered model list",
      );
    }
    if (modelId === this.snapshot.settings.modelId) return;
    const settings = normalizeAgentModelSettings({
      ...this.snapshot.settings,
      enabled: false,
      modelId,
    });
    await this.store.save({ settings, capabilityCache: null });
    this.committedCache = null;
    this.update({
      ...this.snapshot,
      status: "requires_retest",
      settings,
      capabilities: null,
      usage: null,
      error: null,
      canSend: false,
    });
  }

  testConnection(): Promise<void> {
    return this.runProbe(false);
  }

  verifyVision(): Promise<void> {
    if (this.snapshot.status !== "ready") {
      return Promise.reject(new AgentDomainError(
        "model_not_configured",
        "connection",
        "Text capabilities must be verified before image input",
      ));
    }
    return this.runProbe(true);
  }

  cancelProbe(): void {
    if (!this.operation) return;
    this.operationGeneration += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.operation = null;
    const visionBaseline = this.visionBaseline;
    this.visionBaseline = null;
    if (this.snapshot.operation === "vision" && visionBaseline?.capabilityCache) {
      this.committedCache = visionBaseline.capabilityCache;
      this.update({
        ...this.snapshot,
        status: "ready",
        settings: visionBaseline.settings,
        capabilities: visionBaseline.capabilityCache.capabilities,
        usage: visionBaseline.capabilityCache.usage,
        operation: null,
        error: new AgentDomainError(
          "cancelled",
          "connection",
          "The image capability probe was cancelled",
        ).toDetails(),
        canSend: true,
      });
      void this.store.save(visionBaseline).catch((error) => {
        this.update({
          ...this.snapshot,
          status: "error",
          error: agentErrorDetails(error, {
            code: "store_failed",
            phase: "store",
            retryable: true,
          }),
          canSend: false,
        });
      });
      return;
    }
    const settings = { ...this.snapshot.settings, enabled: false };
    this.committedCache = null;
    this.update({
      ...this.snapshot,
      status: this.snapshot.settings.modelId
        ? "requires_retest"
        : "unconfigured",
      settings,
      capabilities: null,
      usage: null,
      operation: null,
      error: new AgentDomainError(
        "cancelled",
        "connection",
        "The model probe was cancelled",
      ).toDetails(),
      canSend: false,
    });
    void this.store.save({ settings, capabilityCache: null }).catch((error) => {
      this.update({
        ...this.snapshot,
        status: "error",
        error: agentErrorDetails(error, {
          code: "store_failed",
          phase: "store",
          retryable: true,
        }),
      });
    });
  }

  async setReasoningEffort(value: AgentReasoningEffort | null): Promise<void> {
    if (!this.snapshot.capabilities?.reasoningEffort) return;
    await this.saveReasoning({ reasoningEffort: value });
  }

  async setReasoningSummary(value: AgentReasoningSummary): Promise<void> {
    if (!this.snapshot.capabilities?.reasoningSummary) return;
    await this.saveReasoning({ reasoningSummary: value });
  }

  async removeConfiguration(): Promise<void> {
    this.cancelProbe();
    const persisted = defaultPersistedAgentModelSettings();
    await this.store.save(persisted);
    this.committedCache = null;
    this.update({
      ...initialSnapshot(),
      status: "unconfigured",
      settings: persisted.settings,
      displayUrlDraft: persisted.settings.displayUrl,
    });
  }

  private runProbe(verifyVision: boolean): Promise<void> {
    if (this.operation) return this.operation;
    const generation = ++this.operationGeneration;
    const abortController = new AbortController();
    this.abortController = abortController;
    const currentCache = verifyVision ? this.currentCache() : null;
    this.visionBaseline = currentCache
      ? {
        settings: this.snapshot.settings,
        capabilityCache: currentCache,
      }
      : null;
    const operation = this.performProbe(
      verifyVision,
      generation,
      abortController.signal,
    ).finally(() => {
      if (this.operationGeneration !== generation) return;
      this.operation = null;
      this.abortController = null;
      this.visionBaseline = null;
      if (this.snapshot.operation !== null) {
        this.update({ ...this.snapshot, operation: null });
      }
    });
    this.operation = operation;
    return operation;
  }

  private async performProbe(
    verifyVision: boolean,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    const committed = await this.commitDisplayUrl();
    if (!committed || signal.aborted || generation !== this.operationGeneration) {
      return;
    }
    const verifiedTextSettings = this.snapshot.settings;
    const verifiedTextCache = verifyVision ? this.currentCache() : null;
    const operation = verifyVision ? "vision" : "connection";
    this.update({
      ...this.snapshot,
      status: "testing",
      operation,
      error: null,
      canSend: false,
    });
    try {
      const models = await this.probe.listModels(this.snapshot.settings, signal);
      if (signal.aborted || generation !== this.operationGeneration) return;
      if (models.length === 0) {
        throw new AgentDomainError(
          "invalid_model_list",
          "connection",
          "The proxy returned no models",
        );
      }
      const selected = this.snapshot.settings.modelId &&
          models.some((model) => model.id === this.snapshot.settings.modelId)
        ? this.snapshot.settings.modelId
        : models[0].id;
      const probeSettings = normalizeAgentModelSettings({
        ...this.snapshot.settings,
        enabled: false,
        modelId: selected,
      });
      this.update({
        ...this.snapshot,
        models: [...models],
        settings: probeSettings,
        operation,
      });
      const result = await this.probe.probeModel(
        probeSettings,
        selected,
        { verifyVision, signal },
      );
      if (signal.aborted || generation !== this.operationGeneration) return;
      if (result.modelId !== selected) {
        throw new AgentDomainError(
          "model_unavailable",
          "connection",
          "The model probe returned a different model",
        );
      }
      const enabledSettings = normalizeAgentModelSettings({
        ...probeSettings,
        enabled: true,
      });
      const ready = canSendWithAgent(enabledSettings, result.capabilities);
      const settings = { ...enabledSettings, enabled: ready };
      const cache: AgentCapabilityCache = {
        probeVersion: AGENT_CAPABILITY_PROBE_VERSION,
        proxyKey: agentCapabilityCacheKey(settings, selected),
        modelId: selected,
        capabilities: result.capabilities,
        usage: result.usage,
        testedAt: this.now(),
      };
      await this.store.save({ settings, capabilityCache: cache });
      if (signal.aborted || generation !== this.operationGeneration) return;
      this.committedCache = cache;
      this.update({
        ...this.snapshot,
        status: ready ? "ready" : "error",
        settings,
        models: [...models],
        capabilities: result.capabilities,
        usage: result.usage,
        operation: null,
        error: ready
          ? null
          : new AgentDomainError(
            "model_unavailable",
            "connection",
            "Responses, streaming, and custom tools were not all verified",
          ).toDetails(),
        canSend: ready,
      });
    } catch (error) {
      if (signal.aborted || generation !== this.operationGeneration) return;
      if (verifyVision && verifiedTextCache) {
        try {
          await this.store.save({
            settings: verifiedTextSettings,
            capabilityCache: verifiedTextCache,
          });
          this.committedCache = verifiedTextCache;
        } catch (storeError) {
          this.update({
            ...this.snapshot,
            status: "error",
            operation: null,
            error: agentErrorDetails(storeError, {
              code: "store_failed",
              phase: "store",
              retryable: true,
            }),
            canSend: false,
          });
          return;
        }
        this.update({
          ...this.snapshot,
          status: "ready",
          settings: verifiedTextSettings,
          capabilities: verifiedTextCache.capabilities,
          usage: verifiedTextCache.usage,
          operation: null,
          error: connectionError(error),
          canSend: true,
        });
        return;
      }
      const settings = { ...this.snapshot.settings, enabled: false };
      try {
        await this.store.save({ settings, capabilityCache: null });
        this.committedCache = null;
      } catch (storeError) {
        this.update({
          ...this.snapshot,
          status: "error",
          settings,
          capabilities: null,
          usage: null,
          operation: null,
          error: agentErrorDetails(storeError, {
            code: "store_failed",
            phase: "store",
            retryable: true,
          }),
          canSend: false,
        });
        return;
      }
      this.update({
        ...this.snapshot,
        status: "error",
        settings,
        capabilities: null,
        usage: null,
        operation: null,
        error: connectionError(error),
        canSend: false,
      });
    }
  }

  private async saveReasoning(
    update: Partial<Pick<
      AgentModelSettings,
      "reasoningEffort" | "reasoningSummary"
    >>,
  ): Promise<void> {
    const settings = normalizeAgentModelSettings({
      ...this.snapshot.settings,
      ...update,
    });
    const cache = this.currentCache();
    await this.store.save({ settings, capabilityCache: cache });
    this.update({ ...this.snapshot, settings });
  }

  private currentCache(): AgentCapabilityCache | null {
    return isAgentCapabilityCacheCurrent(
      this.snapshot.settings,
      this.committedCache,
    )
      ? this.committedCache
      : null;
  }

  private update(snapshot: AgentModelSettingsSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}
