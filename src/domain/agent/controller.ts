import {
  captureAgentTurnContext,
  createAgentRequestContext,
  removeAgentContextChip,
  reconcileAgentRequestContext,
  setRequestImageAttachmentPinned,
} from "./contextSnapshot";
import {
  agentErrorDetails,
  AgentDomainError,
  AgentProposalTemporaryError,
  type AgentErrorDetails,
} from "./errors";
import {
  createAgentEventState,
  interruptAgentPendingInteractions,
  reduceAgentEvent,
  type AgentEventState,
  type AgentNormalizedEvent,
} from "./eventReducer";
import type { AgentMetadataStorePort } from "./metadataStore";
import type {
  AgentCitation,
  AgentCitationNavigationResult,
  AgentDraft,
  AgentModelCapabilities,
  AgentModelSettings,
  AgentRequestContextDraft,
  AgentSessionMetadata,
  AgentSessionState,
  AgentTurnContext,
} from "./models";
import type {
  AgentRuntimePort,
  AgentRuntimeSessionConfig,
  AgentProposalApplicationPort,
  AgentWorkspaceBridgePort,
} from "./ports";
import {
  AgentProposalService,
  type AgentPreparedProposal,
  type AgentProposalLifecycleEvent,
  type AgentProposalApplyIntentResult,
  type AgentProposalUndoIntentResult,
} from "./proposalService";
import type { AgentStoredProposal } from "./metadataStore";
import type { AgentProposalRecoveryOperation } from "./proposalRecovery";
import {
  isAgentTurnActive,
  reduceAgentProjectSwitch,
  type AgentProjectSwitchChoice,
  type AgentProjectSwitchState,
} from "./sessionService";
import { agentContextUsage } from "./usage";

const DEFAULT_OPERATION_TIMEOUT_MS = 8_000;
const SESSION_TITLE_MAX_LENGTH = 500;
const PROPOSAL_RECOVERY_RETRY_DELAYS_MS = [50, 150, 400, 1_000] as const;

export interface AgentProjectIdentity {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectPath: string;
}

export type AgentProjectView = Readonly<
  Pick<AgentProjectIdentity, "projectId" | "projectName">
>;

export interface AgentRuntimeConfiguration {
  readonly settings: AgentModelSettings;
  readonly capabilities: AgentModelCapabilities;
}

export interface AgentControllerScheduler {
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
}

export interface AgentSessionControllerDependencies {
  readonly runtime: AgentRuntimePort;
  readonly metadata: AgentMetadataStorePort;
  readonly workspace: AgentWorkspaceBridgePort & {
    subscribe?(listener: () => void): () => void;
    getSnapshot?(): ReturnType<AgentWorkspaceBridgePort["captureSnapshot"]> | null;
  };
  readonly proposalApplication?: AgentProposalApplicationPort;
  readonly configuration: () => Promise<AgentRuntimeConfiguration>;
  readonly now?: () => string;
  readonly scheduler?: AgentControllerScheduler;
  readonly operationTimeoutMs?: number;
}

export type AgentProjectSwitchView =
  | { readonly status: "none" }
  | {
      readonly status: "choosing" | "waiting" | "stopping";
      readonly targetProjectId: string;
      readonly targetProjectName: string;
    };

export interface AgentSessionControllerState {
  readonly project: AgentProjectView | null;
  readonly sessions: readonly AgentSessionMetadata[];
  readonly activeSessionId: string | null;
  readonly activeSession: AgentSessionMetadata | null;
  readonly events: AgentEventState | null;
  readonly draft: AgentDraft | null;
  readonly requestContext: AgentRequestContextDraft | null;
  readonly turnContexts: readonly AgentTurnContext[];
  readonly proposals: readonly AgentStoredProposal[];
  readonly preparedProposal: AgentPreparedProposal | null;
  readonly proposalEvents: readonly AgentProposalLifecycleEvent[];
  readonly proposalRecovery: readonly AgentProposalRecoveryOperation[];
  readonly proposalRecoveryStatus:
    | "inactive"
    | "recovering"
    | "ready"
    | "conflict"
    | "failed";
  readonly switchProject: AgentProjectSwitchView;
  readonly busy: boolean;
  readonly error: AgentErrorDetails | null;
  readonly autoScroll: Readonly<{
    following: boolean;
    hasNewContent: boolean;
  }>;
}

interface PendingProjectSwitch {
  readonly project: AgentProjectIdentity;
  readonly activate: () => void | Promise<void>;
  readonly generation: number;
}

const TOOL_POLICY: AgentRuntimeSessionConfig["toolPolicy"] = {
  allowedTools: [
    "get_project_summary",
    "read_text_blocks",
    "list_reference_images",
    "propose_text_block_edits",
  ],
  permissionMode: "request",
};

function defaultScheduler(): AgentControllerScheduler {
  if (
    typeof requestAnimationFrame === "function" &&
    typeof cancelAnimationFrame === "function"
  ) {
    return {
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (handle) => cancelAnimationFrame(handle),
    };
  }
  return {
    requestFrame(callback) {
      return globalThis.setTimeout(callback, 0) as unknown as number;
    },
    cancelFrame(handle) {
      globalThis.clearTimeout(handle);
    },
  };
}

function timeout<T>(
  operation: Promise<T>,
  milliseconds: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = globalThis.setTimeout(() => {
      reject(new Error(`${label} exceeded ${milliseconds} ms`));
    }, milliseconds);
    operation.then(
      (value) => {
        globalThis.clearTimeout(handle);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(handle);
        reject(error);
      },
    );
  });
}

function newestFirst(
  sessions: readonly AgentSessionMetadata[],
): readonly AgentSessionMetadata[] {
  return [...sessions].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.createdAt.localeCompare(left.createdAt) ||
    left.sessionId.localeCompare(right.sessionId)
  );
}

