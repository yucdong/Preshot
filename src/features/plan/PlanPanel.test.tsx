import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlanPanel } from "./PlanPanel";

vi.mock("./RichTextEditor", () => ({
  RichTextEditor: ({ html, onChange, ariaLabel, placeholder }: {
    html: string;
    onChange(html: string): void;
    ariaLabel: string;
    placeholder?: string;
    compact?: boolean;
  }) => (
    <textarea
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      value={html}
    />
  ),
}));

const noop = {
  onAddGroup: vi.fn(),
  onRenameGroup: vi.fn(),
  onSetDescription: vi.fn(),
  onDeleteGroup: vi.fn(),
  onSetColumns: vi.fn(),
  onAddImage: vi.fn(),
  onRemoveImage: vi.fn(),
  onOpenImage: vi.fn(),
  onMoveImage: vi.fn(),
};

describe("PlanPanel", () => {
  it("shows the photography plan, reference images, and save status without tabs", () => {
    render(
      <PlanPanel
        exporting={false}
        groups={[]}
        imageSrc={() => undefined}
        onExport={vi.fn()}
        onSetPhotographyPlan={vi.fn()}
        photographyPlan=""
        saveState="saved"
        {...noop}
      />,
    );

    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByRole("heading", { name: "拍摄笔记" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "样片集" })).toBeVisible();
    expect(screen.getByRole("button", { name: "添加参考分组" })).toBeVisible();
    expect(screen.getByTestId("save-status")).toHaveTextContent("已保存所有更改");
  });

  it("renders the photography plan editor", () => {
    render(
      <PlanPanel
        exporting={false}
        groups={[]}
        imageSrc={() => undefined}
        onExport={vi.fn()}
        onSetPhotographyPlan={vi.fn()}
        photographyPlan="<p>Plan body</p>"
        saveState="saved"
        {...noop}
      />,
    );

    expect(screen.getByRole("textbox", { name: "摄影计划" })).toHaveValue("<p>Plan body</p>");
  });

  it("reflects the current save state", () => {
    render(
      <PlanPanel
        exporting={false}
        groups={[]}
        imageSrc={() => undefined}
        onExport={vi.fn()}
        onSetPhotographyPlan={vi.fn()}
        photographyPlan=""
        saveState="saving"
        {...noop}
      />,
    );

    expect(screen.getByTestId("save-status")).toHaveTextContent("正在保存…");
  });

  it("renders a contextual error banner when provided", () => {
    render(
      <PlanPanel
        error="Unable to load the project plan"
        exporting={false}
        groups={[]}
        imageSrc={() => undefined}
        onExport={vi.fn()}
        onSetPhotographyPlan={vi.fn()}
        photographyPlan=""
        saveState="unsaved"
        {...noop}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("操作未能完成，请重试。");
  });

  it("invokes onExport when Export PDF is clicked", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    render(
      <PlanPanel
        exporting={false}
        groups={[]}
        imageSrc={() => undefined}
        onExport={onExport}
        onSetPhotographyPlan={vi.fn()}
        photographyPlan=""
        saveState="saved"
        {...noop}
      />,
    );
    await user.click(screen.getByRole("button", { name: "导出 PDF" }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});
