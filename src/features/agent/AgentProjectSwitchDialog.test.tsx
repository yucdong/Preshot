import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgentProjectSwitchDialog } from "./AgentProjectSwitchDialog";

describe("AgentProjectSwitchDialog", () => {
  it("offers wait, stop, and cancel with trapped focus", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    const trigger = document.createElement("button");
    trigger.textContent = "trigger";
    document.body.append(trigger);
    trigger.focus();
    const { rerender } = render(
      <AgentProjectSwitchDialog
        onCancelWait={vi.fn()}
        onChoose={onChoose}
        state={{
          status: "choosing",
          targetProjectId: "project-2",
          targetProjectName: "外景拍摄",
        }}
      />,
    );

    const dialog = screen.getByRole("dialog", {
      name: "切换到“外景拍摄”",
    });
    expect(dialog).toBeVisible();
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "等待并切换" }));
    expect(onChoose).toHaveBeenCalledWith("wait");

    rerender(
      <AgentProjectSwitchDialog
        onCancelWait={vi.fn()}
        onChoose={onChoose}
        state={{ status: "none" }}
      />,
    );
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("leaves queued waiting to the panel banner and exposes stopping progress", () => {
    const onCancelWait = vi.fn();
    const { rerender } = render(
      <AgentProjectSwitchDialog
        onCancelWait={onCancelWait}
        onChoose={vi.fn()}
        state={{
          status: "waiting",
          targetProjectId: "project-2",
          targetProjectName: "外景拍摄",
        }}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <AgentProjectSwitchDialog
        onCancelWait={onCancelWait}
        onChoose={vi.fn()}
        state={{
          status: "stopping",
          targetProjectId: "project-2",
          targetProjectName: "外景拍摄",
        }}
      />,
    );
    expect(screen.getByText(/正在停止助手/)).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
