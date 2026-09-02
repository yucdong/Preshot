import { describe, expect, it, vi } from "vitest";
import { FakeAgentRuntime } from "../../infrastructure/agent/fakeAgentRuntime";
import { MemoryAttachmentTokenResolver } from "../../infrastructure/agent/memoryAttachmentTokenResolver";
import { createMemoryAgentMetadataStore } from "../../infrastructure/agent/memoryAgentMetadataStore";
import type {
  PreshotBlockDocument,
  ProjectPlanV14,
} from "../plan/canvas/blockDocument";
import type { AgentWorkspaceBridgePort } from "./ports";
import {
  DEFAULT_AGENT_MODEL_CAPABILITIES,
  DEFAULT_AGENT_MODEL_SETTINGS,
} from "./settings";
import type { AgentWorkspaceSnapshot } from "./models";
import { AgentSessionController, type AgentControllerScheduler } from "./controller";
import {
  createAgentTextEditProposal,
  hashPreshotBlock,
  hashPreshotDocument,
} from "./proposal";
import { createAgentWorkspaceStore } from "./workspaceBridge";
import { AgentProposalTemporaryError } from "./errors";

const PROJECT_ONE = {
  projectId: "project-1",
  projectName: "Project One",
  projectPath: "C:\\Projects\\One",
};
const PROJECT_TWO = {
  projectId: "project-2",
  projectName: "Project Two",
  projectPath: "C:\\Projects\\Two",
};

class ManualScheduler implements AgentControllerScheduler {
  private callbacks = new Map<number, () => void>();
  private sequence = 0;

  requestFrame(callback: () => void): number {
    const id = ++this.sequence;
    this.callbacks.set(id, callback);
    return id;
  }

  cancelFrame(handle: number): void {
    this.callbacks.delete(handle);
  }

  flush(): void {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    callbacks.forEach((callback) => callback());
  }
}

function workspace(): AgentWorkspaceBridgePort {
  const snapshot: AgentWorkspaceSnapshot = Object.freeze({
    projectId: PROJECT_ONE.projectId,
    projectName: PROJECT_ONE.projectName,
    projectHandle: "project_handle",
    documentRevision: 7,
    documentHash: `sha256:${"a".repeat(64)}`,
    selectedBlockIds: Object.freeze(["block-1"]),
    cursorBlockId: "block-1",
    saveState: "saved",
  });
  return {
    captureSnapshot: () => snapshot,
    issueAttachment: () => "attachment-token",
    revokeAttachment: vi.fn(),
    readTextBlocks: (_captured, blockIds) =>
      blockIds.map((blockId) => ({
        blockId,
        blockHash: `sha256:${"b".repeat(64)}`,
        type: "paragraph",
        text: "Immutable workspace text",
      })),
    navigateToBlock: () => ({ status: "navigated" }),
    navigateToImage: () => ({ status: "navigated" }),
  };
}

function readyConfiguration() {
  return {
    settings: {
      ...DEFAULT_AGENT_MODEL_SETTINGS,
      enabled: true,
      modelId: "fake-model",
    },
    capabilities: {
      ...DEFAULT_AGENT_MODEL_CAPABILITIES,
      responsesApi: "verified" as const,
      streaming: "verified" as const,
      customTools: "verified" as const,
    },
  };
}

function harness(
  runtime = new FakeAgentRuntime(),
  workspaceOverride: AgentWorkspaceBridgePort = workspace(),
) {
  const scheduler = new ManualScheduler();
  let now = 0;
  const metadata = createMemoryAgentMetadataStore({
    now: () => new Date(++now * 1_000).toISOString(),
  });
  const controller = new AgentSessionController({
    runtime,
    metadata,
    workspace: workspaceOverride,
    scheduler,
    configuration: async () => readyConfiguration(),
    now: () => new Date(++now * 1_000).toISOString(),
    operationTimeoutMs: 10,
  });
  return { controller, metadata, runtime, scheduler };
}

