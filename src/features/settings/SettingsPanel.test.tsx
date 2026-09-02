import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../app/theme/ThemeProvider";
import { AgentModelSettingsController } from "../../domain/agent";
import { AgentModelSettingsProvider } from "../agent/AgentModelSettingsContext";
import { createBrowserAgentModelProbe } from "../../infrastructure/agent/browserAgentModelProbe";
import { createSettingsAgentModelStore } from "../../infrastructure/agent/settingsAgentModelStore";
import {
  createBrowserSettingsRepository,
} from "../../infrastructure/settings/browserSettings";
import type { SettingsRepository } from "../../domain/settings/ports";
import { SettingsPanel } from "./SettingsPanel";

function renderPanel(options: {
  readonly open?: boolean;
  readonly onClose?: () => void;
  readonly repository?: SettingsRepository;
} = {}) {
  const repository = options.repository ?? createBrowserSettingsRepository();
  const controller = new AgentModelSettingsController({
    store: createSettingsAgentModelStore(repository),
    probe: createBrowserAgentModelProbe(),
  });
  const onClose = options.onClose ?? vi.fn();
  const result = render(
    <AgentModelSettingsProvider controller={controller}>
      <ThemeProvider repository={repository}>
        <SettingsPanel open={options.open ?? true} onClose={onClose} />
      </ThemeProvider>
    </AgentModelSettingsProvider>,
  );
  return { ...result, controller, onClose, repository };
}

describe("SettingsPanel", () => {
  it("renders nothing when closed", () => {
    renderPanel({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders accessible appearance and assistant controls with safe defaults", async () => {
    renderPanel();
    const dialog = screen.getByRole("dialog", { name: "设置" });

    expect(dialog).toHaveFocus();
    expect(screen.getByText("外观")).toBeVisible();
    expect(screen.getByText("浅色")).toBeVisible();
    expect(screen.getByText("深色")).toBeVisible();
    expect(screen.getByText("跟随系统")).toBeVisible();
    expect(screen.getByRole("heading", { name: "助手模型" })).toBeVisible();
    expect(screen.getByLabelText("代理显示地址"))
      .toHaveValue("http://localhost:4141");
    expect(screen.getByLabelText("接口模式")).toHaveValue("Responses API");
    expect(screen.queryByLabelText(/API key/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("模型")).toBeDisabled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "测试连接" })).toBeEnabled()
    );
  });

  it("discovers models, verifies capabilities, gates reasoning, and verifies vision separately", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "测试连接" }));
    await screen.findByText("Preshot Text (deterministic)");

    expect(screen.getByLabelText("模型")).toHaveValue("preshot-text");
    expect(screen.getByLabelText("模型")).toBeEnabled();
    expect(screen.getAllByText("已验证", { selector: "strong" })).toHaveLength(3);
    expect(screen.getByLabelText("推理强度")).toBeVisible();
    expect(screen.getByLabelText("推理摘要")).toBeVisible();
    expect(screen.getByText(/可靠上下文上限：128.?000 令牌/)).toBeVisible();
    expect(screen.getByRole("button", { name: "验证图片支持" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "验证图片支持" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "验证图片支持" }))
        .not.toBeInTheDocument()
    );
    expect(screen.getAllByText("已验证", { selector: "strong" })).toHaveLength(4);
  });

  it("marks proxy and model changes for retest and can remove configuration", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "测试连接" }));
    await screen.findByText("Preshot Text (deterministic)");

    await user.selectOptions(screen.getByLabelText("模型"), "preshot-vision");
    expect(await screen.findByText("需要重新测试")).toBeVisible();

    const proxy = screen.getByLabelText("代理显示地址");
    await user.clear(proxy);
    await user.type(proxy, "http://127.0.0.1:4141/");
    await user.tab();
    expect(await screen.findByText("需要重新测试")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "移除模型配置" }));
    await waitFor(() =>
      expect(screen.getByLabelText("代理显示地址"))
        .toHaveValue("http://localhost:4141")
    );
    expect(screen.getByLabelText("模型")).toBeDisabled();
  });

  it("keeps verified settings ready and focused controls stable on equivalent blur", async () => {
    const user = userEvent.setup();
    const repository = createBrowserSettingsRepository();
    const write = vi.spyOn(repository, "write");
    renderPanel({ repository });
    await user.click(await screen.findByRole("button", {
      name: "测试连接",
    }));
    await screen.findByText("Preshot Text (deterministic)");
    write.mockClear();

    const proxy = screen.getByLabelText("代理显示地址");
    await user.click(proxy);
    await user.tab();
    expect(screen.getByLabelText("模型")).toHaveFocus();
    expect(screen.getByText("已验证", { selector: "span" })).toBeVisible();
    expect(write).not.toHaveBeenCalled();

    await user.click(proxy);
    await user.clear(proxy);
    await user.type(proxy, "  http://localhost:4141/  ");
    await user.tab();
    expect(proxy).toHaveValue("http://localhost:4141");
    expect(screen.getByLabelText("模型")).toHaveFocus();
    expect(screen.getByText("已验证", { selector: "span" })).toBeVisible();
    expect(write).not.toHaveBeenCalled();
  });

  it("shows invalid proxy errors without renderer network access", async () => {
    const user = userEvent.setup();
    const rendererFetch = vi.spyOn(globalThis, "fetch");
    renderPanel();
    const proxy = screen.getByLabelText("代理显示地址");
    await user.clear(proxy);
    await user.type(proxy, "http://models.example.com");
    await user.click(screen.getByRole("button", { name: "测试连接" }));

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("代理地址无效");
    expect(proxy).toHaveFocus();
    expect(proxy).toHaveAttribute("aria-invalid", "true");
    expect(rendererFetch).not.toHaveBeenCalled();
    rendererFetch.mockRestore();
  });

  it("persists theme changes and closes with Escape or the backdrop", async () => {
    const user = userEvent.setup();
    const repository = createBrowserSettingsRepository();
    const first = renderPanel({ repository });

    await user.click(screen.getByRole("button", { name: "深色" }));
    await waitFor(async () =>
      expect((await repository.read()).theme).toBe("dark")
    );
    await user.keyboard("{Escape}");
    expect(first.onClose).toHaveBeenCalled();

    first.unmount();
    const second = renderPanel();
    const backdrop = screen.getByRole("dialog").parentElement;
    if (!backdrop) throw new Error("Settings backdrop not found");
    await user.click(backdrop);
    expect(second.onClose).toHaveBeenCalled();
  });
});
