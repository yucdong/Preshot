import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ReferenceImageLightbox } from "./ReferenceImageLightbox";
import { DialogPortalContext } from "../../shared/ui/DialogPortalContext";

function LightboxHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} type="button">
        打开参考图
      </button>
      {open ? (
        <ReferenceImageLightbox
          alt="参考图"
          onClose={() => setOpen(false)}
          src="data:image/png;base64,AA"
        />
      ) : null}
    </>
  );
}

describe("ReferenceImageLightbox", () => {
  it("keeps programmatic focus inside the topmost viewer", () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    const { unmount } = render(<ReferenceImageLightbox
      src="data:image/png;base64,AA" alt="参考图" onClose={vi.fn()} />);
    outside.focus();
    expect(screen.getByRole("button", { name: "关闭图片" })).toHaveFocus();
    unmount();
    outside.remove();
  });
  it("describes the draft preview without editing controls", () => {
    render(<ReferenceImageLightbox src="data:image/png;base64,AA" alt="参考图"
      copyScope="draft" onClose={vi.fn()} />);
    expect(screen.getByText("查看当前素材草稿中的参考图片副本。")).toBeVisible();
    expect(screen.queryByRole("button", { name: /裁剪|裁切|重置/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });
  it("portals inside the active modal without leaking Escape or changing inert siblings", () => {
    const host = document.createElement("div");
    const outside = document.createElement("div");
    outside.inert = true;
    document.body.append(host, outside);
    const onClose = vi.fn();
    const parentKey = vi.fn();
    const { unmount } = render(
      <div onKeyDown={parentKey}>
        <DialogPortalContext.Provider value={() => host}>
          <ReferenceImageLightbox src="data:image/png;base64,AA" alt="参考图" onClose={onClose} />
        </DialogPortalContext.Provider>
      </div>,
    );
    expect(host).toContainElement(screen.getByRole("dialog"));
    fireEvent.keyDown(screen.getByRole("button", { name: "关闭图片" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(parentKey).not.toHaveBeenCalled();
    expect(outside.inert).toBe(true);
    unmount();
    host.remove();
    outside.remove();
  });
  it("shows the image and closes via button and Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ReferenceImageLightbox src="data:image/png;base64,AA" alt="参考图" onClose={onClose} />);

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("dialog").parentElement).toHaveAttribute("data-reference-image-lightbox", "");
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

  it("cycles keyboard focus between close and the copyable image", async () => {
    const user = userEvent.setup();
    render(<ReferenceImageLightbox src="data:image/png;base64,AA" alt="参考图" onClose={vi.fn()} />);
    const close = screen.getByRole("button", { name: "关闭图片" });
    const image = screen.getByRole("img", { name: "参考图" });
    expect(close).toHaveFocus();
    await user.tab();
    expect(image).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(image).toHaveFocus();
    await user.click(image);
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("restores the opener after Escape and can reopen for another preview", async () => {
    const user = userEvent.setup();
    render(<LightboxHarness />);
    const opener = screen.getByRole("button", { name: "打开参考图" });
    await user.click(opener);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(opener).toHaveFocus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(opener);
    expect(screen.getByRole("img", { name: "参考图" })).toBeVisible();
    await user.click(screen.getByTestId("reference-image-backdrop"));
    expect(opener).toHaveFocus();
  });
});
