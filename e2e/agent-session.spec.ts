import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 180_000 });

declare global {
  interface Window {
    readonly __PRESHOT_AGENT_TEST__?: {
      createSession(title?: string): Promise<string>;
      send(text: string): Promise<void>;
      draftTextProposal(text: string): Promise<string>;
      stageProposalRecoveryForReload(text: string): Promise<{
        readonly sessionId: string;
        readonly proposalId: string;
      }>;
      prepareProposal(proposalId: string): Promise<{ readonly status: string }>;
      applyProposal(proposalId: string): Promise<{ readonly status: string }>;
      undoProposal(): Promise<{ readonly status: string }>;
      resumeSession(sessionId: string): Promise<void>;
      documentText(): Promise<string>;
      selectTestImage(): void;
      emitRunning(): void;
      requestProjectSwitch(): Promise<
        "activated" | "choice_required" | "already_queued"
      >;
      snapshot(): {
        readonly projectId: string | null;
        readonly activeSessionId: string | null;
        readonly status: string | null;
        readonly messages: readonly string[];
        readonly proposals: readonly {
          readonly proposalId: string;
          readonly status: string;
        }[];
        readonly proposalEvents: readonly string[];
        readonly proposalRecoveryStatus: string;
        readonly turnAttachments: readonly (string | null)[];
      };
    };
  }
}

async function openReadyAssistant(
  page: Page,
  verifyVision = false,
  navigate = true,
) {
  if (navigate) await page.goto("/", { waitUntil: "commit" });
  const toggle = page.getByRole("button", { name: "显示助手面板" });
  await expect(toggle).toBeVisible({ timeout: 120_000 });
  await toggle.click();
  const assistant = page.getByRole("complementary", { name: "助手" });
  await expect(assistant).toBeVisible();
  await expect.poll(
    () => page.evaluate(() => window.__PRESHOT_AGENT_TEST__ !== undefined),
    { timeout: 120_000 },
  ).toBe(true);
  const setupButton = assistant.getByRole("button", { name: "打开模型设置" });
  const startButton = assistant.getByRole("button", { name: "开始新对话" });
  await expect.poll(
    async () => await setupButton.isVisible() || await startButton.isVisible(),
    { timeout: 120_000 },
  ).toBe(true);
  if (await setupButton.isVisible()) {
    await setupButton.click();
    const dialog = page.getByRole("dialog", { name: "设置" });
    await dialog.getByRole("button", { name: "测试连接" }).click();
    await expect(dialog.getByLabel("模型", { exact: true }))
      .toHaveValue("preshot-text");
    if (verifyVision) {
      await dialog.getByRole("button", { name: "验证图片支持" }).click();
      await expect(dialog.getByText("已验证").last()).toBeVisible();
    }
    await page.keyboard.press("Escape");
  }
  await expect(startButton).toBeVisible();
  await expect.poll(() =>
    page.evaluate(() =>
      window.__PRESHOT_AGENT_TEST__?.snapshot().projectId ?? null
    )
  ).not.toBeNull();
  await expect.poll(() =>
    page.evaluate(() =>
      window.__PRESHOT_AGENT_TEST__?.snapshot().proposalRecoveryStatus ?? null
    )
  ).toBe("ready");
  return assistant;
}

test("runs configure, chat, tool proposal, apply, resume reload, and undo through the panel", async ({
  page,
}) => {
  const assistant = await openReadyAssistant(page);
  await assistant.getByRole("button", { name: "开始新对话" }).click();
  await expect.poll(() =>
    page.evaluate(() =>
      window.__PRESHOT_AGENT_TEST__?.snapshot().activeSessionId ?? null
    )
  ).not.toBeNull();
  await assistant.getByRole("button", { name: "历史记录" }).click();
  await assistant.getByRole("button", { name: "重命名对话" }).click();
  await assistant.getByLabel("对话标题").fill("端到端对话");
  await assistant.getByRole("button", { name: "保存名称" }).click();
  await assistant.getByRole("button", { name: "历史记录" }).click();
  const composer = assistant.getByLabel("向助手发送消息");
  await composer.fill("规划一场人像拍摄");
  await composer.press("Enter");
  await expect(assistant.getByText("Deterministic fake response")).toBeVisible();
  const sessionId = await page.evaluate(
    () => window.__PRESHOT_AGENT_TEST__!.snapshot().activeSessionId!,
  );
  const before = await page.evaluate(
    () => window.__PRESHOT_AGENT_TEST__!.documentText(),
  );

  await page.evaluate(
    () => window.__PRESHOT_AGENT_TEST__!.draftTextProposal("由助手提案应用"),
  );
  await expect(assistant.getByText("生成文案修改提案")).toBeVisible();
  await assistant.getByRole("button", { name: "审阅更改" }).click();
  await expect(assistant.getByText("修改前")).toBeVisible();
  await expect(assistant.getByText("修改后")).toBeVisible();
  await assistant.getByRole("button", { name: "应用更改" }).click();
  await expect(assistant.getByText("更改已应用").first()).toBeVisible();
  await expect.poll(() =>
    page.evaluate(() => window.__PRESHOT_AGENT_TEST__!.documentText())
  ).toContain("由助手提案应用");

  await assistant.getByRole("button", { name: "新对话" }).click();
  await assistant.getByRole("button", { name: "历史记录" }).click();
  await assistant.getByRole("button", {
    name: "继续对话“端到端对话”",
  }).first().click();
  await expect.poll(() =>
    page.evaluate(() => window.__PRESHOT_AGENT_TEST__!.snapshot().activeSessionId)
  ).toBe(sessionId);
  await assistant.getByRole("button", { name: "撤销本次应用" }).click();
  await expect.poll(() =>
    page.evaluate(() => window.__PRESHOT_AGENT_TEST__!.documentText())
  ).toBe(before);
});

