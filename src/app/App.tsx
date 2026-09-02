import { useEffect, useMemo } from "react";
import { ThemeProvider } from "./theme/ThemeProvider";
import { createSettingsRepository } from "./settingsDependencies";
import { WorkspaceProvider } from "./workspace/WorkspaceProvider";
import {
  createWorkspaceDependencies,
  type WorkspaceDependencies,
} from "./workspace/dependencies";
import { createPlanDependencies } from "./plan/planDependencies";
import type { PlanDependencies } from "../features/plan/blocknote/dependencies";
import { AgentModelSettingsProvider } from "../features/agent/AgentModelSettingsContext";
import { createAgentModelSettingsController } from "./agentModelDependencies";
import {
  AgentDomainError,
  AgentSessionController,
  applyAgentTextEditProposal,
  createAgentWorkspaceStore,
  createAgentTextEditProposal,
  hashPreshotBlock,
  hashPreshotDocument,
  isAgentTextBlockType,
  type AgentMetadataStorePort,
} from "../domain/agent";
import type { PreshotBlock } from "../domain/plan/canvas/blockDocument";
import { AgentProvider } from "../features/agent/AgentProvider";
import { FakeAgentRuntime } from "../infrastructure/agent/fakeAgentRuntime";
import { MemoryAttachmentTokenResolver } from "../infrastructure/agent/memoryAttachmentTokenResolver";
import { createMemoryAgentMetadataStore } from "../infrastructure/agent/memoryAgentMetadataStore";
import { createTauriAgentRuntime } from "../infrastructure/agent/tauriAgentRuntime";
import { tauriAgentMetadataStore } from "../infrastructure/agent/tauriAgentMetadataStore";

const defaultWorkspaceDependencies = createWorkspaceDependencies();
const defaultPlanDependencies = createPlanDependencies();
const settingsRepository = createSettingsRepository();
const agentModelSettingsController =
  createAgentModelSettingsController(settingsRepository);
const E2E_PROPOSAL_RECOVERY_KEY = "preshot.e2e-proposal-recovery";

interface E2eProposalRecoverySeed {
  readonly session: Parameters<AgentMetadataStorePort["createSession"]>[0];
  readonly proposal: ReturnType<typeof createAgentTextEditProposal>;
  readonly recovery: Parameters<
    AgentMetadataStorePort["beginProposalRecovery"]
  >[0];
}

function createBrowserAgentMetadataStore(): AgentMetadataStorePort {
  const store = createMemoryAgentMetadataStore();
  if (import.meta.env.MODE !== "e2e") return store;
  const encoded = window.sessionStorage.getItem(E2E_PROPOSAL_RECOVERY_KEY);
  if (!encoded) return store;
  const seed = JSON.parse(encoded) as E2eProposalRecoverySeed;
  let replayed = false;
  return {
    ...store,
    async adoptProject(project) {
      const adopted = await store.adoptProject(project);
      if (!replayed && project.projectId === seed.session.projectId) {
        replayed = true;
        await store.createSession(seed.session);
        await store.createProposal(seed.proposal);
        await store.beginProposalRecovery(seed.recovery);
      }
      return adopted;
    },
  };
}

interface AppProps {
  dependencies?: WorkspaceDependencies;
  planDependencies?: PlanDependencies;
}

