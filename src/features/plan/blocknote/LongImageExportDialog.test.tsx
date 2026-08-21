// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  LongImageExportDialog,
  type LongImageExportSettings,
} from "./LongImageExportDialog";

function DialogHarness({
  onStart = vi.fn(() => true),
}: {
  onStart?: (settings: LongImageExportSettings) => boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} type="button">
        打开长图设置
      </button>
      {open ? (
        <LongImageExportDialog
          onCancel={() => setOpen(false)}
          onStart={(settings) => {
            const started = onStart(settings);
            if (started) setOpen(false);
            return started;
          }}
        />
      ) : null}
    </>
  );
}

describe("LongImageExportDialog", () => {
  it("defaults to one-image WeChat-compatible JPEG settings", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn(() => true);
    render(<DialogHarness onStart={onStart} />);

    await user.click(screen.getByRole("button", { name: "打开长图设置" }));

    expect(screen.getByRole("dialog", { name: "导出长图" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "微信兼容" })).toBeChecked();
    expect(screen.getByLabelText("图片格式")).toHaveValue("jpeg");
    expect(screen.getByRole("radio", { name: "900 px" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "自动分图" }))
      .not.toBeChecked();
    expect(screen.getByLabelText("JPEG 体积目标")).toHaveValue("wechat");
    expect(screen.getByText("每张目标不超过 1 MB / 6000 px")).toBeVisible();
    expect(screen.getByText(
      "默认将整个文档导出为一张长图；勾选“自动分图”后，才会按完整区块边界导出多张连续图片。",
    )).toBeVisible();
    expect(screen.getByText(
      "未启用自动分图时，如文档超过单张图片安全限制，请启用自动分图、缩短方案，或导出 PDF/DOCX。",
    )).toBeVisible();
    expect(screen.getByText(
      "最多导出 32 张；超出累计体积时，请缩短方案、分段导出、改用较小的 JPEG 预设，或导出 PDF/DOCX。",
    )).toBeVisible();

    await user.click(screen.getByRole("button", { name: "开始导出" }));

    expect(onStart).toHaveBeenCalledWith({
      allowSplit: false,
      preset: "wechat",
      width: 900,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps preset, format, JPEG target, width, and split controls coherent", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn(() => true);
    render(<DialogHarness onStart={onStart} />);
    await user.click(screen.getByRole("button", { name: "打开长图设置" }));

    await user.click(screen.getByRole("radio", { name: "高质量" }));
    expect(screen.getByRole("checkbox", { name: "自动分图" }))
      .not.toBeChecked();
    expect(screen.getByLabelText("图片格式")).toHaveValue("jpeg");
    expect(screen.getByLabelText("JPEG 体积目标")).toHaveValue(
      "high-quality",
    );
    expect(screen.getByText("每张目标不超过 3 MB / 8000 px")).toBeVisible();

    await user.click(screen.getByRole("radio", { name: "无损 PNG" }));
    expect(screen.getByRole("checkbox", { name: "自动分图" }))
      .not.toBeChecked();
    expect(screen.getByLabelText("图片格式")).toHaveValue("png");
    expect(screen.getByLabelText("JPEG 体积目标")).toBeDisabled();
    expect(screen.getByText("PNG 无损导出，每张目标不超过 8 MB / 4000 px"))
      .toBeVisible();

    await user.selectOptions(screen.getByLabelText("图片格式"), "jpeg");
    expect(screen.getByRole("checkbox", { name: "自动分图" }))
      .not.toBeChecked();
    expect(screen.getByRole("radio", { name: "微信兼容" })).toBeChecked();
    expect(screen.getByLabelText("JPEG 体积目标")).toBeEnabled();
    await user.click(screen.getByRole("radio", { name: "890 px" }));
    expect(screen.getByRole("checkbox", { name: "自动分图" }))
      .not.toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "自动分图" }));
    await user.click(screen.getByRole("button", { name: "开始导出" }));

    expect(onStart).toHaveBeenCalledWith({
      allowSplit: true,
      preset: "wechat",
      width: 890,
    });
  });

  it("starts each newly opened dialog with automatic splitting off", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    await user.click(screen.getByRole("button", { name: "打开长图设置" }));
    await user.click(screen.getByRole("checkbox", { name: "自动分图" }));
    expect(screen.getByRole("checkbox", { name: "自动分图" })).toBeChecked();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "打开长图设置" }));
    expect(screen.getByRole("checkbox", { name: "自动分图" }))
      .not.toBeChecked();
  });

  it("traps focus, cancels with Escape, and restores the trigger focus", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const trigger = screen.getByRole("button", { name: "打开长图设置" });

    await user.click(trigger);
    const firstControl = screen.getByRole("radio", { name: "微信兼容" });
    expect(firstControl).toHaveFocus();

    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "开始导出" })).toHaveFocus();
    await user.tab();
    expect(firstControl).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("stays open when the provider declines to start an export", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn(() => false);
    render(<DialogHarness onStart={onStart} />);

    await user.click(screen.getByRole("button", { name: "打开长图设置" }));
    await user.click(screen.getByRole("button", { name: "开始导出" }));

    expect(onStart).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog", { name: "导出长图" })).toBeVisible();
  });
});
