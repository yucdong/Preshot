import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ThemeProvider } from "../../app/theme/ThemeProvider";
import { AgentModelSettingsController } from "../../domain/agent";
import { createBrowserAgentModelProbe } from "../../infrastructure/agent/browserAgentModelProbe";
import { createSettingsAgentModelStore } from "../../infrastructure/agent/settingsAgentModelStore";
import { createBrowserSettingsRepository } from "../../infrastructure/settings/browserSettings";
import { AgentModelSettingsProvider } from "../agent/AgentModelSettingsContext";
import { SettingsButton } from "./SettingsButton";

function renderButton() {
  const repository = createBrowserSettingsRepository();
  const controller = new AgentModelSettingsController({
    store: createSettingsAgentModelStore(repository),
    probe: createBrowserAgentModelProbe(),
  });
  return render(
    <AgentModelSettingsProvider controller={controller}>
      <ThemeProvider repository={repository}>
        <SettingsButton />
      </ThemeProvider>
    </AgentModelSettingsProvider>,
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
  });
});
