import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./SettingsPanel";
import { ThemeProvider } from "../../app/theme/ThemeProvider";
import type { SettingsRepository } from "../../domain/settings/ports";

// Minimal fake repository for tests
const fakeRepository: SettingsRepository = {
  read: async () => ({ theme: "system" }),
  write: async () => {},
};

describe("SettingsPanel", () => {
  it("renders nothing when open is false", () => {
    render(
      <ThemeProvider repository={fakeRepository}>
        <SettingsPanel open={false} onClose={() => {}} />
      </ThemeProvider>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the dialog with three theme options when open", () => {
    render(
      <ThemeProvider repository={fakeRepository}>
        <SettingsPanel open={true} onClose={() => {}} />
      </ThemeProvider>,
    );

    const dialog = screen.getByRole("dialog", { name: "设置" });
    expect(dialog).toBeInTheDocument();

    // Check for theme label and three options
    expect(screen.getByText("主题")).toBeInTheDocument();
    expect(screen.getByText("浅色")).toBeInTheDocument();
    expect(screen.getByText("深色")).toBeInTheDocument();
    expect(screen.getByText("跟随系统")).toBeInTheDocument();
  });

  it("highlights the current theme option", async () => {
    const customRepository: SettingsRepository = {
      read: async () => ({ theme: "dark" }),
      write: async () => {},
    };

    const { rerender } = render(
      <ThemeProvider repository={customRepository}>
        <SettingsPanel open={true} onClose={() => {}} />
      </ThemeProvider>,
    );

    // Wait for theme to be loaded from repository
    await screen.findByText("深色");

    // Force a re-render to ensure theme state is applied
    rerender(
      <ThemeProvider repository={customRepository}>
        <SettingsPanel open={true} onClose={() => {}} />
      </ThemeProvider>,
    );

    // The "深色" button should have aria-pressed="true" or similar selected state
    const darkButton = screen.getByText("深色").closest("button");
    expect(darkButton).toHaveAttribute("aria-pressed", "true");
  });

  it("calls setTheme when an option is clicked", async () => {
    const user = userEvent.setup();
    const writeSpy = vi.fn().mockResolvedValue(undefined);
    const customRepository: SettingsRepository = {
      read: async () => ({ theme: "system" }),
      write: writeSpy,
    };

    render(
      <ThemeProvider repository={customRepository}>
        <SettingsPanel open={true} onClose={() => {}} />
      </ThemeProvider>,
    );

    const darkButton = screen.getByText("深色").closest("button");
    if (!darkButton) throw new Error("Dark button not found");
    await user.click(darkButton);

    // setTheme should have been called, which triggers repository.write
    expect(writeSpy).toHaveBeenCalledWith({
      theme: "dark",
      projectRailWidth: 192,
      assistantWidth: 272,
    });
  });

  it("calls onClose when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onCloseSpy = vi.fn();

    render(
      <ThemeProvider repository={fakeRepository}>
        <SettingsPanel open={true} onClose={onCloseSpy} />
      </ThemeProvider>,
    );

    await user.keyboard("{Escape}");

    expect(onCloseSpy).toHaveBeenCalled();
  });

  it("calls onClose when backdrop is clicked", async () => {
    const user = userEvent.setup();
    const onCloseSpy = vi.fn();

    render(
      <ThemeProvider repository={fakeRepository}>
        <SettingsPanel open={true} onClose={onCloseSpy} />
      </ThemeProvider>,
    );

    // Find the backdrop (the outer div with fixed positioning)
    const backdrop = screen.getByRole("dialog").parentElement;
    if (!backdrop) throw new Error("Backdrop not found");
    
    await user.click(backdrop);
    expect(onCloseSpy).toHaveBeenCalled();
  });
});
