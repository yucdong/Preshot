import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SetPlanTitleResult } from "../../../domain/plan/canvas/naming";
import { CanvasTitle } from "./CanvasTitle";

describe("CanvasTitle", () => {
  it("renders the current title as an accessible editable control", () => {
    render(
      <CanvasTitle
        title="Editorial"
        onCommit={() => ({ ok: true, plan: { title: "Editorial" } } as SetPlanTitleResult)}
      />,
    );

    expect(screen.getByRole("textbox", { name: "画布标题" })).toHaveValue("Editorial");
  });

  it("commits the draft on blur", async () => {
    const onCommit = vi.fn<() => SetPlanTitleResult>(() => ({
      ok: true,
      plan: { title: "Campaign" },
    } as SetPlanTitleResult));
    const user = userEvent.setup();

    render(<CanvasTitle title="Editorial" onCommit={onCommit} />);

    const input = screen.getByRole("textbox", { name: "画布标题" });
    await user.clear(input);
    await user.type(input, "Campaign");
    await user.tab();

    expect(onCommit).toHaveBeenCalledWith("Campaign");
  });

  it("keeps an empty draft in edit mode and explains the validation error", async () => {
    const onCommit = vi.fn<() => SetPlanTitleResult>(() => ({ ok: false, reason: "empty" }));
    const user = userEvent.setup();

    render(<CanvasTitle title="Editorial" onCommit={onCommit} />);

    const input = screen.getByRole("textbox", { name: "画布标题" });
    await user.clear(input);
    await user.tab();

    expect(input).toHaveValue("");
    expect(screen.getByRole("alert")).toHaveTextContent("画布标题不能为空");
  });

  it("resets its draft and validation error when the committed title changes", async () => {
    const onCommit = vi.fn<() => SetPlanTitleResult>(() => ({ ok: false, reason: "empty" }));
    const user = userEvent.setup();
    const { rerender } = render(<CanvasTitle title="Editorial" onCommit={onCommit} />);

    const input = screen.getByRole("textbox", { name: "画布标题" });
    await user.clear(input);
    await user.tab();
    expect(screen.getByRole("alert")).toHaveTextContent("画布标题不能为空");

    rerender(<CanvasTitle title="Campaign" onCommit={onCommit} />);

    expect(screen.getByRole("textbox", { name: "画布标题" })).toHaveValue("Campaign");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("restores the committed title on Escape", async () => {
    const user = userEvent.setup();

    render(<CanvasTitle title="Editorial" onCommit={vi.fn()} />);

    const input = screen.getByRole("textbox", { name: "画布标题" });
    await user.clear(input);
    await user.type(input, "Draft");
    await user.keyboard("{Escape}");

    expect(input).toHaveValue("Editorial");
  });
});
