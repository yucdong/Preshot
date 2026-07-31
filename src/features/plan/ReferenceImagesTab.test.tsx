import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReferenceImagesTab } from "./ReferenceImagesTab";

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

function handlers() {
  return {
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
}

const groups = [
  { id: "g1", title: "Lookbook", description: "<p>Warm editorial mood</p>", columnsPerRow: 3, images: [{ id: "i1", file: "references/0001.png" }] },
];

describe("ReferenceImagesTab", () => {
  it("renders a group with its image and fires import/open callbacks", async () => {
    const user = userEvent.setup();
    const h = handlers();
    render(
      <ReferenceImagesTab
        groups={groups}
        imageSrc={(file) => (file === "references/0001.png" ? "data:image/png;base64,AA" : undefined)}
        {...h}
      />,
    );

    const group = screen.getByRole("group", { name: "Reference group: Lookbook" });
    expect(within(group).getByRole("img", { name: "Reference image 1" })).toBeVisible();

    await user.click(within(group).getByRole("button", { name: "Add reference image" }));
    expect(h.onAddImage).toHaveBeenCalledWith("g1");

    await user.click(within(group).getByRole("button", { name: "Open reference image 1" }));
    expect(h.onOpenImage).toHaveBeenCalledWith("references/0001.png");

    await user.selectOptions(within(group).getByRole("combobox", { name: "Images per row" }), "4");
    expect(h.onSetColumns).toHaveBeenCalledWith("g1", 4);

    await user.click(screen.getByRole("button", { name: "Add reference group" }));
    expect(h.onAddGroup).toHaveBeenCalled();
  });

  it("persists a renamed group title once, on blur", async () => {
    const user = userEvent.setup();
    const h = handlers();
    render(
      <ReferenceImagesTab
        groups={groups}
        imageSrc={() => "data:image/png;base64,AA"}
        {...h}
      />,
    );

    const group = screen.getByRole("group", { name: "Reference group: Lookbook" });
    const input = within(group).getByRole("textbox", { name: "Group title" });

    await user.clear(input);
    await user.type(input, "Summer Set");
    expect(h.onRenameGroup).not.toHaveBeenCalled();

    await user.tab();
    expect(h.onRenameGroup).toHaveBeenCalledTimes(1);
    expect(h.onRenameGroup).toHaveBeenCalledWith("g1", "Summer Set");
  });

  it("shows a rich-text description editor and emits html on edit", async () => {
    const h = handlers();
    render(
      <ReferenceImagesTab
        groups={groups}
        imageSrc={() => "data:image/png;base64,AA"}
        {...h}
      />,
    );

    const group = screen.getByRole("group", { name: "Reference group: Lookbook" });
    const editor = within(group).getByRole("textbox", { name: "Group description" });
    expect(editor).toHaveValue("<p>Warm editorial mood</p>");

    fireEvent.change(editor, { target: { value: "<p>Cool blue tones</p>" } });
    expect(h.onSetDescription).toHaveBeenCalledWith("g1", "<p>Cool blue tones</p>");
  });

  it("renders images inside a sortable, droppable grid", () => {
    render(
      <ReferenceImagesTab
        groups={groups}
        imageSrc={(file) => (file === "references/0001.png" ? "data:image/png;base64,AA" : undefined)}
        {...handlers()}
      />,
    );
    expect(screen.getByRole("button", { name: "Open reference image 1" })).toHaveAttribute(
      "aria-roledescription",
      "sortable",
    );
  });
});