function normalizedTitle(title: string): string {
  const value = title.trim();
  if (!value || value.length > SESSION_TITLE_MAX_LENGTH) {
    throw new Error(
      `Agent session title must be between 1 and ${SESSION_TITLE_MAX_LENGTH} characters`,
    );
  }
  return value;
}

function eventSessionState(
  current: AgentSessionState,
  events: readonly AgentNormalizedEvent[],
): AgentSessionState {
  let next = current;
  for (const event of events) {
    if (
      event.type === "message_delta" ||
      event.type === "reasoning_delta" ||
      event.type === "tool_started" ||
      event.type === "compaction_started"
    ) {
      next = "running";
    } else if (event.type === "permission_requested") {
      next = "waiting_permission";
    } else if (event.type === "input_requested") {
      next = "waiting_user_input";
    } else if (
      event.type === "permission_resolved" ||
      event.type === "input_resolved"
    ) {
      next = "running";
    } else if (event.type === "session_idle") {
      next = "idle";
    } else if (event.type === "session_error") {
      next = "error";
    }
  }
  return next;
}

export class AgentSessionController {
  private readonly listeners = new Set<() => void>();
  private readonly runtime: AgentRuntimePort;
  private readonly metadata: AgentMetadataStorePort;
  private readonly workspace: AgentSessionControllerDependencies["workspace"];
  private readonly configuration: () => Promise<AgentRuntimeConfiguration>;
  private readonly now: () => string;
  private readonly scheduler: AgentControllerScheduler;
  private readonly operationTimeoutMs: number;
  private readonly proposalService: AgentProposalService | null;
  private readonly proposalApplication: AgentProposalApplicationPort | null;
  private state: AgentSessionControllerState;
  private unsubscribeRuntime: (() => void) | null = null;
  private unsubscribeWorkspace: (() => void) | null = null;
  private unsubscribeProposalReadiness: (() => void) | null = null;
  private pendingEvents: AgentNormalizedEvent[] = [];
  private readonly turnContextsBySession = new Map<
    string,
    readonly AgentTurnContext[]
  >();
  private frameHandle: number | null = null;
  private pendingSwitch: PendingProjectSwitch | null = null;
  private switchState: AgentProjectSwitchState = { status: "none" };
  private switchGeneration = 0;
  private currentProject: AgentProjectIdentity | null = null;
  private proposalRecoveryGeneration = 0;
  private proposalRecoveryAttempt = 0;
  private proposalRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private proposalRecoveryRun: {
    readonly projectId: string;
    readonly generation: number;
    readonly promise: Promise<void>;
  } | null = null;
  private disposed = false;