export function App({
  dependencies = defaultWorkspaceDependencies,
  planDependencies = defaultPlanDependencies,
}: AppProps) {
  const agent = useMemo(() => {
    const attachments = new MemoryAttachmentTokenResolver();
    const workspace = createAgentWorkspaceStore(attachments);
    const browserMode =
      import.meta.env.MODE === "test" ||
      import.meta.env.VITE_WORKSPACE_ADAPTER === "memory" ||
      import.meta.env.VITE_WORKSPACE_ADAPTER === "midscene";
    const runtime = browserMode
      ? new FakeAgentRuntime()
      : createTauriAgentRuntime({ workspace, attachments });
    const metadata = browserMode
      ? createBrowserAgentMetadataStore()
      : tauriAgentMetadataStore;
    const controller = new AgentSessionController({
      runtime,
      metadata,
      workspace,
      proposalApplication: workspace,
      configuration: async () => {
        const snapshot = agentModelSettingsController.getSnapshot();
        if (!snapshot.canSend || !snapshot.capabilities) {
          throw new AgentDomainError(
            "model_not_configured",
            "settings",
            "Configure and test an assistant model before creating a session",
          );
        }
        return {
          settings: snapshot.settings,
          capabilities: snapshot.capabilities,
        };
      },
    });
    return { controller, workspace, metadata, runtime };
  }, []);
  useEffect(() => {
    if (import.meta.env.MODE !== "e2e") return;
    const testBridge = {
      async createSession(title?: string) {
        return (await agent.controller.createSession(title)).sessionId;
      },
      send: (text: string) => agent.controller.send(text),
      async draftTextProposal(text: string) {
        const state = agent.controller.getSnapshot();
        if (!state.activeSessionId || !state.project) {
          throw new Error("No E2E agent session is active");
        }
        const current = await agent.workspace.getCurrentPlan(
          state.project.projectId,
        );
        const findText = (
          blocks: readonly PreshotBlock[],
        ): PreshotBlock | null => {
          for (const block of blocks) {
            if (isAgentTextBlockType(block.type)) return block;
            const nested = findText(block.children);
            if (nested) return nested;
          }
          return null;
        };
        const target = findText(current.plan.document.blocks);
        if (!target) throw new Error("No editable text block is available");
        const proposal = createAgentTextEditProposal({
          proposalId: crypto.randomUUID(),
          sessionId: state.activeSessionId,
          baseRevision: current.revision,
          baseDocumentHash: hashPreshotDocument(current.plan.document),
        }, {
          summary: "E2E text proposal",
          operations: [{
            op: "update",
            blockId: target.id,
            expectedBlockHash: hashPreshotBlock(target),
            patch: { text },
          }],
        });
        await agent.metadata.createProposal(proposal);
        if (agent.runtime instanceof FakeAgentRuntime) {
          const toolCallId = crypto.randomUUID();
          agent.runtime.emit(state.activeSessionId, {
            type: "tool_started",
            toolCallId,
            toolName: "propose_text_block_edits",
            summary: "Stage a text proposal",
          });
          agent.runtime.emit(state.activeSessionId, {
            type: "tool_completed",
            toolCallId,
            status: "succeeded",
            output: JSON.stringify({
              status: "staged",
              proposal: {
                proposalId: proposal.proposalId,
                operationCount: proposal.operations.length,
              },
            }),
          });
          agent.runtime.emit(state.activeSessionId, { type: "session_idle" });
        }
        return proposal.proposalId;
      },
      async stageProposalRecoveryForReload(text: string) {
        const state = agent.controller.getSnapshot();
        if (!state.activeSessionId || !state.project) {
          throw new Error("No E2E agent session is active");
        }
        const current = await agent.workspace.getCurrentPlan(
          state.project.projectId,
        );
        const findText = (
          blocks: readonly PreshotBlock[],
        ): PreshotBlock | null => {
          for (const block of blocks) {
            if (isAgentTextBlockType(block.type)) return block;
            const nested = findText(block.children);
            if (nested) return nested;
          }
          return null;
        };
        const target = findText(current.plan.document.blocks);
        if (!target) throw new Error("No editable text block is available");
        const proposal = createAgentTextEditProposal({
          proposalId: crypto.randomUUID(),
          sessionId: state.activeSessionId,
          baseRevision: current.revision,
          baseDocumentHash: hashPreshotDocument(current.plan.document),
        }, {
          summary: "E2E restart recovery",
          operations: [{
            op: "update",
            blockId: target.id,
            expectedBlockHash: hashPreshotBlock(target),
            patch: { text },
          }],
        });
        const finalizedAt = new Date().toISOString();
        const applied = applyAgentTextEditProposal(
          current.plan,
          current.revision,
          proposal,
          {
            projectId: state.project.projectId,
            makeId: () => crypto.randomUUID(),
            makeCheckpointId: () => crypto.randomUUID(),
            appliedAt: finalizedAt,
          },
        );
        if (applied.status !== "applied") {
          throw new Error(`Unable to stage E2E recovery: ${applied.status}`);
        }
        const recovery: E2eProposalRecoverySeed["recovery"] = {
          operationId: crypto.randomUUID(),
          kind: "apply",
          proposalId: proposal.proposalId,
          sessionId: proposal.sessionId,
          projectId: state.project.projectId,
          beforeDocumentHash: proposal.baseDocumentHash,
          beforeRevision: current.revision,
          afterDocumentHash: applied.documentHash,
          afterRevision: applied.revision,
          checkpoint: applied.checkpoint,
          finalization: {
            status: "applied",
            finalizedAt,
            revision: applied.revision,
            documentHash: applied.documentHash,
          },
        };
        await agent.metadata.createProposal(proposal);
        await agent.metadata.beginProposalRecovery(recovery);
        const session = state.activeSession;
        if (!session) throw new Error("No E2E session metadata is active");
        window.sessionStorage.setItem(
          E2E_PROPOSAL_RECOVERY_KEY,
          JSON.stringify({
            session: {
              sessionId: session.sessionId,
              projectId: session.projectId,
              title: session.title,
              state: "idle",
              ...(session.modelId ? { modelId: session.modelId } : {}),
            },
            proposal,
            recovery,
          } satisfies E2eProposalRecoverySeed),
        );
        await agent.workspace.applyAtomically({
          projectId: state.project.projectId,
          expectedRevision: current.revision,
          expectedDocumentHash: proposal.baseDocumentHash,
          projectedPlan: applied.plan,
        });
        return {
          sessionId: session.sessionId,
          proposalId: proposal.proposalId,
        };
      },
      prepareProposal: (proposalId: string) =>
        agent.controller.prepareProposal(proposalId),
      applyProposal: (proposalId: string) =>
        agent.controller.applyProposal(proposalId),
      undoProposal: () => agent.controller.undoProposalApply(),
      resumeSession: (sessionId: string) =>
        agent.controller.resumeSession(sessionId),
      selectTestImage() {
        const snapshot = agent.workspace.captureSnapshot();
        agent.workspace.publishImageIndex([
          ...(snapshot.referenceImages ?? []),
          {
            groupId: "e2e-group",
            imageId: "e2e-image",
            displayName: "E2E 参考图.png",
            groupLabel: "E2E",
            width: 64,
            height: 64,
          },
        ]);
        agent.workspace.publishSelectedImage({
          groupId: "e2e-group",
          imageId: "e2e-image",
          displayName: "E2E 参考图.png",
          relativeFile: "references/e2e.png",
          thumbnailDataUrl: "data:image/png;base64,AA==",
        });
      },
      emitRunning() {
        const sessionId = agent.controller.getSnapshot().activeSessionId;
        if (!sessionId || !(agent.runtime instanceof FakeAgentRuntime)) {
          throw new Error("No fake E2E session is active");
        }
        agent.runtime.emit(sessionId, {
          type: "message_delta",
          messageId: crypto.randomUUID(),
          role: "assistant",
          delta: "Streaming",
        });
      },
      requestProjectSwitch() {
        const target = {
          projectId: "e2e-project-two",
          projectName: "E2E 外景项目",
          projectPath: "C:\\PreshotE2E\\ProjectTwo",
        };
        return agent.controller.activateProject(target, () => {
          agent.workspace.activateProject(target);
        });
      },
      async documentText() {
        const state = agent.controller.getSnapshot();
        if (!state.project) return "";
        const current = await agent.workspace.getCurrentPlan(
          state.project.projectId,
        );
        const text = (blocks: readonly PreshotBlock[]): string[] =>
          blocks.flatMap((block) => [
            ...(Array.isArray(block.content)
              ? block.content.flatMap((entry) =>
                  entry.type === "text"
                    ? [entry.text]
                    : entry.content.map((item) => item.text)
                )
              : []),
            ...text(block.children),
          ]);
        return text(current.plan.document.blocks).join("\n");
      },
      snapshot: () => {
        const snapshot = agent.controller.getSnapshot();
        return {
          projectId: snapshot.project?.projectId ?? null,
          activeSessionId: snapshot.activeSessionId,
          status: snapshot.activeSession?.state ?? null,
          messages: snapshot.events?.messages.map(
            (message) => message.content,
          ) ?? [],
          proposals: snapshot.proposals.map((proposal) => ({
            proposalId: proposal.proposalId,
            status: proposal.status,
          })),
          proposalEvents: snapshot.proposalEvents.map((event) => event.kind),
          proposalRecoveryStatus: snapshot.proposalRecoveryStatus,
          turnAttachments: snapshot.turnContexts.map(
            (turn) => turn.attachment?.displayName ?? null,
          ),
        };
      },
    };
    Object.defineProperty(window, "__PRESHOT_AGENT_TEST__", {
      configurable: true,
      value: testBridge,
    });
    return () => {
      delete (window as { __PRESHOT_AGENT_TEST__?: unknown })
        .__PRESHOT_AGENT_TEST__;
    };
  }, [agent]);

  return (
    <AgentModelSettingsProvider controller={agentModelSettingsController}>
      <ThemeProvider repository={settingsRepository}>
        <AgentProvider controller={agent.controller}>
          <WorkspaceProvider
            agentWorkspace={agent.workspace}
            dependencies={dependencies}
            planDependencies={planDependencies}
          />
        </AgentProvider>
      </ThemeProvider>
    </AgentModelSettingsProvider>
  );
}
