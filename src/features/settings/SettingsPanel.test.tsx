import { act, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../app/theme/ThemeProvider";
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
  const onClose = options.onClose ?? vi.fn();
  const result = render(
      <ThemeProvider repository={repository}>
        <SettingsPanel open={options.open ?? true} onClose={onClose} />
      </ThemeProvider>,
  );
  return { ...result, onClose, repository };
}

describe("SettingsPanel", () => {
  it("keeps reverse keyboard navigation inside the newly opened settings dialog", async () => {
    const user = userEvent.setup();
    render(<ThemeProvider repository={createBrowserSettingsRepository()}>
      <button>背景工作区按钮</button>
      <SettingsPanel open onClose={vi.fn()} />
    </ThemeProvider>);
    expect(screen.getByRole("dialog", { name: "设置" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "跟随系统" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "关闭设置" })).toHaveFocus();
  });

  it("switches immediately in both directions and restores the saved language on remount", async () => {
    const user = userEvent.setup();
    const repository = createBrowserSettingsRepository();
    const first = renderPanel({ repository });
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeVisible();
    expect(document.documentElement).toHaveAttribute("lang", "en");
    await user.click(screen.getByRole("button", { name: "Dark" }));
    await waitFor(async () => expect(await repository.read()).toMatchObject({ language: "en", theme: "dark" }));
    first.unmount();
    renderPanel({ repository });
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeVisible();
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "简体中文" }));
    expect(await screen.findByRole("dialog", { name: "设置" })).toBeVisible();
    expect(document.documentElement).toHaveAttribute("lang", "zh-CN");
    await waitFor(async () => expect(await repository.read()).toMatchObject({ language: "zh", theme: "dark" }));
  });

  it("serializes rapid language and theme changes while a previous write is pending", async () => {
    const user = userEvent.setup();
    const storage = createBrowserSettingsRepository();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let writes = 0;
    const repository: SettingsRepository = {
      read: storage.read,
      write: async (value) => { if (++writes === 1) await pending; await storage.write(value); },
    };
    renderPanel({ repository });
    await user.click(screen.getByRole("button", { name: "English" }));
    await user.click(await screen.findByRole("button", { name: "Dark" }));
    await user.click(screen.getByRole("button", { name: "简体中文" }));
    expect(writes).toBe(1);
    await act(async () => release());
    await waitFor(async () => expect(await storage.read()).toMatchObject({ language: "zh", theme: "dark" }));
  });

  it("reports failed persistence and lets the same language choice retry", async () => {
    const user = userEvent.setup();
    const storage = createBrowserSettingsRepository();
    const write = vi.fn().mockRejectedValueOnce(new Error("Disk full")).mockImplementation(storage.write);
    const warning = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      renderPanel({ repository: { read: storage.read, write } });
      await user.click(screen.getByRole("button", { name: "English" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Unable to save settings");
      await user.click(screen.getByRole("button", { name: "English" }));
      await waitFor(async () => expect((await storage.read()).language).toBe("en"));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally { warning.mockRestore(); }
  });

  it("renders nothing when closed", () => {
    renderPanel({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers appearance settings without assistant model controls", () => {
    renderPanel();
    expect(screen.getByRole("dialog", { name: "设置" })).toHaveFocus();
    expect(screen.getByRole("heading", { name: "外观" })).toBeVisible();
    expect(screen.getByRole("button", { name: "跟随系统" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "助手模型" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "测试连接" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
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
