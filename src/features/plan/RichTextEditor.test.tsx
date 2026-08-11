import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RichTextEditor } from "./RichTextEditor";
import { ThemeProvider } from "../../app/theme/ThemeProvider";
import type { SettingsRepository } from "../../domain/settings/ports";

const mockRepository: SettingsRepository = {
  read: vi.fn().mockResolvedValue({ theme: "light" }),
  write: vi.fn().mockResolvedValue(undefined),
};

function renderEditor(props: Parameters<typeof RichTextEditor>[0]) {
  return render(
    <ThemeProvider repository={mockRepository}>
      <RichTextEditor {...props} />
    </ThemeProvider>
  );
}

describe("RichTextEditor", () => {
  it("uses the TipTap engine and hydrates external html updates without an echo", async () => {
    const onChange = vi.fn();
    const { rerender } = renderEditor({
      ariaLabel: "Notes",
      html: "<p>First draft</p>",
      onChange,
    });

    const editor = await screen.findByRole("group", { name: "Notes" });
    expect(editor).toHaveAttribute("data-editor-engine", "tiptap");

    rerender(
      <ThemeProvider repository={mockRepository}>
        <RichTextEditor ariaLabel="Notes" html="<p>Revised draft</p>" onChange={onChange} />
      </ThemeProvider>,
    );

    expect(await screen.findByText("Revised draft")).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders a labelled editor region", () => {
    renderEditor({ ariaLabel: "Photography plan", html: "<p>Hello</p>", onChange: vi.fn() });
    expect(screen.getByRole("group", { name: "Photography plan" })).toBeInTheDocument();
  });

  it("hydrates provided html into visible text", async () => {
    renderEditor({ ariaLabel: "Notes", html: "<p>Shot list</p>", onChange: vi.fn() });
    expect(await screen.findByText("Shot list")).toBeVisible();
  });

  it("keeps the formatting toolbar visible without focus or a text selection", async () => {
    renderEditor({ ariaLabel: "Notes", html: "<p>Shot list</p>", onChange: vi.fn() });
    await screen.findByText("Shot list");
    expect(screen.getByRole("toolbar")).toBeVisible();
  });

  it("opens the color palette on pointerdown", async () => {
    renderEditor({ ariaLabel: "Notes", html: "<p>Shot list</p>", onChange: vi.fn() });
    await screen.findByText("Shot list");

    fireEvent.pointerDown(screen.getByRole("button", { name: "选择文字颜色" }));

    expect(screen.getByRole("listbox", { name: "文字颜色" })).toBeVisible();
  });

  it("does not emit onChange while hydrating non-empty html", async () => {
    const onChange = vi.fn();
    renderEditor({ ariaLabel: "Notes", html: "<p>Seed</p>", onChange });
    await screen.findByText("Seed");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not emit onChange while hydrating empty html", async () => {
    const onChange = vi.fn();
    renderEditor({ ariaLabel: "Notes", html: "", onChange });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onChange).not.toHaveBeenCalled();
  });
});