async function activate(
  controller: AgentSessionController,
  project = PROJECT_ONE,
): Promise<void> {
  await controller.activateProject(project, vi.fn());
}

const recoveryDocument = (text: string): PreshotBlockDocument => ({
  format: "preshot-blocks",
  version: 2,
  blocks: [{
    id: "recovery-block",
    type: "paragraph",
    props: {},
    content: [{ type: "text", text, styles: {} }],
    children: [],
  }],
});

async function seedProposalRecovery(
  metadata: ReturnType<typeof createMemoryAgentMetadataStore>,
) {
  const before: ProjectPlanV14 = {
    schemaVersion: 14,
    title: PROJECT_ONE.projectName,
    document: recoveryDocument("Before recovery"),
    imageGroups: [],
  };
  const after: ProjectPlanV14 = {
    ...before,
    document: recoveryDocument("After recovery"),
  };
  await metadata.adoptProject(PROJECT_ONE);
  await metadata.createSession({
    sessionId: "recovery-session",
    projectId: PROJECT_ONE.projectId,
    title: "Recovery",
    state: "idle",
  });
  const proposal = createAgentTextEditProposal({
    proposalId: "recovery-proposal",
    sessionId: "recovery-session",
    baseRevision: 1,
    baseDocumentHash: hashPreshotDocument(before.document),
  }, {
    summary: "Recover a staged proposal",
    operations: [{
      op: "update",
      blockId: "recovery-block",
      expectedBlockHash: hashPreshotBlock(before.document.blocks[0]),
      patch: { text: "After recovery" },
    }],
  });
  await metadata.createProposal(proposal);
  await metadata.beginProposalRecovery({
    operationId: "recovery-operation",
    kind: "apply",
    proposalId: proposal.proposalId,
    sessionId: proposal.sessionId,
    projectId: PROJECT_ONE.projectId,
    beforeDocumentHash: proposal.baseDocumentHash,
    beforeRevision: 1,
    afterDocumentHash: hashPreshotDocument(after.document),
    afterRevision: 2,
    checkpoint: {
      checkpointId: "recovery-checkpoint",
      proposalId: proposal.proposalId,
      sessionId: proposal.sessionId,
      projectId: PROJECT_ONE.projectId,
      beforeRevision: 1,
      beforeDocumentHash: proposal.baseDocumentHash,
      appliedRevision: 2,
      appliedDocumentHash: hashPreshotDocument(after.document),
      beforePlan: before,
      changes: [{
        kind: "restore",
        blockId: "recovery-block",
        beforeBlock: before.document.blocks[0],
        appliedBlockHash: hashPreshotBlock(after.document.blocks[0]),
      }],
    },
    finalization: {
      status: "applied",
      finalizedAt: "2026-08-22T00:00:00.000Z",
      revision: 2,
      documentHash: hashPreshotDocument(after.document),
    },
  });
  return { after, before };
}

function recoveryController(
  metadata: ReturnType<typeof createMemoryAgentMetadataStore>,
  store: ReturnType<typeof createAgentWorkspaceStore>,
) {
  return new AgentSessionController({
    runtime: new FakeAgentRuntime(),
    metadata,
    workspace: store,
    proposalApplication: store,
    configuration: async () => readyConfiguration(),
    operationTimeoutMs: 1_000,
  });
}

