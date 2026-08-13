import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("opens Standard Colors and switches to the independent full RGB picker", async () => {
    renderEditor({ ariaLabel: "Notes", html: "<p>Shot list</p>", onChange: vi.fn() });
    await screen.findByText("Shot list");

    fireEvent.pointerDown(screen.getByRole("button", { name: "选择文字颜色" }));

    expect(screen.getByRole("listbox", { name: "标准颜色" })).toBeVisible();

    fireEvent.pointerDown(screen.getByRole("button", { name: /More Colors/ }));

    expect(screen.queryByRole("listbox", { name: "标准颜色" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "更多颜色" })).toBeVisible();
    expect(screen.getByRole("application", { name: "完整色相与饱和度色盘" })).toBeVisible();
  });

  it("imports an image and persists only its project-relative asset path", async () => {
    const onChange = vi.fn();
    const onInsertImage = vi.fn().mockResolvedValue({
      file: "references/portrait.png",
      dataUrl: "data:image/png;base64,INLINE",
      alt: "portrait.png",
    });
    const { container } = renderEditor({
      ariaLabel: "Notes",
      html: "<p>Shot list</p>",
      onChange,
      onInsertImage,
    });
    await screen.findByText("Shot list");

    fireEvent.pointerDown(screen.getByRole("button", { name: "插入图片" }));

    await waitFor(() => expect(onInsertImage).toHaveBeenCalledOnce());
    await waitFor(() => {
      const emitted = onChange.mock.calls.at(-1)?.[0] as string | undefined;
      expect(emitted).toContain('src="references/portrait.png"');
      expect(emitted).not.toContain("data:image/png;base64,INLINE");
    });
    const insertedImage = container.querySelector("img");
    expect(insertedImage).toBeInTheDocument();
    fireEvent.load(insertedImage!);
    expect(screen.getByRole("img", { name: "portrait.png" })).toHaveAttribute(
      "src",
      "data:image/png;base64,INLINE",
    );
  });

  it("resizes an image from its bottom-right handle and persists proportional dimensions", async () => {
    const onChange = vi.fn();
    const { container } = renderEditor({
      ariaLabel: "Notes",
      html: '<img src="references/portrait.png" alt="portrait.png" width="120" height="80">',
      onChange,
      resolveImageSrc: () => "data:image/png;base64,INLINE",
    });
    await waitFor(() => expect(container.querySelector("img")).toBeInTheDocument());
    const image = container.querySelector("img")!;
    fireEvent.load(image);
    const frame = image.closest("figure")!;
    frame.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 120,
      bottom: 80,
      width: 120,
      height: 80,
      toJSON: () => ({}),
    });
    const handle = container.querySelector('[data-resize-handle="bottom-right"]');
    expect(handle).toBeInTheDocument();

    fireEvent.pointerDown(handle!, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(document, { clientX: 60, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(document, { pointerId: 1 });

    await waitFor(() => {
      const emitted = onChange.mock.calls.at(-1)?.[0] as string | undefined;
      expect(emitted).toContain('src="references/portrait.png"');
      expect(emitted).toContain('width="180"');
      expect(emitted).toContain('height="120"');
      expect(emitted).not.toContain("data:image/png;base64,INLINE");
    });
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
