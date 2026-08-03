import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { InsertComponentMenu } from "./InsertComponentMenu";

describe("InsertComponentMenu", () => {
  it("renders an accessible button that opens a menu", async () => {
    const onInsert = vi.fn();
    const user = userEvent.setup();

    render(<InsertComponentMenu onInsert={onInsert} />);

    const button = screen.getByRole("button", { name: "插入组件" });
    expect(button).toBeVisible();

    await user.click(button);

    expect(screen.getByRole("menuitem", { name: "摄影计划" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "参考图组" })).toBeVisible();
  });

  it("calls onInsert with 'plan' when plan menu item is clicked", async () => {
    const onInsert = vi.fn();
    const user = userEvent.setup();

    render(<InsertComponentMenu onInsert={onInsert} />);

    await user.click(screen.getByRole("button", { name: "插入组件" }));
    await user.click(screen.getByRole("menuitem", { name: "摄影计划" }));

    expect(onInsert).toHaveBeenCalledWith("plan");
  });

  it("calls onInsert with 'reference' when reference menu item is clicked", async () => {
    const onInsert = vi.fn();
    const user = userEvent.setup();

    render(<InsertComponentMenu onInsert={onInsert} />);

    await user.click(screen.getByRole("button", { name: "插入组件" }));
    await user.click(screen.getByRole("menuitem", { name: "参考图组" }));

    expect(onInsert).toHaveBeenCalledWith("reference");
  });

  it("closes the menu after selection", async () => {
    const onInsert = vi.fn();
    const user = userEvent.setup();

    render(<InsertComponentMenu onInsert={onInsert} />);

    await user.click(screen.getByRole("button", { name: "插入组件" }));
    await user.click(screen.getByRole("menuitem", { name: "摄影计划" }));

    expect(screen.queryByRole("menuitem", { name: "摄影计划" })).not.toBeInTheDocument();
  });
});
