import { render, screen, waitFor } from "@testing-library/react";
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