  constructor(dependencies: AgentSessionControllerDependencies) {
    this.runtime = dependencies.runtime;
    this.metadata = dependencies.metadata;
    this.workspace = dependencies.workspace;
    this.configuration = dependencies.configuration;
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.scheduler = dependencies.scheduler ?? defaultScheduler();
    this.operationTimeoutMs = dependencies.operationTimeoutMs ??
      DEFAULT_OPERATION_TIMEOUT_MS;
    this.state = {
      project: null,
      sessions: [],
      activeSessionId: null,
      activeSession: null,
      events: null,
      draft: null,
      requestContext: null,
      turnContexts: [],
      proposals: [],
      preparedProposal: null,
      proposalEvents: [],
      proposalRecovery: [],
      proposalRecoveryStatus: "inactive",
      switchProject: { status: "none" },
      busy: false,
      error: null,
      autoScroll: { following: true, hasNewContent: false },
    };
    this.proposalApplication = dependencies.proposalApplication ?? null;
    this.proposalService = this.proposalApplication
      ? new AgentProposalService({
          metadata: dependencies.metadata,
          application: this.proposalApplication,
          now: this.now,
        })
      : null;
    this.unsubscribeProposalReadiness =
      this.proposalApplication?.subscribeReadiness((readiness) => {
        if (
          readiness.projectId !== this.currentProject?.projectId ||
          this.state.proposalRecoveryStatus !== "recovering"
        ) {
          return;
        }
        if (readiness.status === "ready") {
          this.queueProposalRecovery(readiness.projectId);
        } else {
          this.suspendProposalRecovery();
        }
      }) ?? null;
    this.unsubscribeWorkspace = this.workspace.subscribe?.(() => {
      const snapshot = this.workspace.getSnapshot?.();
      if (
        !snapshot ||
        !this.state.requestContext ||
        snapshot.projectId !== this.state.project?.projectId
      ) {
        return;
      }
      this.replace({
        requestContext: reconcileAgentRequestContext(
          this.state.requestContext,
          snapshot,
        ),
      });
    }) ?? null;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AgentSessionControllerState => this.state;

  private replace(update: Partial<AgentSessionControllerState>): void {
    if (this.disposed) return;
    this.state = Object.freeze({ ...this.state, ...update });
    this.listeners.forEach((listener) => listener());
  }

  private setError(
    error: unknown,
    fallback: Parameters<typeof agentErrorDetails>[1],
  ): AgentErrorDetails {
    const details = agentErrorDetails(error, fallback);
    this.replace({ error: details, busy: false });
    return details;
  }

  private runtimeConfig(
    configuration: AgentRuntimeConfiguration,
    project = this.currentProject,
  ): AgentRuntimeSessionConfig {
    if (!project || !configuration.settings.modelId) {
      throw new Error("The assistant model or project is not configured");
    }
    return {
      projectId: project.projectId,
      projectPath: project.projectPath,
      modelId: configuration.settings.modelId,
      settings: configuration.settings,
      capabilities: configuration.capabilities,
      toolPolicy: TOOL_POLICY,
      continuePendingWork: false,
    };
  }

  private async detachActiveSession(
    disconnect: boolean,
    preserveError = false,
  ): Promise<void> {
    const sessionId = this.state.activeSessionId;
    this.unsubscribeRuntime?.();
    this.unsubscribeRuntime = null;
    if (sessionId && disconnect) {
      await timeout(
        this.runtime.disconnect(sessionId),
        this.operationTimeoutMs,
        "Agent session disconnect",
      );
      try {
        await this.metadata.updateSession({
          sessionId,
          state: "disconnected",
          ...(this.state.activeSession?.modelId
            ? { modelId: this.state.activeSession.modelId }
            : {}),
          ...(preserveError && this.state.activeSession?.lastError
            ? { lastError: this.state.activeSession.lastError }
            : {}),
        });
      } catch (error) {
        this.setError(error, { code: "store_failed", phase: "store" });
      }
    }
    this.pendingEvents = [];
    if (this.frameHandle !== null) {
      this.scheduler.cancelFrame(this.frameHandle);
      this.frameHandle = null;
    }
    this.replace({
      activeSessionId: null,
      activeSession: null,
      events: null,
      draft: null,
      requestContext: null,
      turnContexts: [],
      proposals: [],
      preparedProposal: null,
    });
  }

  private resetProposalRecoveryScope(): number {
    this.proposalRecoveryGeneration += 1;
    this.proposalRecoveryAttempt = 0;
    if (this.proposalRecoveryTimer !== null) {
      clearTimeout(this.proposalRecoveryTimer);
      this.proposalRecoveryTimer = null;
    }
    this.proposalRecoveryRun = null;
    return this.proposalRecoveryGeneration;
  }

  private suspendProposalRecovery(): void {
    this.proposalRecoveryGeneration += 1;
    this.proposalRecoveryAttempt = 0;
    if (this.proposalRecoveryTimer !== null) {
      clearTimeout(this.proposalRecoveryTimer);
      this.proposalRecoveryTimer = null;
    }
    this.proposalRecoveryRun = null;
  }

  private queueProposalRecovery(projectId: string, delayMs = 0): void {
    if (
      this.disposed ||
      this.currentProject?.projectId !== projectId ||
      this.state.proposalRecoveryStatus !== "recovering"
    ) {
      return;
    }
    const generation = this.proposalRecoveryGeneration;
    if (
      this.proposalRecoveryRun?.projectId === projectId &&
      this.proposalRecoveryRun.generation === generation
    ) {
      return;
    }
    if (this.proposalRecoveryTimer !== null) return;
    if (delayMs > 0) {
      this.proposalRecoveryTimer = setTimeout(() => {
        this.proposalRecoveryTimer = null;
        this.queueProposalRecovery(projectId);
      }, delayMs);
      return;
    }
    const promise = this.runQueuedProposalRecovery(projectId, generation);
    this.proposalRecoveryRun = { projectId, generation, promise };
  }

  private async runQueuedProposalRecovery(
    projectId: string,
    generation: number,
  ): Promise<void> {
    let retryDelay: number | undefined;
    try {
      const result = await this.recoverProposalOperations(projectId);
      if (
        generation !== this.proposalRecoveryGeneration ||
        this.currentProject?.projectId !== projectId
      ) {
        return;
      }
      if (result === "retryable") {
        retryDelay =
          PROPOSAL_RECOVERY_RETRY_DELAYS_MS[this.proposalRecoveryAttempt];
        this.proposalRecoveryAttempt += 1;
      }
    } catch (error) {
      if (
        generation !== this.proposalRecoveryGeneration ||
        this.currentProject?.projectId !== projectId
      ) {
        return;
      }
      this.setError(error, {
        code: "store_failed",
        phase: "proposal",
      });
      if (this.state.proposalRecoveryStatus !== "conflict") {
        this.replace({ proposalRecoveryStatus: "failed" });
      }
    } finally {
      if (
        this.proposalRecoveryRun?.projectId === projectId &&
        this.proposalRecoveryRun.generation === generation
      ) {
        this.proposalRecoveryRun = null;
      }
      if (
        retryDelay !== undefined &&
        generation === this.proposalRecoveryGeneration &&
        this.currentProject?.projectId === projectId
      ) {
        this.queueProposalRecovery(projectId, retryDelay);
      }
    }
  }

  private async loadProject(project: AgentProjectIdentity): Promise<void> {
    const generation = this.resetProposalRecoveryScope();
    this.currentProject = project;
    try {
      await this.metadata.adoptProject(project);
      const recovery = await this.metadata.listProposalRecovery(
        project.projectId,
      );
      const sessions = newestFirst(
        await this.metadata.listSessions(project.projectId),
      );
      if (
        generation !== this.proposalRecoveryGeneration ||
        this.currentProject?.projectId !== project.projectId
      ) {
        return;
      }
      const conflicts = recovery.filter((operation) =>
        operation.status === "conflict"
      );
      const pending = recovery.filter((operation) =>
        operation.status === "pending"
      );
      this.replace({
        project: {
          projectId: project.projectId,
          projectName: project.projectName,
        },
        sessions,
        proposalRecovery: recovery,
        proposalRecoveryStatus: conflicts.length > 0
          ? "conflict"
          : pending.length > 0
          ? "recovering"
          : "ready",
        error: conflicts.length > 0
          ? new AgentDomainError(
            "proposal_apply_conflict",
            "proposal",
            conflicts[0].error ??
              "A retained proposal recovery record conflicts with the current project",
          ).toDetails()
          : null,
        busy: false,
      });
      if (
        pending.length > 0 &&
        this.proposalApplication?.getReadiness(project.projectId).status ===
          "ready"
      ) {
        this.queueProposalRecovery(project.projectId);
      }
    } catch (error) {
      this.replace({
        project: {
          projectId: project.projectId,
          projectName: project.projectName,
        },
        sessions: [],
        proposalRecoveryStatus: "failed",
        busy: false,
      });
      this.setError(error, { code: "store_failed", phase: "store" });
    }

    void this.retryCleanupTombstones().catch((error) => {
      this.setError(error, { code: "store_failed", phase: "store" });
    });
  }

  private async recoverProposalOperations(
    projectId: string,
  ): Promise<"ready" | "retryable"> {
    if (!this.proposalService) return "ready";
    const results = await timeout(
      this.proposalService.recoverProject(projectId),
      this.operationTimeoutMs,
      "Proposal recovery",
    );
    const conflicts = results.flatMap((result) =>
      result.status === "conflict" ? [result.operation] : []
    );
    const retryable = results.flatMap((result) =>
      result.status === "retryable" ? [result.operation] : []
    );
    this.replace({
      proposalRecovery: [...conflicts, ...retryable],
      proposalRecoveryStatus: conflicts.length > 0
        ? "conflict"
        : retryable.length > 0
        ? "recovering"
        : "ready",
    });
    if (conflicts.length > 0) {
      throw new AgentDomainError(
        "proposal_apply_conflict",
        "proposal",
        conflicts[0].error ??
          "A retained proposal recovery record conflicts with the current project",
        {
          recovery:
            "Do not retry Apply or Undo until the conflicting project state has been inspected.",
        },
      );
    }
    return retryable.length > 0 ? "retryable" : "ready";
  }

  private async requireProposalRecoveryReady(projectId: string): Promise<void> {
    const readiness = this.proposalApplication?.getReadiness(projectId);
    if (
      this.state.proposalRecoveryStatus === "recovering" &&
      readiness?.status !== "ready"
    ) {
      throw new AgentProposalTemporaryError(
        readiness?.status === "loading"
          ? "PLAN_LOADING"
          : "PLAN_BRIDGE_NOT_READY",
        "Proposal recovery is waiting for the active plan",
      );
    }
    const result = await this.recoverProposalOperations(projectId);
    if (result === "retryable") {
      const operation = this.state.proposalRecovery[0];
      throw new AgentProposalTemporaryError(
        operation?.error?.includes("PLAN_LOADING")
          ? "PLAN_LOADING"
          : "PLAN_BRIDGE_NOT_READY",
        operation?.error ?? "Proposal recovery is waiting for the active plan",
      );
    }
  }

  async activateProject(
    project: AgentProjectIdentity,
    activate: () => void | Promise<void>,
  ): Promise<"activated" | "choice_required" | "already_queued"> {
    if (this.pendingSwitch) return "already_queued";
    if (this.state.project?.projectId === project.projectId) {
      await activate();
      return "activated";
    }
    if (this.state.busy) {
      this.pendingSwitch = {
        project,
        activate,
        generation: ++this.switchGeneration,
      };
      this.switchState = {
        status: "waiting",
        targetProjectId: project.projectId,
      };
      this.publishSwitch();
      return "choice_required";
    }
    const activeState = this.state.activeSession?.state ?? "idle";
    const transition = reduceAgentProjectSwitch(this.switchState, {
      type: "request",
      targetProjectId: project.projectId,
      sessionState: activeState,
    });
    this.switchState = transition.state;
    if (transition.effect.type === "show_choices") {
      this.pendingSwitch = {
        project,
        activate,
        generation: ++this.switchGeneration,
      };
      this.publishSwitch();
      return "choice_required";
    }
    await this.finishProjectSwitch({
      project,
      activate,
      generation: ++this.switchGeneration,
    });
    return "activated";
  }

  private publishSwitch(): void {
    const pending = this.pendingSwitch;
    if (!pending || this.switchState.status === "none") {
      this.replace({ switchProject: { status: "none" } });
      return;
    }
    this.replace({
      switchProject: {
        status: this.switchState.status,
        targetProjectId: pending.project.projectId,
        targetProjectName: pending.project.projectName,
      },
    });
  }

  async chooseProjectSwitch(choice: AgentProjectSwitchChoice): Promise<void> {
    const pending = this.pendingSwitch;
    if (!pending || this.switchState.status !== "choosing") return;
    const transition = reduceAgentProjectSwitch(this.switchState, {
      type: "choose",
      choice,
    });
    this.switchState = transition.state;
    if (choice === "cancel") {
      this.pendingSwitch = null;
      this.publishSwitch();
      return;
    }
    this.publishSwitch();
    if (transition.effect.type !== "abort_turn") return;

    const sessionId = this.state.activeSessionId;
    let stopError: AgentErrorDetails | null = null;
    if (sessionId) {
      this.replace({
        activeSession: this.state.activeSession
          ? { ...this.state.activeSession, state: "stopping" }
          : null,
      });
      try {
        await timeout(
          this.runtime.abort(sessionId),
          this.operationTimeoutMs,
          "Agent generation abort",
        );
      } catch (error) {
        stopError = this.setError(error, {
          code: "timeout",
          phase: "generation",
          retryable: true,
        });
      }
    }
    if (
      this.pendingSwitch?.generation === pending.generation &&
      this.switchState.status === "stopping"
    ) {
      await this.finishProjectSwitch(pending);
      if (stopError) this.replace({ error: stopError });
    }
  }

  cancelWaitingProjectSwitch(): void {
    if (this.switchState.status !== "waiting") return;
    this.switchState = reduceAgentProjectSwitch(this.switchState, {
      type: "cancel_wait",
    }).state;
    this.pendingSwitch = null;
    this.publishSwitch();
  }

  private async finishProjectSwitch(
    pending: PendingProjectSwitch,
    preserveError: AgentErrorDetails | null = null,
  ): Promise<void> {
    if (
      this.pendingSwitch &&
      this.pendingSwitch.generation !== pending.generation
    ) {
      return;
    }
    this.pendingSwitch = null;
    this.switchState = { status: "none" };
    this.publishSwitch();
    if (this.state.activeSessionId) {
      try {
        await this.detachActiveSession(true, true);
      } catch (error) {
        this.setError(error, {
          code: "timeout",
          phase: "session",
          retryable: true,
        });
        await this.detachActiveSession(false, true);
      }
    }
    this.resetProposalRecoveryScope();
    this.currentProject = null;
    this.replace({
      proposalRecovery: [],
      proposalRecoveryStatus: "inactive",
    });
    await pending.activate();
    await this.loadProject(pending.project);
    if (preserveError) this.replace({ error: preserveError });
  }

  private async settleBusyProjectSwitch(): Promise<void> {
    const pending = this.pendingSwitch;
    if (!pending || this.switchState.status !== "waiting") return;
    const preserveError = this.state.error;
    this.switchState = reduceAgentProjectSwitch(this.switchState, {
      type: "turn_settled",
    }).state;
    await this.finishProjectSwitch(pending, preserveError);
  }

  async createSession(title = "New conversation"): Promise<AgentSessionMetadata> {
    const project = this.currentProject;
    if (!project) throw new Error("No project is active");
    this.replace({ busy: true, error: null });
    let createdId: string | null = null;
    try {
      await this.requireProposalRecoveryReady(project.projectId);
      if (this.state.activeSessionId) await this.detachActiveSession(true);
      const configuration = await this.configuration();
      const runtimeResult = await this.runtime.createSession(
        this.runtimeConfig(configuration, project),
      );
      createdId = runtimeResult.sessionId;
      const metadata = await this.metadata.createSession({
        sessionId: createdId,
        projectId: project.projectId,
        title: normalizedTitle(title),
        state: "idle",
        modelId: configuration.settings.modelId ?? undefined,
      });
      await this.attachSession(metadata, false);
      return metadata;
    } catch (error) {
      if (createdId) {
        try {
          await this.runtime.deleteSession(createdId);
        } catch {
          await this.metadata.addCleanupTombstone({
            projectId: project.projectId,
            resourceKind: "copilot_session",
            resourceId: createdId,
            lastError: "Metadata creation failed after SDK session creation",
          });
        }
      }
      this.setError(error, {
        code: "session_create_failed",
        phase: "session",
        retryable: true,
      });
      throw error;
    } finally {
      await this.settleBusyProjectSwitch();
    }
  }

  async resumeSession(sessionId: string): Promise<void> {
    const session = this.state.sessions.find(
      (candidate) => candidate.sessionId === sessionId,
    );
    if (!session || session.projectId !== this.state.project?.projectId) {
      throw new Error("Agent session does not belong to the active project");
    }
    this.replace({ busy: true, error: null });
    try {
      await this.requireProposalRecoveryReady(session.projectId);
      if (
        this.state.activeSessionId &&
        this.state.activeSessionId !== sessionId
      ) {
        await this.detachActiveSession(true);
      } else if (this.state.activeSessionId === sessionId) {
        await this.detachActiveSession(false);
      }
      const configuration = await this.configuration();
      await this.runtime.resumeSession(
        sessionId,
        this.runtimeConfig(configuration),
      );
      const interrupted = isAgentTurnActive(session.state);
      const updated = await this.metadata.updateSession({
        sessionId,
        state: "idle",
        modelId: configuration.settings.modelId ?? undefined,
        ...(interrupted ? { interruptedAt: this.now() } : {}),
      });
      await this.attachSession(updated, true);
    } catch (error) {
      const details = this.setError(error, {
        code: "session_resume_failed",
        phase: "session",
        retryable: true,
      });
      await this.metadata.updateSession({
        sessionId,
        state: "error",
        ...(session.modelId ? { modelId: session.modelId } : {}),
        lastError: details,
      });
      throw error;
    } finally {
      await this.settleBusyProjectSwitch();
    }
  }

  private async attachSession(
    session: AgentSessionMetadata,
    interruptPending: boolean,
  ): Promise<void> {
    let events = createAgentEventState(session.sessionId);
    for (const event of await this.runtime.getEvents(session.sessionId)) {
      events = reduceAgentEvent(events, event);
    }
    if (interruptPending) {
      events = interruptAgentPendingInteractions(events);
    }
    const draft = await this.metadata.readDraft(session.sessionId);
    const proposals = await this.metadata.listProposals(session.sessionId, 50);
    const snapshot = this.workspace.captureSnapshot();
    const requestContext = createAgentRequestContext(snapshot);
    this.unsubscribeRuntime = await this.runtime.subscribe(
      session.sessionId,
      (event) => this.enqueueEvent(event),
    );
    const sessions = newestFirst([
      session,
      ...this.state.sessions.filter(
        (candidate) => candidate.sessionId !== session.sessionId,
      ),
    ]);
    this.replace({
      sessions,
      activeSessionId: session.sessionId,
      activeSession: session,
      events,
      draft,
      requestContext,
      turnContexts: this.turnContextsBySession.get(session.sessionId) ?? [],
      proposals,
      preparedProposal: null,
      busy: false,
      error: null,
    });
  }

  private enqueueEvent(event: AgentNormalizedEvent): void {
    if (event.sessionId !== this.state.activeSessionId) return;
    this.pendingEvents.push(event);
    if (this.frameHandle !== null) return;
    this.frameHandle = this.scheduler.requestFrame(() => {
      this.frameHandle = null;
      this.flushEvents();
    });
  }

  private flushEvents(): void {
    const batch = this.pendingEvents;
    this.pendingEvents = [];
    if (!this.state.events || !this.state.activeSession) return;
    let events = this.state.events;
    for (const event of batch) events = reduceAgentEvent(events, event);
    const nextState = eventSessionState(this.state.activeSession.state, batch);
    const lastError = [...batch].reverse().find(
      (event) => event.type === "session_error",
    );
    const activeSession: AgentSessionMetadata = {
      ...this.state.activeSession,
      state: nextState,
      updatedAt: this.now(),
      ...(lastError?.type === "session_error"
        ? { lastError: lastError.error }
        : {}),
    };
    const hasVisibleContent = batch.some((event) =>
      event.type === "message_delta" ||
      event.type === "message_completed" ||
      event.type === "reasoning_delta" ||
      event.type === "reasoning_completed" ||
      event.type === "tool_started" ||
      event.type === "tool_progress" ||
      event.type === "tool_completed" ||
      event.type === "permission_requested" ||
      event.type === "input_requested" ||
      event.type === "compaction_started" ||
      event.type === "compaction_completed" ||
      event.type === "session_error"
    );
    this.replace({
      events,
      activeSession,
      sessions: newestFirst([
        activeSession,
        ...this.state.sessions.filter(
          (session) => session.sessionId !== activeSession.sessionId,
        ),
      ]),
      autoScroll: {
        ...this.state.autoScroll,
        hasNewContent: hasVisibleContent && !this.state.autoScroll.following,
      },
      ...(lastError?.type === "session_error"
        ? { error: lastError.error }
        : {}),
    });
    void this.persistEventSummary(activeSession, events);
    if (
      batch.some((event) =>
        event.type === "tool_completed" &&
        events.tools.some((tool) =>
          tool.toolCallId === event.toolCallId &&
          tool.toolName === "propose_text_block_edits" &&
          tool.status === "succeeded"
        )
      )
    ) {
      void this.refreshProposals("drafted");
    }
    if (
      (nextState === "idle" || nextState === "error") &&
      (this.switchState.status === "waiting" ||
        this.switchState.status === "stopping") &&
      this.pendingSwitch
    ) {
      const pending = this.pendingSwitch;
      const preserveError = nextState === "error" ? this.state.error : null;
      this.switchState = reduceAgentProjectSwitch(this.switchState, {
        type: "turn_settled",
      }).state;
      void this.finishProjectSwitch(pending, preserveError);
    }
  }

  private async persistEventSummary(
    session: AgentSessionMetadata,
    events: AgentEventState,
  ): Promise<void> {
    try {
      await this.metadata.updateSession({
        sessionId: session.sessionId,
        state: session.state,
        ...(session.modelId ? { modelId: session.modelId } : {}),
        ...(session.lastError ? { lastError: session.lastError } : {}),
      });
      if (events.sessionUsage) {
        await this.metadata.updateUsage(
          session.sessionId,
          events.sessionUsage,
          events.context
            ? agentContextUsage(
              events.context.usedTokens,
              events.context.limitTokens,
            )
            : undefined,
        );
      }
    } catch (error) {
      this.setError(error, { code: "store_failed", phase: "store" });
    }
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    const updated = await this.metadata.renameSession(
      sessionId,
      normalizedTitle(title),
    );
    this.replace({
      sessions: newestFirst([
        updated,
        ...this.state.sessions.filter(
          (session) => session.sessionId !== sessionId,
        ),
      ]),
      ...(this.state.activeSessionId === sessionId
        ? { activeSession: updated }
        : {}),
    });
  }

  async writeDraft(text: string): Promise<void> {
    if (!this.state.activeSessionId) {
      throw new Error("No agent session is active");
    }
    const draft = await this.metadata.writeDraft(
      this.state.activeSessionId,
      text,
    );
    this.replace({ draft });
  }

  removeContextChip(chipId: string): void {
    if (!this.state.requestContext) return;
    const attachment = this.state.requestContext.attachment;
    if (chipId.startsWith("image:") && attachment) {
      this.workspace.revokeAttachment({
        kind: attachment.kind,
        projectId: attachment.projectId,
        groupId: attachment.groupId,
        imageId: attachment.imageId,
        displayName: attachment.displayName,
        pinned: attachment.pinned,
      });
    }
    this.replace({
      requestContext: removeAgentContextChip(
        this.state.requestContext,
        chipId,
      ),
    });
  }

  setAttachmentPinned(pinned: boolean): void {
    if (!this.state.requestContext) return;
    this.replace({
      requestContext: setRequestImageAttachmentPinned(
        this.state.requestContext,
        pinned,
      ),
    });
  }

  navigateCitation(
    citation: AgentCitation,
    openImage = true,
  ): AgentCitationNavigationResult {
    return citation.kind === "block"
      ? this.workspace.navigateToBlock(citation)
      : this.workspace.navigateToImage(citation, openImage);
  }

  private appendProposalEvent(
    event: Omit<AgentProposalLifecycleEvent, "eventId" | "occurredAt">,
  ): void {
    const next = Object.freeze({
      ...event,
      eventId: crypto.randomUUID(),
      occurredAt: this.now(),
    });
    this.replace({
      proposalEvents: [...this.state.proposalEvents, next].slice(-100),
    });
  }

  private async refreshProposals(
    lifecycle?: AgentProposalLifecycleEvent["kind"],
  ): Promise<void> {
      const sessionId = this.state.activeSessionId;
      if (!sessionId) return;
      const previousIds = new Set(
        this.state.proposals.map((proposal) => proposal.proposalId),
      );
      const proposals = await this.metadata.listProposals(sessionId, 50);
      this.replace({ proposals });
      if (lifecycle) {
        for (const proposal of proposals) {
          if (previousIds.has(proposal.proposalId)) continue;
          this.appendProposalEvent({
            sessionId,
            proposalId: proposal.proposalId,
            kind: lifecycle,
            operationCount: proposal.operationCount,
          });
        }
      }
    }

  async prepareProposal(proposalId: string) {
      if (
        !this.proposalService ||
        !this.state.project ||
        !this.state.activeSessionId
      ) {
        throw new Error("Proposal application is unavailable");
      }
      const result = await this.proposalService.prepare(
        this.state.project.projectId,
        this.state.activeSessionId,
        proposalId,
      );
      if (result.status === "ready") {
        this.replace({ preparedProposal: result.prepared });
      } else if (result.status === "stale") {
        this.replace({ preparedProposal: null });
        await this.refreshProposals();
        this.appendProposalEvent({
          sessionId: this.state.activeSessionId,
          proposalId,
          kind: "stale",
          operationCount: this.state.proposals.find(
            (proposal) => proposal.proposalId === proposalId,
          )?.operationCount ?? 0,
          documentRevision: result.currentRevision,
          documentHash: result.currentDocumentHash,
        });
      }
      return result;
    }

  async applyProposal(
    proposalId: string,
    confirmDeletion = false,
  ): Promise<AgentProposalApplyIntentResult> {
      if (
        !this.proposalService ||
        !this.state.project ||
        !this.state.activeSessionId
      ) {
        throw new Error("Proposal application is unavailable");
      }
      const sessionId = this.state.activeSessionId;
      const result = await this.proposalService.apply(
        this.state.project.projectId,
        sessionId,
        proposalId,
        confirmDeletion,
      );
      if (result.status === "applied") {
        this.replace({ preparedProposal: null });
        await this.refreshProposals();
        this.appendProposalEvent({
          sessionId,
          proposalId,
          kind: "applied",
          operationCount: this.state.proposals.find(
            (proposal) => proposal.proposalId === proposalId,
          )?.operationCount ?? 0,
          documentRevision: result.revision,
          documentHash: result.documentHash,
        });
      } else if (result.status === "stale") {
        this.replace({ preparedProposal: null });
        await this.refreshProposals();
        this.appendProposalEvent({
          sessionId,
          proposalId,
          kind: "stale",
          operationCount: this.state.proposals.find(
            (proposal) => proposal.proposalId === proposalId,
          )?.operationCount ?? 0,
          documentRevision: result.currentRevision,
          documentHash: result.currentDocumentHash,
        });
      }
      return result;
    }

  async discardProposal(proposalId: string): Promise<void> {
      if (!this.proposalService || !this.state.activeSessionId) {
        throw new Error("Proposal application is unavailable");
      }
      const sessionId = this.state.activeSessionId;
      const operationCount = this.state.proposals.find(
        (proposal) => proposal.proposalId === proposalId,
      )?.operationCount ?? 0;
      await this.proposalService.discard(sessionId, proposalId);
      this.replace({ preparedProposal: null });
      await this.refreshProposals();
      this.appendProposalEvent({
        sessionId,
        proposalId,
        kind: "discarded",
        operationCount,
      });
    }

  async askProposalRevision(
    proposalId: string,
    feedback: string,
  ): Promise<void> {
      if (
        !this.proposalService ||
        !this.state.project ||
        !this.state.activeSessionId
      ) {
        throw new Error("Proposal application is unavailable");
      }
      const sessionId = this.state.activeSessionId;
      const context = await this.proposalService.revisionContext(
        this.state.project.projectId,
        sessionId,
        proposalId,
        feedback,
      );
      await this.send(
        `[Preshot proposal revision request]\n${JSON.stringify(context)}`,
      );
      this.appendProposalEvent({
        sessionId,
        proposalId,
        kind: "updated",
        operationCount: context.proposal.operations.length,
        documentRevision: context.currentRevision,
        documentHash: context.currentDocumentHash,
      });
    }

  async undoProposalApply(): Promise<AgentProposalUndoIntentResult> {
      if (
        !this.proposalService ||
        !this.state.project ||
        !this.state.activeSessionId
      ) {
        return { status: "unavailable" };
      }
      const sessionId = this.state.activeSessionId;
      const result = await this.proposalService.undo(
        this.state.project.projectId,
        sessionId,
      );
      if (result.status === "undone") {
        await this.refreshProposals();
        this.appendProposalEvent({
          sessionId,
          proposalId: result.proposalId,
          kind: "undone",
          operationCount: this.state.proposals.find(
            (proposal) => proposal.proposalId === result.proposalId,
          )?.operationCount ?? 0,
          documentRevision: result.revision,
          documentHash: result.documentHash,
        });
      }
      return result;
    }
  async send(
    text: string,
    options: { readonly includeAttachment?: boolean } = {},
  ): Promise<void> {
    if (
      !this.state.activeSession ||
      !this.state.requestContext ||
      isAgentTurnActive(this.state.activeSession.state)
    ) {
      throw new Error("The active agent session cannot accept a message");
    }
    const turn = captureAgentTurnContext(
      options.includeAttachment === false
        ? { ...this.state.requestContext, attachment: null }
        : this.state.requestContext,
      this.now(),
    );
    const session = {
      ...this.state.activeSession,
      state: "running" as const,
      updatedAt: this.now(),
    };
    const turnContexts = [...this.state.turnContexts, turn].slice(-500);
    this.turnContextsBySession.set(session.sessionId, turnContexts);
    this.replace({
      activeSession: session,
      error: null,
      turnContexts,
      autoScroll: { following: true, hasNewContent: false },
    });
    try {
      await this.runtime.send({
        sessionId: session.sessionId,
        text,
        context: turn.receipt,
        attachment: turn.attachment,
      });
      await this.metadata.updateSession({
        sessionId: session.sessionId,
        state: "running",
        ...(session.modelId ? { modelId: session.modelId } : {}),
      });
    } catch (error) {
      this.turnContextsBySession.set(
        session.sessionId,
        this.state.turnContexts.filter((candidate) => candidate !== turn),
      );
      const details = this.setError(error, {
        code: "attachment_unavailable",
        phase: "generation",
        retryable: true,
      });
      const failed = await this.metadata.updateSession({
        sessionId: session.sessionId,
        state: "error",
        ...(session.modelId ? { modelId: session.modelId } : {}),
        lastError: details,
      });
      this.replace({
        activeSession: failed,
        turnContexts: this.turnContextsBySession.get(session.sessionId) ?? [],
      });
      throw error;
    }
  }

  async abort(): Promise<void> {
    if (!this.state.activeSessionId || !this.state.activeSession) return;
    const sessionId = this.state.activeSessionId;
    this.replace({
      activeSession: { ...this.state.activeSession, state: "stopping" },
    });
    await timeout(
      this.runtime.abort(sessionId),
      this.operationTimeoutMs,
      "Agent generation abort",
    );
  }

  async resolvePermission(
    requestId: string,
    decision: "allowed" | "denied",
  ): Promise<void> {
    if (!this.state.activeSessionId) return;
    await this.runtime.resolvePermission(
      this.state.activeSessionId,
      requestId,
      decision,
    );
  }

  async resolveInput(
    requestId: string,
    value: string | null,
  ): Promise<void> {
    if (!this.state.activeSessionId) return;
    await this.runtime.resolveInput(
      this.state.activeSessionId,
      requestId,
      value,
    );
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = this.state.sessions.find(
      (candidate) => candidate.sessionId === sessionId,
    );
    if (!session) return;
    if (this.state.activeSessionId === sessionId) {
      if (isAgentTurnActive(session.state)) {
        await timeout(
          this.runtime.abort(sessionId),
          this.operationTimeoutMs,
          "Agent generation abort",
        );
      }
      await this.detachActiveSession(true);
    }
    await this.runtime.deleteSession(sessionId);
    await this.metadata.deleteSession(sessionId);
    this.turnContextsBySession.delete(sessionId);
    this.replace({
      sessions: this.state.sessions.filter(
        (candidate) => candidate.sessionId !== sessionId,
      ),
    });
  }

  async countProjectSessions(projectId: string): Promise<number> {
    return (await this.metadata.listSessions(projectId)).length;
  }

  async deleteProject(projectId: string): Promise<{
    readonly sessionCount: number;
    readonly cleanupPending: number;
  }> {
    const sessions = await this.metadata.listSessions(projectId);
    let cleanupPending = 0;
    if (
      this.state.activeSessionId &&
      sessions.some(
        (session) => session.sessionId === this.state.activeSessionId,
      )
    ) {
      if (isAgentTurnActive(this.state.activeSession?.state ?? "idle")) {
        try {
          await timeout(
            this.runtime.abort(this.state.activeSessionId),
            this.operationTimeoutMs,
            "Agent generation abort",
          );
        } catch {
          // Deletion continues through forced disconnect and cleanup tombstones.
        }
      }
      try {
        await this.detachActiveSession(true);
      } catch {
        await this.detachActiveSession(false);
      }
    }
    for (const session of sessions) {
      this.turnContextsBySession.delete(session.sessionId);
      try {
        await timeout(
          this.runtime.deleteSession(session.sessionId),
          this.operationTimeoutMs,
          "Agent session deletion",
        );
      } catch (error) {
        cleanupPending += 1;
        await this.metadata.addCleanupTombstone({
          projectId,
          resourceKind: "copilot_session",
          resourceId: session.sessionId,
          lastError: error instanceof Error ? error.message : String(error),
        });
      }
    }
    await this.metadata.deleteProject(projectId);
    if (this.state.project?.projectId === projectId) {
      this.currentProject = null;
      this.replace({
        project: null,
        sessions: [],
        activeSessionId: null,
        activeSession: null,
        events: null,
        draft: null,
        requestContext: null,
        turnContexts: [],
        proposals: [],
        preparedProposal: null,
      });
    }
    return { sessionCount: sessions.length, cleanupPending };
  }

  async retryCleanupTombstones(): Promise<void> {
    const tombstones = await this.metadata.listCleanupTombstones(100);
    for (const tombstone of tombstones) {
      try {
        await timeout(
          this.runtime.deleteSession(tombstone.resourceId),
          this.operationTimeoutMs,
          "Agent cleanup retry",
        );
        await this.metadata.removeCleanupTombstone(tombstone.tombstoneId);
      } catch (error) {
        await this.metadata.retryCleanupTombstone(
          tombstone.tombstoneId,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  setAutoScrollFollowing(following: boolean): void {
    this.replace({
      autoScroll: {
        following,
        hasNewContent: following ? false : this.state.autoScroll.hasNewContent,
      },
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.resetProposalRecoveryScope();
    this.unsubscribeProposalReadiness?.();
    this.unsubscribeProposalReadiness = null;
    this.unsubscribeWorkspace?.();
    this.unsubscribeWorkspace = null;
    this.unsubscribeRuntime?.();
    this.unsubscribeRuntime = null;
    if (this.frameHandle !== null) {
      this.scheduler.cancelFrame(this.frameHandle);
      this.frameHandle = null;
    }
    this.disposed = true;
    this.turnContextsBySession.clear();
  }
}