test("recovers a staged apply journal after a process-style page reload", async ({
  page,
}) => {
  const assistant = await openReadyAssistant(page);
  await assistant.getByRole("button", { name: "开始新对话" }).click();
  const recovery = await page.evaluate(() =>
    window.__PRESHOT_AGENT_TEST__!.stageProposalRecoveryForReload(
      "进程重启后恢复的提案",
    )
  );

  await page.reload({ waitUntil: "commit" });
  await openReadyAssistant(page, false, false);
  await page.evaluate(
    (sessionId) =>
      window.__PRESHOT_AGENT_TEST__!.resumeSession(sessionId),
    recovery.sessionId,
  );
  await expect.poll(() =>
    page.evaluate(
      (proposalId) =>
        window.__PRESHOT_AGENT_TEST__!.snapshot().proposals.find(
          (proposal) => proposal.proposalId === proposalId,
        )?.status ?? null,
      recovery.proposalId,
    )
  ).toBe("applied");
  await expect.poll(() =>
    page.evaluate(() => window.__PRESHOT_AGENT_TEST__!.documentText())
  ).toContain("进程重启后恢复的提案");
});

test("sends a verified image attachment, aborts, and handles queued project switching", async ({
  page,
}) => {
  const assistant = await openReadyAssistant(page, true);
  await assistant.getByRole("button", { name: "开始新对话" }).click();
  await page.evaluate(() => window.__PRESHOT_AGENT_TEST__!.selectTestImage());
  await expect(assistant.getByText("E2E 参考图.png")).toBeVisible();
  await assistant.getByRole("button", { name: "固定图片附件" }).click();
  await expect(assistant.getByText("已固定")).toBeVisible();
  await assistant.getByRole("button", { name: "移除图片附件" }).click();
  await expect(assistant.getByText("E2E 参考图.png")).not.toBeVisible();
  await page.evaluate(() => window.__PRESHOT_AGENT_TEST__!.selectTestImage());

  const composer = assistant.getByLabel("向助手发送消息");
  await composer.fill("分析当前参考图");
  await assistant.getByRole("button", { name: "发送" }).click();
  await expect.poll(() =>
    page.evaluate(() =>
      window.__PRESHOT_AGENT_TEST__!.snapshot().turnAttachments.at(-1)
    )
  ).toBe("E2E 参考图.png");

  await page.evaluate(() => window.__PRESHOT_AGENT_TEST__!.emitRunning());
  await assistant.getByRole("button", { name: "停止" }).click();
  await expect.poll(() =>
    page.evaluate(() => window.__PRESHOT_AGENT_TEST__!.snapshot().status)
  ).toBe("idle");

  await page.evaluate(() => window.__PRESHOT_AGENT_TEST__!.emitRunning());
  await expect.poll(() =>
    page.evaluate(() => window.__PRESHOT_AGENT_TEST__!.snapshot().status)
  ).toBe("running");
  await page.evaluate(() =>
    window.__PRESHOT_AGENT_TEST__!.requestProjectSwitch()
  );
  const dialog = page.getByRole("dialog", { name: "切换到“E2E 外景项目”" });
  await dialog.getByRole("button", { name: "等待并切换" }).click();
  await expect(assistant.getByText(/任务结束后将切换/)).toBeVisible();
  await assistant.getByRole("button", { name: "取消待切换项目" }).click();

  await page.evaluate(() =>
    window.__PRESHOT_AGENT_TEST__!.requestProjectSwitch()
  );
  await page.getByRole("dialog", { name: "切换到“E2E 外景项目”" })
    .getByRole("button", { name: "停止并切换" }).click();
  await expect.poll(() =>
    page.evaluate(() => window.__PRESHOT_AGENT_TEST__!.snapshot().projectId)
  ).toBe("e2e-project-two");
});
