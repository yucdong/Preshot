import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReferenceImagesTab } from "./ReferenceImagesTab";

function handlers() {
  return {
    onAddGroup: vi.fn(),
    onRenameGroup: vi.fn(),
    onDeleteGroup: vi.fn(),
    onSetColumns: vi.fn(),
    onAddImage: vi.fn(),
    onRemoveImage: vi.fn(),
    onOpenImage: vi.fn(),
  };
}

const groups = [
  { id: "g1", title: "Lookbook", columnsPerRow: 3, images: [{ id: "i1", file: "references/0001.png" }] },
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
});
