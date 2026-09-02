import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../app/theme/ThemeProvider";
import {
  AgentModelSettingsController,
  AgentSessionController,
  createAgentTextEditProposal,
  createAgentWorkspaceStore,
  DEFAULT_AGENT_MODEL_CAPABILITIES,
  DEFAULT_AGENT_MODEL_SETTINGS,
  hashPreshotBlock,
  hashPreshotDocument,
  type AgentMetadataStorePort,
  type AgentProposalApplicationPort,
} from "../../domain/agent";
import { createBrowserAgentModelProbe } from "../../infrastructure/agent/browserAgentModelProbe";
import { FakeAgentRuntime } from "../../infrastructure/agent/fakeAgentRuntime";
import { MemoryAttachmentTokenResolver } from "../../infrastructure/agent/memoryAttachmentTokenResolver";
import { createMemoryAgentMetadataStore } from "../../infrastructure/agent/memoryAgentMetadataStore";
import { createSettingsAgentModelStore } from "../../infrastructure/agent/settingsAgentModelStore";
import { createBrowserSettingsRepository } from "../../infrastructure/settings/browserSettings";
import { SettingsButton } from "../settings/SettingsButton";
import { AgentModelSettingsProvider } from "./AgentModelSettingsContext";
import { AgentPanel } from "./AgentPanel";
import { AgentProvider } from "./AgentProvider";
import { AgentWorkspaceProvider } from "./AgentWorkspaceContext";

const PROJECT = {
  projectId: "project-1",
  projectName: "杂志人像",
  projectPath: "C:\\shoots\\editorial",
};

const DOCUMENT = {
  format: "preshot-blocks" as const,
  version: 2 as const,
  blocks: [{
    id: "block-1",
    type: "paragraph" as const,
    props: {},
    content: [{ type: "text" as const, text: "拍摄时间：下午", styles: {} }],
    children: [],
  }],
};

async function setup(options: {
  readonly ready?: boolean;
  readonly runtime?: FakeAgentRuntime;
  readonly selectedImage?: boolean;
  readonly metadata?: AgentMetadataStorePort;
  readonly proposalApplication?: AgentProposalApplicationPort;
} = {}) {
  const repository = createBrowserSettingsRepository();
  const modelController = new AgentModelSettingsController({
    store: createSettingsAgentModelStore(repository),
    probe: createBrowserAgentModelProbe(),
  });
  if (options.ready) {
    await modelController.initialize();
    await modelController.testConnection();
  }
  const workspace = createAgentWorkspaceStore(
    new MemoryAttachmentTokenResolver({ makeId: () => "attachment-token" }),
  );
  workspace.activateProject(PROJECT);
  workspace.publishDocument({
    revision: 1,
    saveState: "saved",
    document: DOCUMENT,
  });
  workspace.publishSelection({
    selectedBlockIds: ["block-1"],
    cursorBlockId: "block-1",
  });
  workspace.publishImageIndex([{
    groupId: "group-1",
    imageId: "image-1",
    displayName: "造型参考.png",
    groupLabel: "造型",
    width: 100,
    height: 100,
  }]);
  if (options.selectedImage) {
    workspace.publishSelectedImage({
      groupId: "group-1",
      imageId: "image-1",
      displayName: "造型参考.png",
      relativeFile: "references/0001.png",
      thumbnailDataUrl: "data:image/png;base64,AA==",
    });
  }
  const runtime = options.runtime ?? new FakeAgentRuntime();
  const controller = new AgentSessionController({
    runtime,
    metadata: options.metadata ?? createMemoryAgentMetadataStore(),
    workspace,
    proposalApplication: options.proposalApplication ?? workspace,
    configuration: async () => ({
      settings: {
        ...DEFAULT_AGENT_MODEL_SETTINGS,
        enabled: true,
        modelId: "preshot-text",
      },
      capabilities: {
        ...DEFAULT_AGENT_MODEL_CAPABILITIES,
        responsesApi: "verified",
        streaming: "verified",
        customTools: "verified",
      },
    }),
  });
  await controller.activateProject(PROJECT, vi.fn());
  const view = render(
    <AgentModelSettingsProvider controller={modelController}>
      <ThemeProvider repository={repository}>
        <AgentProvider controller={controller}>
          <AgentWorkspaceProvider store={workspace}>
            <SettingsButton />
            <AgentPanel />
          </AgentWorkspaceProvider>
        </AgentProvider>
      </ThemeProvider>
    </AgentModelSettingsProvider>,
  );
  return {
    ...view,
    controller,
    modelController,
    repository,
    runtime,
    workspace,
  };
}

