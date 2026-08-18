import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ReferenceImageLightbox } from "./ReferenceImageLightbox";

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
          cropAction={{
            sourceWidth: 1200,
            sourceHeight: 800,
            confirm: vi.fn(),
          }}
          onClose={() => setOpen(false)}
          src="data:image/png;base64,AA"
        />
      ) : null}
    </>
  );
}

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

  it("moves focus into crop controls after keyboard activation", async () => {
    const user = userEvent.setup();
    render(
      <ReferenceImageLightbox
        alt="参考图"
        cropAction={{
          sourceWidth: 1200,
          sourceHeight: 800,
          confirm: vi.fn(),
        }}
        onClose={vi.fn()}
        src="data:image/png;base64,AA"
      />,
    );

    const cropButton = screen.getByRole("button", { name: "裁剪" });
    cropButton.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("group", { name: /裁剪预览/ })).toHaveFocus();
  });

  it("redirects outside focus and cycles focus within crop mode", async () => {
    const user = userEvent.setup();
    const outside = document.createElement("button");
    document.body.append(outside);
    render(
      <ReferenceImageLightbox
        alt="参考图"
        cropAction={{
          sourceWidth: 1200,
          sourceHeight: 800,
          confirm: vi.fn(),
        }}
        onClose={vi.fn()}
        src="data:image/png;base64,AA"
      />,
    );

    await user.click(screen.getByRole("button", { name: "裁剪" }));
    await waitFor(() =>
      expect(screen.getByRole("group", { name: /裁剪预览/ })).toHaveFocus());
    const closeButton = screen.getByRole("button", { name: "关闭图片" });
    const confirmButton = screen.getByRole("button", { name: "确认裁剪" });

    outside.focus();
    fireEvent.keyDown(outside, { key: "Tab" });
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(closeButton, { key: "Tab", shiftKey: true });
    expect(confirmButton).toHaveFocus();

    fireEvent.keyDown(confirmButton, { key: "Tab" });
    expect(closeButton).toHaveFocus();

    outside.focus();
    fireEvent.keyDown(outside, { key: "Tab", shiftKey: true });
    expect(confirmButton).toHaveFocus();
    outside.remove();
  });

  it("restores crop and viewer focus after keyboard cancel and close", async () => {
    const user = userEvent.setup();
    render(<LightboxHarness />);
    const trigger = screen.getByRole("button", { name: "打开参考图" });

    await user.click(trigger);
    const cropButton = screen.getByRole("button", { name: "裁剪" });
    cropButton.focus();
    await user.keyboard("{Enter}");

    const cancelButton = screen.getByRole("button", { name: "取消" });
    cancelButton.focus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "裁剪" })).toHaveFocus());

    const closeButton = screen.getByRole("button", { name: "关闭图片" });
    closeButton.focus();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("opens crop mode with every preset and rolls draft changes back on cancel", async () => {
    const user = userEvent.setup();
    render(
      <ReferenceImageLightbox
        alt="参考图"
        cropAction={{
          sourceWidth: 1200,
          sourceHeight: 800,
          confirm: vi.fn(),
        }}
        onClose={vi.fn()}
        src="data:image/png;base64,AA"
      />,
    );

    await user.click(screen.getByRole("button", { name: "裁剪" }));
    expect(screen.getByText(/不会修改外部源文件/)).toBeVisible();
    for (const name of ["原始比例", "自由", "1:1", "4:5", "3:4", "16:9"]) {
      expect(screen.getByRole("button", { name })).toBeVisible();
    }

    await user.click(screen.getByRole("button", { name: "1:1" }));
    expect(screen.getByRole("button", { name: "1:1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.change(screen.getByLabelText("裁剪缩放"), {
      target: { value: "2" },
    });

    await user.click(screen.getByRole("button", { name: "取消" }));
    await user.click(screen.getByRole("button", { name: "裁剪" }));
    expect(screen.getByRole("button", { name: "原始比例" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("裁剪缩放")).toHaveValue("1");

    await user.click(screen.getByRole("button", { name: "自由" }));
    expect(
      screen.getByRole("slider", { name: "自由裁剪宽度" }),
    ).toBeVisible();
    expect(
      screen.getByRole("slider", { name: "自由裁剪高度" }),
    ).toBeVisible();
    fireEvent.change(screen.getByRole("slider", { name: "自由裁剪宽度" }), {
      target: { value: "0.5" },
    });
    fireEvent.change(screen.getByRole("slider", { name: "自由裁剪高度" }), {
      target: { value: "0.4" },
    });
    expect(screen.getByRole("slider", { name: "自由裁剪宽度" }))
      .toHaveValue("0.5");
    expect(screen.getByRole("slider", { name: "自由裁剪高度" }))
      .toHaveValue("0.4");

    await user.click(screen.getByRole("button", { name: "重置" }));
    expect(screen.getByRole("button", { name: "原始比例" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("裁剪缩放")).toHaveValue("1");
    expect(
      screen.queryByRole("slider", { name: "自由裁剪宽度" }),
    ).not.toBeInTheDocument();
  });

  it("confirms once, reports progress, and returns to the refreshed viewer", async () => {
    const user = userEvent.setup();
    let finish: (() => void) | undefined;
    const confirm = vi.fn().mockReturnValue(new Promise<void>((resolve) => {
      finish = resolve;
    }));
    render(
      <ReferenceImageLightbox
        alt="参考图"
        cropAction={{ sourceWidth: 1200, sourceHeight: 800, confirm }}
        onClose={vi.fn()}
        src="data:image/png;base64,AA"
      />,
    );

    await user.click(screen.getByRole("button", { name: "裁剪" }));
    await user.click(screen.getByRole("button", { name: "1:1" }));
    await user.click(screen.getByRole("button", { name: "确认裁剪" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith({
      x: 0.166667,
      y: 0,
      width: 0.666667,
      height: 1,
    });
    expect(screen.getByRole("button", { name: "正在裁剪…" })).toBeDisabled();
    expect(screen.getByText("正在裁剪项目图片副本…")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "正在裁剪…" }));
    expect(confirm).toHaveBeenCalledTimes(1);

    finish?.();
    expect(
      await screen.findByText("裁剪已应用到项目图片副本，外部源文件未更改。"),
    ).toBeVisible();
    expect(screen.getByRole("img", { name: "参考图" })).toBeVisible();
  });

  it("keeps crop mode open with an actionable failure and can retry", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn()
      .mockRejectedValueOnce(new Error("Access denied"))
      .mockResolvedValue(undefined);
    render(
      <ReferenceImageLightbox
        alt="参考图"
        cropAction={{ sourceWidth: 1200, sourceHeight: 800, confirm }}
        onClose={vi.fn()}
        src="data:image/png;base64,AA"
      />,
    );

    await user.click(screen.getByRole("button", { name: "裁剪" }));
    await user.click(screen.getByRole("button", { name: "确认裁剪" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "裁剪项目图片副本失败：Access denied",
    );
    expect(screen.getByRole("button", { name: "确认裁剪" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "确认裁剪" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
  });

  it("supports pointer panning and keyboard focal-point nudging", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ReferenceImageLightbox
        alt="参考图"
        cropAction={{ sourceWidth: 1200, sourceHeight: 800, confirm }}
        onClose={vi.fn()}
        src="data:image/png;base64,AA"
      />,
    );

    await user.click(screen.getByRole("button", { name: "裁剪" }));
    await user.click(screen.getByRole("button", { name: "1:1" }));
    fireEvent.change(screen.getByRole("slider", { name: "裁剪缩放" }), {
      target: { value: "2" },
    });
    const preview = screen.getByRole("group", { name: /裁剪预览/ });
    vi.spyOn(preview, "getBoundingClientRect").mockReturnValue({
      bottom: 300,
      height: 300,
      left: 0,
      right: 300,
      top: 0,
      width: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(preview, { button: 0, clientX: 150, clientY: 150 });
    fireEvent.pointerMove(document, { clientX: 180, clientY: 180 });
    fireEvent.pointerUp(document);
    fireEvent.keyDown(preview, { key: "ArrowRight" });
    await user.click(screen.getByRole("button", { name: "确认裁剪" }));

    const crop = confirm.mock.calls[0][0];
    expect(crop.x).toBeCloseTo(0.303334, 5);
    expect(crop.y).toBeCloseTo(0.2, 5);
    expect(crop.width).toBeCloseTo(0.333333, 5);
    expect(crop.height).toBeCloseTo(0.5, 5);
  });

  it("Escape and backdrop close the viewer, discard draft crop, and restore focus", async () => {
    const user = userEvent.setup();
    render(<LightboxHarness />);
    const trigger = screen.getByRole("button", { name: "打开参考图" });

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "裁剪" }));
    await user.click(screen.getByRole("button", { name: "1:1" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "裁剪" }));
    expect(screen.getByRole("button", { name: "原始比例" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByTestId("reference-image-backdrop"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("does not close while confirmation is in flight", async () => {
    const user = userEvent.setup();
    let finish: (() => void) | undefined;
    const confirm = vi.fn().mockReturnValue(new Promise<void>((resolve) => {
      finish = resolve;
    }));
    const onClose = vi.fn();
    render(
      <ReferenceImageLightbox
        alt="参考图"
        cropAction={{ sourceWidth: 1200, sourceHeight: 800, confirm }}
        onClose={onClose}
        src="data:image/png;base64,AA"
      />,
    );

    await user.click(screen.getByRole("button", { name: "裁剪" }));
    await user.click(screen.getByRole("button", { name: "确认裁剪" }));
    await user.keyboard("{Escape}");
    await user.click(screen.getByTestId("reference-image-backdrop"));
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByText("正在裁剪项目图片副本，完成前无法关闭。"),
    ).toBeVisible();

    finish?.();
    expect(await screen.findByRole("img", { name: "参考图" })).toBeVisible();
  });
});
