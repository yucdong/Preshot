import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReferenceImageLightbox } from "./ReferenceImageLightbox";

describe("ReferenceImageLightbox", () => {
  it("shows the image and closes via button and Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ReferenceImageLightbox src="data:image/png;base64,AA" alt="参考图" onClose={onClose} />);

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("img", { name: "参考图" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "关闭图片" }).querySelector('[data-icon="close"]'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关闭图片" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("closes when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ReferenceImageLightbox src="data:image/png;base64,AA" alt="参考图" onClose={onClose} />);

    const backdrop = screen.getByRole("dialog").parentElement as HTMLElement;
    await user.click(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not expose an image-size reset action", () => {
    render(
      <ReferenceImageLightbox
        src="data:image/png;base64,AA"
        alt="参考图"
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /恢复/ })).not.toBeInTheDocument();
  });

  it("returns focus to the control that opened the source view", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const { unmount } = render(
      <ReferenceImageLightbox
        src="data:image/png;base64,AA"
        alt="参考图"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "关闭图片" })).toHaveFocus();
    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