describe("AgentPanel", () => {
  it("hides history and proposals until reload recovery is ready", async () => {
    const metadata = createMemoryAgentMetadataStore();
    await metadata.adoptProject(PROJECT);
    await metadata.createSession({
      sessionId: "recovery-session",
      projectId: PROJECT.projectId,
      title: "Recovery",
      state: "idle",
    });
    const proposal = createAgentTextEditProposal({
      proposalId: "recovery-proposal",
      sessionId: "recovery-session",
      baseRevision: 1,
      baseDocumentHash: hashPreshotDocument(DOCUMENT),
    }, {
      summary: "Recovery conflict",
      operations: [{
        op: "update",
        blockId: "block-1",
        expectedBlockHash: hashPreshotBlock(DOCUMENT.blocks[0]),
        patch: { text: "助手修改" },
      }],
    });
    await metadata.createProposal(proposal);
    const afterDocument = {
      ...DOCUMENT,
      blocks: [{
        ...DOCUMENT.blocks[0],
        content: [{
          type: "text" as const,
          text: "助手修改",
          styles: {},
        }],
      }],
    };
    await metadata.beginProposalRecovery({
      operationId: "recovery-operation",
      kind: "apply",
      proposalId: proposal.proposalId,
      sessionId: proposal.sessionId,
      projectId: PROJECT.projectId,
      beforeDocumentHash: proposal.baseDocumentHash,
      beforeRevision: 1,
      afterDocumentHash: hashPreshotDocument(afterDocument),
      afterRevision: 2,
      checkpoint: {
        checkpointId: "recovery-checkpoint",
        proposalId: proposal.proposalId,
        sessionId: proposal.sessionId,
        projectId: PROJECT.projectId,
        beforeRevision: 1,
        beforeDocumentHash: proposal.baseDocumentHash,
        appliedRevision: 2,
        appliedDocumentHash: hashPreshotDocument(afterDocument),
        beforePlan: {
          schemaVersion: 14,
          title: PROJECT.projectName,
          document: DOCUMENT,
          imageGroups: [],
        },
        changes: [{
          kind: "restore",
          blockId: "block-1",
          beforeBlock: DOCUMENT.blocks[0],
          appliedBlockHash: hashPreshotBlock(afterDocument.blocks[0]),
        }],
      },
      finalization: {
        status: "applied",
        finalizedAt: "2026-08-22T00:00:01.000Z",
        revision: 2,
        documentHash: hashPreshotDocument(afterDocument),
      },
    });
    const conflictDocument = {
      ...DOCUMENT,
      blocks: [{
        ...DOCUMENT.blocks[0],
        content: [{
          type: "text" as const,
          text: "用户同时修改",
          styles: {},
        }],
      }],
    };
    const currentPlan = {
      schemaVersion: 14 as const,
      title: PROJECT.projectName,
      document: conflictDocument,
      imageGroups: [],
    };
    const readinessListeners = new Set<
      Parameters<AgentProposalApplicationPort["subscribeReadiness"]>[0]
    >();
    let ready = false;
    const proposalApplication: AgentProposalApplicationPort = {
      getReadiness: (projectId) => ready
        ? {
          status: "ready",
          projectId,
          revision: 3,
        }
        : {
          status: "loading",
          projectId,
        },
      subscribeReadiness: (listener) => {
        readinessListeners.add(listener);
        return () => readinessListeners.delete(listener);
      },
      getCurrentPlan: async () => ({ plan: currentPlan, revision: 3 }),
      applyAtomically: vi.fn(),
      restoreCheckpointAtomically: vi.fn(),
      rollbackAtomically: vi.fn(),
    };

    await setup({
      ready: true,
      metadata,
      proposalApplication,
    });

    expect(await screen.findByTestId("agent-proposal-recovering"))
      .toHaveTextContent("正在恢复更改");
    expect(screen.getByRole("button", { name: "历史记录" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "应用更改" }))
      .not.toBeInTheDocument();

    ready = true;
    act(() => {
      readinessListeners.forEach((listener) =>
        listener({
          status: "ready",
          projectId: PROJECT.projectId,
          revision: 3,
        })
      );
    });
    expect(
      await screen.findByTestId("agent-proposal-recovery-error"),
    ).toHaveTextContent("检测到 1 条未完成的提案恢复记录");
    expect(proposalApplication.applyAtomically).not.toHaveBeenCalled();
    expect((await metadata.listProposalRecovery(PROJECT.projectId))[0])
      .toMatchObject({ status: "conflict", proposalId: proposal.proposalId });
  });

  it("shows actionable setup and opens settings while send remains disabled", async () => {
    const user = userEvent.setup();
    await setup();

    expect(screen.getByRole("complementary", { name: "助手" })).toBeVisible();
    expect(await screen.findByText("需要设置模型")).toBeVisible();
    expect(screen.getByLabelText("向助手发送消息")).toBeDisabled();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "打开模型设置" }));
    expect(screen.getByRole("dialog", { name: "设置" })).toHaveFocus();
  });

  it("does not flicker back to setup when a verified URL is blurred unchanged", async () => {
    const user = userEvent.setup();
    const { repository } = await setup({ ready: true });
    const write = vi.spyOn(repository, "write");
    write.mockClear();

    await user.click(screen.getByRole("button", { name: "设置" }));
    const proxy = screen.getByLabelText("代理显示地址");
    await user.click(proxy);
    await user.tab();

    expect(screen.queryByText("需要设置模型")).not.toBeInTheDocument();
    expect(screen.getByLabelText("模型")).toHaveFocus();
    expect(write).not.toHaveBeenCalled();
  });

  it("creates a conversation, fills suggestions, sends with Enter, and preserves Shift+Enter", async () => {
    const user = userEvent.setup();
    await setup({ ready: true });

    await user.click(screen.getByRole("button", { name: "开始新对话" }));
    const composer = await screen.findByLabelText("向助手发送消息");
    expect(composer).toBeEnabled();
    await user.click(screen.getByRole("button", {
      name: "根据当前计划整理拍摄日程",
    }));
    expect(composer).toHaveValue("根据当前计划整理拍摄日程");

    await user.clear(composer);
    await user.type(composer, "第一行{shift>}{enter}{/shift}第二行");
    expect(composer).toHaveValue("第一行\n第二行");
    await user.keyboard("{Enter}");

    const log = screen.getByRole("log", { name: "助手对话记录" });
    expect(await within(log).findByText(/第一行\s+第二行/)).toBeVisible();
    expect(await within(log).findByText("Deterministic fake response"))
      .toBeVisible();
    expect(within(log).getByText("本次发送的上下文")).toBeVisible();
  });

  it("does not send during IME composition and persists a per-session draft", async () => {
    const runtime = new FakeAgentRuntime();
    const send = vi.spyOn(runtime, "send");
    const { controller } = await setup({ ready: true, runtime });
    await act(async () => {
      await controller.createSession("输入测试");
    });
    const composer = screen.getByLabelText("向助手发送消息");

    fireEvent.change(composer, { target: { value: "拼音输入" } });
    fireEvent.compositionStart(composer);
    fireEvent.keyDown(composer, {
      key: "Enter",
      code: "Enter",
      isComposing: true,
    });
    fireEvent.compositionEnd(composer);
    expect(send).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(controller.getSnapshot().draft?.text).toBe("拼音输入")
    );
  });

  it("shows removable context and automatic image attachment controls without sending unsupported vision", async () => {
    const user = userEvent.setup();
    const runtime = new FakeAgentRuntime();
    const send = vi.spyOn(runtime, "send");
    const { controller } = await setup({
      ready: true,
      runtime,
      selectedImage: true,
    });
    await act(async () => {
      await controller.createSession("图片上下文");
    });

    expect(screen.getByText("造型参考.png")).toBeVisible();
    expect(screen.getByText(/当前模型不支持图片/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "固定图片附件" }));
    expect(screen.getByText("已固定")).toBeVisible();
    await user.type(screen.getByLabelText("向助手发送消息"), "分析图片");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0][0].attachment).toBeNull();

    await user.click(screen.getByRole("button", { name: "移除图片附件" }));
    expect(screen.queryByText("造型参考.png")).not.toBeInTheDocument();
  });

  it("manages newest-first history with resume, rename, and confirmed delete", async () => {
    const user = userEvent.setup();
    const { controller } = await setup({ ready: true });
    let first!: Awaited<ReturnType<AgentSessionController["createSession"]>>;
    await act(async () => {
      first = await controller.createSession("第一次对话");
      await controller.createSession("第二次对话");
    });

    await user.click(screen.getByRole("button", { name: "历史记录" }));
    const entries = screen.getAllByRole("listitem");
    expect(entries[0]).toHaveTextContent("第二次对话");
    expect(entries[1]).toHaveTextContent("第一次对话");

    await user.click(within(entries[1]).getByRole("button", {
      name: "重命名对话",
    }));
    const title = within(entries[1]).getByLabelText("对话标题");
    await user.clear(title);
    await user.type(title, "重新命名");
    await user.click(within(entries[1]).getByRole("button", {
      name: "保存名称",
    }));
    expect(await screen.findByText("重新命名")).toBeVisible();

    const renamedBeforeResume = screen.getByText("重新命名").closest("li")!;
    await user.click(within(renamedBeforeResume).getAllByRole("button", {
      name: "继续对话“重新命名”",
    })[0]);
    expect(controller.getSnapshot().activeSessionId).toBe(first.sessionId);
    await user.click(screen.getByRole("button", { name: "历史记录" }));
    const renamedEntry = screen.getAllByText("重新命名")
      .map((element) => element.closest("li"))
      .find((element): element is HTMLLIElement => element !== null)!;
    await user.click(within(renamedEntry).getByRole("button", {
      name: "删除当前对话",
    }));
    await user.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() =>
      expect(controller.getSnapshot().sessions).toHaveLength(1)
    );
  });

  it("renders reasoning, tool progress, permissions, user input, usage, and new-response recovery", async () => {
    const user = userEvent.setup();
    const runtime = new FakeAgentRuntime({
      onSend: async (_request, emit) => {
        emit({
          type: "reasoning_completed",
          reasoningId: "reason-1",
          summary: "将日程拆分为准备与拍摄阶段。",
        });
        emit({
          type: "tool_started",
          toolCallId: "tool-1",
          toolName: "read_text_blocks",
          summary: "读取已明确发送的文案",
        });
        emit({
          type: "tool_progress",
          toolCallId: "tool-1",
          progress: "1/1",
        });
        emit({
          type: "permission_requested",
          requestId: "permission-1",
          toolName: "read_text_blocks",
          summary: "读取一个文案区块",
        });
        emit({
          type: "input_requested",
          requestId: "input-1",
          prompt: "选择拍摄时段",
          choices: ["上午", "下午"],
        });
        emit({
          type: "usage",
          scope: "session",
          usage: {
            inputTokens: 120,
            outputTokens: 40,
            reasoningTokens: 20,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            requestCount: 1,
          },
        });
        emit({ type: "context", usedTokens: 180, limitTokens: 1000 });
      },
    });
    const { controller } = await setup({ ready: true, runtime });
    await act(async () => {
      await controller.createSession("完整事件");
    });
    await user.type(screen.getByLabelText("向助手发送消息"), "开始");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("推理摘要")).toBeVisible();
    expect(screen.getAllByText("读取文案区块")).toHaveLength(2);
    expect(screen.getByText("1/1")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "仅允许本次" }));
    expect(await screen.findByText("已允许本次")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "下午" }));
    await user.click(screen.getByRole("button", { name: "提交回答" }));
    expect(await screen.findByText("已提交回答")).toBeVisible();
    expect(screen.getByText("用量 · 18%")).toBeVisible();

    act(() => controller.setAutoScrollFollowing(false));
    runtime.emit(controller.getSnapshot().activeSessionId!, {
      type: "message_delta",
      messageId: "assistant-late",
      role: "assistant",
      delta: "新内容",
    });
    expect(await screen.findByRole("button", { name: "有新回复" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "有新回复" }));
    expect(screen.queryByRole("button", { name: "有新回复" }))
      .not.toBeInTheDocument();
  });

  it("navigates assistant citations and surfaces typed runtime errors", async () => {
    const focusBlock = vi.fn(() => true);
    const runtime = new FakeAgentRuntime({
      onSend: async (_request, emit) => {
        emit({
          type: "message_completed",
          messageId: "assistant-citation",
          role: "assistant",
          content: "请检查这段内容 [[block:block-1]]",
        });
        emit({
          type: "session_error",
          error: {
            code: "rate_limited",
            phase: "generation",
            message: "429",
            retryable: true,
          },
        });
      },
    });
    const { controller, workspace } = await setup({ ready: true, runtime });
    workspace.registerBlockNavigator({ focusBlock });
    await act(async () => {
      await controller.createSession("引用测试");
      await controller.send("检查");
    });

    await userEvent.setup().click(await screen.findByRole("button", {
      name: "引用 1",
    }));
    expect(focusBlock).toHaveBeenCalledWith("block-1");
    expect(await screen.findAllByText("请求过于频繁，请稍后重试。"))
      .toHaveLength(2);
  });
});
