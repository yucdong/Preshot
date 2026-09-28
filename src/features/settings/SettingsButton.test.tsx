import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ThemeProvider } from "../../app/theme/ThemeProvider";
import { createBrowserSettingsRepository } from "../../infrastructure/settings/browserSettings";
import { SettingsButton } from "./SettingsButton";

function renderButton() {
  const repository = createBrowserSettingsRepository();
  return render(
      <ThemeProvider repository={repository}>
        <SettingsButton />
      </ThemeProvider>,
  );
}

describe("SettingsButton", () => {
  it("has an accessible name and opens the shared settings dialog", async () => {
    const user = userEvent.setup();
    renderButton();

    const button = screen.getByRole("button", { name: "设置" });
    expect(button).toBeVisible();
    await user.click(button);
    expect(screen.getByRole("dialog", { name: "设置" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });
});
