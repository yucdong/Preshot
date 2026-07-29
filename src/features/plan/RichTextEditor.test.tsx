import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RichTextEditor } from "./RichTextEditor";

describe("RichTextEditor", () => {
  it("renders provided html and exposes an accessible textbox", () => {
    render(<RichTextEditor ariaLabel="Photography plan" html="<p>Hello</p>" onChange={vi.fn()} />);
    const box = screen.getByRole("textbox", { name: "Photography plan" });
    expect(box).toHaveTextContent("Hello");
  });

  it("exposes placeholder metadata for empty content", () => {
    const { container } = render(
      <RichTextEditor
        ariaLabel="Photography plan"
        html=""
        onChange={vi.fn()}
        placeholder="Describe this set of references — mood, lighting, styling, or notes…"
      />,
    );

    expect(
      container.querySelector(
        '[data-placeholder="Describe this set of references — mood, lighting, styling, or notes…"]',
      ),
    ).toBeInTheDocument();
  });

  it("emits html when the user types", async () => {
    const onChange = vi.fn();
    render(<RichTextEditor ariaLabel="Notes" html="" onChange={onChange} />);

    const textbox = screen.getByRole("textbox", { name: "Notes" });
    
    // jsdom limitation: userEvent.keyboard doesn't reliably drive ProseMirror
    // Directly manipulate the contenteditable to trigger input event
    textbox.textContent = "Shot list";
    textbox.dispatchEvent(new Event("input", { bubbles: true }));

    // Wait for TipTap to process the change
    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("Shot list");
  });

  it("toggles bold via the toolbar and reflects active state", async () => {
    const user = userEvent.setup();
    render(<RichTextEditor ariaLabel="Notes" html="" onChange={vi.fn()} />);

    const textbox = screen.getByRole("textbox", { name: "Notes" });
    const boldButton = screen.getByRole("button", { name: "Bold" });

    // Focus the editor first
    textbox.focus();

    // Initially, bold should not be active
    expect(boldButton).toHaveAttribute("aria-pressed", "false");

    // Click to toggle bold on
    await user.click(boldButton);

    // Bold should now be active
    expect(boldButton).toHaveAttribute("aria-pressed", "true");

    // Click again to toggle off
    await user.click(boldButton);

    // Bold should be inactive
    expect(boldButton).toHaveAttribute("aria-pressed", "false");
  });
});
