import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReferenceImageLightbox } from "./ReferenceImageLightbox";

describe("ReferenceImageLightbox", () => {
  it("shows the image and closes via button and Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ReferenceImageLightbox src="data:image/png;base64,AA" alt="Reference image 1" onClose={onClose} />);

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("img", { name: "Reference image 1" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Close image" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
