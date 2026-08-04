import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SettingsButton } from "./SettingsButton";
import { ThemeProvider } from "../../app/theme/ThemeProvider";
import type { SettingsRepository } from "../../domain/settings/ports";

// Minimal fake repository for tests
const fakeRepository: SettingsRepository = {
  read: async () => ({ theme: "system" }),
  write: async () => {},
};

describe("SettingsButton", () => {
  it("renders the gear button with accessible name", () => {
    render(
      <ThemeProvider repository={fakeRepository}>
        <SettingsButton />
      </ThemeProvider>,
    );

    const button = screen.getByRole("button", { name: "设置" });
    expect(button).toBeInTheDocument();
  });

  it("opens the settings panel when clicked", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider repository={fakeRepository}>
        <SettingsButton />
      </ThemeProvider>,
    );

    const button = screen.getByRole("button", { name: "设置" });
    await user.click(button);

    // Panel should appear with role="dialog" and title
    const dialog = screen.getByRole("dialog", { name: "设置" });
    expect(dialog).toBeInTheDocument();
  });
});