describe("AgentSessionController", () => {
  it.each([
    ["after", "applied"],
    ["before", "staged"],
  ] as const)(
    "waits for provider readiness and reconciles the %s hash boundary",
    async (boundary, expectedStatus) => {
      const metadata = createMemoryAgentMetadataStore();
      const plans = await seedProposalRecovery(metadata);
      const store = createAgentWorkspaceStore(
        new MemoryAttachmentTokenResolver(),
      );
      const controller = recoveryController(metadata, store);

      await controller.activateProject(PROJECT_ONE, () => {
        store.activateProject(PROJECT_ONE);
      });
      expect(controller.getSnapshot()).toMatchObject({
        proposalRecoveryStatus: "recovering",
        proposalRecovery: [{ status: "pending" }],
      });

      const currentPlan = boundary === "after" ? plans.after : plans.before;
      const revision = boundary === "after" ? 2 : 1;
      store.publishDocument({
        document: currentPlan.document,
        revision,
        saveState: "saved",
      });
      const getCurrentPlan = vi.fn(async () => ({
        plan: currentPlan,
        revision,
      }));
      const registration = store.registerProposalApplication(
        PROJECT_ONE.projectId,
        {
          getCurrentPlan,
          applyAtomically: vi.fn(),
          restoreCheckpointAtomically: vi.fn(),
          rollbackAtomically: vi.fn(),
        },
      );
      registration.setReady(true);
      registration.setReady(true);

      await vi.waitFor(() => {
        expect(controller.getSnapshot().proposalRecoveryStatus).toBe("ready");
      });
      expect(getCurrentPlan).toHaveBeenCalledTimes(1);
      expect(await metadata.listProposalRecovery(PROJECT_ONE.projectId))
        .toEqual([]);
      expect((await metadata.listProposals("recovery-session"))[0].status)
        .toBe(expectedStatus);
      await controller.dispose();
    },
  );

  it("retries typed plan unavailability with bounded backoff", async () => {
    const metadata = createMemoryAgentMetadataStore();
    const { after } = await seedProposalRecovery(metadata);
    const store = createAgentWorkspaceStore(new MemoryAttachmentTokenResolver());
    const controller = recoveryController(metadata, store);
    await controller.activateProject(PROJECT_ONE, () => {
      store.activateProject(PROJECT_ONE);
    });
    store.publishDocument({
      document: after.document,
      revision: 2,
      saveState: "saved",
    });
    const getCurrentPlan = vi.fn()
      .mockRejectedValueOnce(
        new AgentProposalTemporaryError(
          "PLAN_BRIDGE_NOT_READY",
          "editor mounting",
        ),
      )
      .mockRejectedValueOnce(
        new AgentProposalTemporaryError("PLAN_LOADING", "plan hydrating"),
      )
      .mockResolvedValue({ plan: after, revision: 2 });
    const registration = store.registerProposalApplication(
      PROJECT_ONE.projectId,
      {
        getCurrentPlan,
        applyAtomically: vi.fn(),
        restoreCheckpointAtomically: vi.fn(),
        rollbackAtomically: vi.fn(),
      },
    );
    registration.setReady(true);

    await vi.waitFor(() => {
      expect(controller.getSnapshot().proposalRecoveryStatus).toBe("ready");
    }, { timeout: 2_000 });
    expect(getCurrentPlan).toHaveBeenCalledTimes(3);
    expect(await metadata.listProposalRecovery(PROJECT_ONE.projectId))
      .toEqual([]);
    await controller.dispose();
  });

  it("cancels an old pending recovery when the project switches", async () => {
    const metadata = createMemoryAgentMetadataStore();
    const { after } = await seedProposalRecovery(metadata);
    const store = createAgentWorkspaceStore(new MemoryAttachmentTokenResolver());
    const controller = recoveryController(metadata, store);
    await controller.activateProject(PROJECT_ONE, () => {
      store.activateProject(PROJECT_ONE);
    });
    store.publishDocument({
      document: after.document,
      revision: 2,
      saveState: "saved",
    });
    const getCurrentPlan = vi.fn(async () => ({ plan: after, revision: 2 }));
    const oldRegistration = store.registerProposalApplication(
      PROJECT_ONE.projectId,
      {
        getCurrentPlan,
        applyAtomically: vi.fn(),
        restoreCheckpointAtomically: vi.fn(),
        rollbackAtomically: vi.fn(),
      },
    );

    await controller.activateProject(PROJECT_TWO, () => {
      store.activateProject(PROJECT_TWO);
    });
    oldRegistration.setReady(true);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(controller.getSnapshot()).toMatchObject({
      project: { projectId: PROJECT_TWO.projectId },
      proposalRecoveryStatus: "ready",
    });
    expect(getCurrentPlan).not.toHaveBeenCalled();
    expect(await metadata.listProposalRecovery(PROJECT_ONE.projectId))
      .toHaveLength(1);
    await controller.dispose();
  });

  it("creates newest-first history, persists drafts, resumes, renames, and deletes", async () => {
    const { controller, metadata } = harness();
    await activate(controller);
    const first = await controller.createSession("First");
    await controller.writeDraft("remember this");
    const second = await controller.createSession("Second");

    expect(controller.getSnapshot().sessions.map((session) => session.title))
      .toEqual(["Second", "First"]);
    await controller.renameSession(first.sessionId, "Renamed");
    await controller.resumeSession(first.sessionId);
    expect(controller.getSnapshot().activeSession?.title).toBe("Renamed");
    expect(controller.getSnapshot().draft?.text).toBe("remember this");

    await controller.deleteSession(second.sessionId);
    expect(await metadata.listSessions(PROJECT_ONE.projectId)).toHaveLength(1);
  });

  it("coalesces streaming events, deduplicates replay, bounds output, and persists usage/context", async () => {
    const runtime = new FakeAgentRuntime({
      onSend: async (_request, emit) => {
        emit({
          type: "message_delta",
          messageId: "assistant-1",
          role: "assistant",
          delta: "A",
        });

        emit({
          type: "message_delta",
          messageId: "assistant-1",
          role: "assistant",
          delta: "B",
        });
        emit({
          type: "tool_completed",
          toolCallId: "tool-1",
          status: "succeeded",
          output: "x".repeat(20_000),
        });
        emit({
          type: "usage",
          scope: "session",
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            reasoningTokens: 2,
            cacheReadTokens: 1,
            cacheWriteTokens: 0,
            requestCount: 1,
          },
        });
        emit({ type: "context", usedTokens: 18, limitTokens: 100 });
        emit({ type: "session_idle" });
      },
    });
    const { controller, scheduler, metadata } = harness(runtime);
    await activate(controller);
    const session = await controller.createSession();
    const notifications = vi.fn();
    controller.subscribe(notifications);
    const before = notifications.mock.calls.length;

    await controller.send("Hello");
    expect(notifications.mock.calls.length - before).toBe(1);
    scheduler.flush();

    const state = controller.getSnapshot();
    expect(state.events?.messages.at(-1)?.content).toBe("AB");
    expect(state.events?.tools[0].output).toHaveLength(16_000);
    expect(state.events?.context).toEqual({
      usedTokens: 18,
      limitTokens: 100,
    });
    expect(state.activeSession?.state).toBe("idle");
    await Promise.resolve();
    expect((await metadata.listSessions(PROJECT_ONE.projectId))[0].usage)
      .toMatchObject({ inputTokens: 10, requestCount: 1 });
    expect(session.sessionId).toBe(state.activeSessionId);

    controller.setAutoScrollFollowing(false);
    runtime.emit(session.sessionId, {
      type: "message_completed",
      messageId: "assistant-late",
      role: "assistant",
      content: "Late response",
    });
    scheduler.flush();
    expect(controller.getSnapshot().autoScroll.hasNewContent).toBe(true);
  });

  it("exposes context controls, omits unsupported attachments, and delegates citation navigation", async () => {
    const navigateToBlock = vi.fn(() => ({ status: "navigated" as const }));
    const base = workspace();
    const workspaceWithImage: AgentWorkspaceBridgePort = {
      ...base,
      captureSnapshot: () => ({
        ...base.captureSnapshot(),
        selectedImage: {
          projectId: PROJECT_ONE.projectId,
          groupId: "group-1",
          imageId: "image-1",
          selectionVersion: 1,
          displayName: "reference.png",
          thumbnailDataUrl: "data:image/png;base64,AA==",
        },
      }),
      navigateToBlock,
    };
    const runtime = new FakeAgentRuntime();
    const send = vi.spyOn(runtime, "send");
    const { controller } = harness(runtime, workspaceWithImage);
    await activate(controller);
    await controller.createSession();

    expect(controller.getSnapshot().requestContext?.attachment?.pinned)
      .toBe(false);
    controller.setAttachmentPinned(true);
    expect(controller.getSnapshot().requestContext?.attachment?.pinned)
      .toBe(true);
    expect(controller.navigateCitation({
      kind: "block",
      projectId: PROJECT_ONE.projectId,
      blockId: "block-1",
    })).toEqual({ status: "navigated" });
    expect(navigateToBlock).toHaveBeenCalled();

    await controller.send("Text only", { includeAttachment: false });
    expect(send.mock.calls[0][0].attachment).toBeNull();
    expect(controller.getSnapshot().turnContexts[0].receipt.selectedImage)
      .toBeUndefined();
    await controller.resumeSession(controller.getSnapshot().activeSessionId!);
    expect(controller.getSnapshot().turnContexts).toHaveLength(1);

    controller.removeContextChip("image:image-1");
    expect(controller.getSnapshot().requestContext?.attachment).toBeNull();
    expect(workspaceWithImage.revokeAttachment).toHaveBeenCalled();
  });

  it("keeps the draft context and removes the failed turn when an attachment becomes unavailable", async () => {
    const base = workspace();
    const workspaceWithImage: AgentWorkspaceBridgePort = {
      ...base,
      captureSnapshot: () => ({
        ...base.captureSnapshot(),
        selectedImage: {
          projectId: PROJECT_ONE.projectId,
          groupId: "group-1",
          imageId: "image-1",
          selectionVersion: 1,
          displayName: "reference.png",
          thumbnailDataUrl: "data:image/png;base64,AA==",
        },
      }),
    };
    const runtime = new FakeAgentRuntime();
    vi.spyOn(runtime, "send").mockRejectedValueOnce(
      new Error("selected image was deleted"),
    );
    const { controller } = harness(runtime, workspaceWithImage);
    await activate(controller);
    await controller.createSession();
    await controller.writeDraft("Keep this draft");

    await expect(controller.send("Keep this draft")).rejects.toThrow(
      /deleted/i,
    );
    expect(controller.getSnapshot().draft?.text).toBe("Keep this draft");
    expect(controller.getSnapshot().turnContexts).toEqual([]);
    expect(controller.getSnapshot().error?.code).toBe(
      "attachment_unavailable",
    );
  });

  it("enforces one active generation and marks restored interactions interrupted", async () => {
    const runtime = new FakeAgentRuntime({
      onSend: async (_request, emit) => {
        emit({
          type: "permission_requested",
          requestId: "permission-1",
          toolName: "read_text_blocks",
          summary: "Read disclosed blocks",
        });
        emit({
          type: "input_requested",
          requestId: "input-1",
          prompt: "Choose",
          choices: ["one"],
        });
      },
    });
    const { controller, scheduler } = harness(runtime);
    await activate(controller);
    const session = await controller.createSession();
    await controller.send("First");
    await expect(controller.send("Second")).rejects.toThrow(/cannot accept/i);
    scheduler.flush();
    await controller.resumeSession(session.sessionId);
    const events = controller.getSnapshot().events;
    expect(events?.permissions[0]?.decision).toBe("interrupted");
    expect(events?.inputs[0]?.status).toBe("interrupted");
  });

  it("supports Cancel, Wait with idle/error auto-switch, and Stop with bounded abort", async () => {
    const runtime = new FakeAgentRuntime({
      onSend: async () => {},
    });
    const { controller, scheduler } = harness(runtime);
    await activate(controller);
    await controller.createSession();
    await controller.send("keep running");

    const activateTwo = vi.fn();
    expect(await controller.activateProject(PROJECT_TWO, activateTwo))
      .toBe("choice_required");
    await controller.chooseProjectSwitch("cancel");
    expect(activateTwo).not.toHaveBeenCalled();

    await controller.activateProject(PROJECT_TWO, activateTwo);
    await controller.chooseProjectSwitch("wait");
    expect(controller.getSnapshot().switchProject.status).toBe("waiting");
    runtime.emit(controller.getSnapshot().activeSessionId!, {
      type: "session_error",
      error: {
        code: "proxy_unreachable",
        phase: "generation",
        message: "offline",
        retryable: true,
      },
    });
    scheduler.flush();
    await vi.waitFor(() => expect(activateTwo).toHaveBeenCalledTimes(1));
    expect(controller.getSnapshot().error?.message).toBe("offline");

    const stopRuntime = new FakeAgentRuntime({
      onSend: async () => new Promise<void>(() => {}),
    });
    const abort = vi.spyOn(stopRuntime, "abort")
      .mockReturnValue(new Promise<void>(() => {}));
    const stopHarness = harness(stopRuntime);
    await activate(stopHarness.controller);
    await stopHarness.controller.createSession();
    void stopHarness.controller.send("run");
    const activateAfterStop = vi.fn();
    await stopHarness.controller.activateProject(
      PROJECT_TWO,
      activateAfterStop,
    );
    await stopHarness.controller.chooseProjectSwitch("stop");
    expect(activateAfterStop).toHaveBeenCalledTimes(1);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(stopHarness.controller.getSnapshot().error?.code).toBe("timeout");
  });

  it("queues project activation while session creation is in flight", async () => {
    const runtime = new FakeAgentRuntime();
    const originalCreate = runtime.createSession.bind(runtime);
    let releaseCreate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    vi.spyOn(runtime, "createSession").mockImplementation(async (config) => {
      await gate;
      return originalCreate(config);
    });
    const { controller, metadata } = harness(runtime);
    await activate(controller);

    const creation = controller.createSession("Creating");
    await vi.waitFor(() => expect(runtime.createSession).toHaveBeenCalled());
    const activateTwo = vi.fn();
    await controller.activateProject(PROJECT_TWO, activateTwo);
    expect(controller.getSnapshot().switchProject.status).toBe("waiting");

    releaseCreate();
    await creation;
    expect(activateTwo).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().project?.projectId).toBe("project-2");
    expect(controller.getSnapshot().activeSessionId).toBeNull();
    expect(await metadata.listSessions(PROJECT_ONE.projectId)).toHaveLength(1);
  });

  it("cascades project metadata and leaves retry tombstones for SDK delete failures", async () => {
    const runtime = new FakeAgentRuntime();
    const deleteSession = vi.spyOn(runtime, "deleteSession")
      .mockRejectedValueOnce(new Error("locked SDK file"));
    const { controller, metadata } = harness(runtime);
    await activate(controller);
    await controller.createSession();

    const result = await controller.deleteProject(PROJECT_ONE.projectId);

    expect(result).toEqual({ sessionCount: 1, cleanupPending: 1 });
    expect(await metadata.listSessions(PROJECT_ONE.projectId)).toEqual([]);
    expect(await metadata.listCleanupTombstones()).toHaveLength(1);
    expect(deleteSession).toHaveBeenCalled();
  });

  it("settles aborts, surfaces runtime crashes, and reconnects by resume", async () => {
    const runtime = new FakeAgentRuntime({
      onSend: async () => {},
    });
    const { controller, scheduler } = harness(runtime);
    await activate(controller);
    const session = await controller.createSession();
    await controller.send("Run");

    await controller.abort();
    scheduler.flush();
    expect(controller.getSnapshot().activeSession?.state).toBe("idle");

    runtime.emit(session.sessionId, {
      type: "session_error",
      error: {
        code: "cli_crashed",
        phase: "runtime",
        message: "managed runtime exited",
        retryable: true,
      },
    });
    scheduler.flush();
    expect(controller.getSnapshot().activeSession?.state).toBe("error");
    expect(controller.getSnapshot().error?.code).toBe("cli_crashed");

    await controller.resumeSession(session.sessionId);
    expect(controller.getSnapshot().activeSession?.state).toBe("idle");
  });
});
