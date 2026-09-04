import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { BlockNoteCanvasToolbar } from "./BlockNoteCanvasToolbar";

function createHandlers() {
  return {
    onExportDocx: vi.fn(),
    onExportLongImage: vi.fn(() => true),
    onExportPdf: vi.fn(),
    onFitWidth: vi.fn(),
    onResetZoom: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
  };
}

function renderToolbar(
  handlers = createHandlers(),
  exportingPdf = false,
  exportingDocx = false,
  exportingLongImage = false,
) {
  return {
    handlers,
    ...render(
      <BlockNoteCanvasToolbar
        exportingDocx={exportingDocx}
        exportingLongImage={exportingLongImage}
        exportingPdf={exportingPdf}
        saveState="saved"
        zoom={0.85}
        {...handlers}
      />,
    ),
  };
}

function BusyExportHarness({
  completion,
  handlers,
}: {
  completion: Promise<void>;
  handlers: ReturnType<typeof createHandlers>;
}) {
  const [exportingPdf, setExportingPdf] = useState(false);

  return (
    <>
      <BlockNoteCanvasToolbar
        exportingDocx={false}
        exportingLongImage={false}
        exportingPdf={exportingPdf}
        saveState="saved"
        zoom={0.85}
        {...handlers}
        onExportPdf={() => {
          handlers.onExportPdf();
          setExportingPdf(true);
          void completion.then(() => setExportingPdf(false));
        }}
      />
      <button type="button">导出后的控件</button>
    </>
  );
}

describe("BlockNoteCanvasToolbar", () => {
  it("renders the closed export trigger and delegates zoom actions", async () => {
    const user = userEvent.setup();
    const { handlers } = renderToolbar();
    const trigger = screen.getByRole("button", { name: "导出" });

    expect(screen.getByText("BlockNote Canvas v15")).toBeVisible();
    expect(screen.getByRole("button", { name: "恢复 100% 缩放" }))
      .toHaveTextContent("85%");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("title", "导出");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "缩小画布" }));
    await user.click(screen.getByRole("button", { name: "放大画布" }));
    await user.click(screen.getByRole("button", { name: "恢复 100% 缩放" }));
    await user.click(screen.getByRole("button", { name: "适合宽度" }));

    expect(handlers.onZoomOut).toHaveBeenCalledOnce();
    expect(handlers.onZoomIn).toHaveBeenCalledOnce();
    expect(handlers.onResetZoom).toHaveBeenCalledOnce();
    expect(handlers.onFitWidth).toHaveBeenCalledOnce();
  });

  it("toggles an ordered export menu and delegates each format", async () => {
    const user = userEvent.setup();
    const { handlers } = renderToolbar();
    const trigger = screen.getByRole("button", { name: "导出" });

    await user.click(trigger);

    const menu = screen.getByRole("menu", { name: "导出格式" });
    expect(screen.getAllByRole("button", { name: "导出" })).toHaveLength(1);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(within(menu).getAllByRole("menuitem").map(
      (item) => item.textContent,
    )).toEqual(["导出 PDF", "导出 DOCX", "导出长图"]);

    await user.click(trigger);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "导出 PDF" }));
    expect(handlers.onExportPdf).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "导出 DOCX" }));
    expect(handlers.onExportDocx).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "导出长图" }));
    expect(screen.getByRole("dialog", { name: "导出长图" })).toBeVisible();
    expect(handlers.onExportLongImage).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "开始导出" }));
    expect(handlers.onExportLongImage).toHaveBeenCalledWith({
      allowSplit: false,
      preset: "wechat",
      width: 900,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it.each([
    ["PDF", "{ArrowDown}{Enter}", "onExportPdf"],
    ["DOCX", "{ArrowDown}{ArrowDown}{Enter}", "onExportDocx"],
  ] as const)(
    "selects %s once from the keyboard after closing the menu",
    async (_format, keys, handlerName) => {
      const user = userEvent.setup();
      const handlers = createHandlers();
      handlers[handlerName].mockImplementation(() => {
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      });
      renderToolbar(handlers);
      screen.getByRole("button", { name: "导出" }).focus();

      await user.keyboard(keys);

      expect(handlers[handlerName]).toHaveBeenCalledOnce();
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    },
  );

  it("supports Enter and Space toggling from the trigger", async () => {
    const user = userEvent.setup();
    renderToolbar();
    const trigger = screen.getByRole("button", { name: "导出" });
    trigger.focus();

    await user.keyboard("{Enter}");
    expect(screen.getByRole("menu")).toBeVisible();

    await user.keyboard(" ");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens with ArrowDown and navigates menu options with arrow keys", async () => {
    const user = userEvent.setup();
    renderToolbar();
    const trigger = screen.getByRole("button", { name: "导出" });
    trigger.focus();

    await user.keyboard("{ArrowDown}");
    const pdfOption = screen.getByRole("menuitem", { name: "导出 PDF" });
    const docxOption = screen.getByRole("menuitem", { name: "导出 DOCX" });
    const longImageOption = screen.getByRole("menuitem", {
      name: "导出长图",
    });
    expect(pdfOption).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(docxOption).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(longImageOption).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(docxOption).toHaveFocus();
  });

  it("closes on Escape or an outside pointer and restores focus on Escape", async () => {
    const user = userEvent.setup();
    renderToolbar();
    const trigger = screen.getByRole("button", { name: "导出" });

    await user.click(trigger);
    await user.click(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "导出 PDF" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("uses capture-phase outside pointer handling", async () => {
    const user = userEvent.setup();
    render(
      <>
        <BlockNoteCanvasToolbar
          exportingDocx={false}
          exportingLongImage={false}
          exportingPdf={false}
          saveState="saved"
          zoom={0.85}
          {...createHandlers()}
        />
        <button
          onPointerDown={(event) => event.stopPropagation()}
          type="button"
        >
          阻止冒泡的外部控件
        </button>
      </>,
    );

    await user.click(screen.getByRole("button", { name: "导出" }));
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "阻止冒泡的外部控件" }),
    );

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("lets native Tab focus the next control before closing the menu", async () => {
    const user = userEvent.setup();
    const handlers = createHandlers();
    const menuPresenceOnFocus = vi.fn(() =>
      Boolean(screen.queryByRole("menu"))
    );
    render(
      <>
        <BlockNoteCanvasToolbar
          exportingDocx={false}
          exportingLongImage={false}
          exportingPdf={false}
          saveState="saved"
          zoom={0.85}
          {...handlers}
        />
        <button onFocus={menuPresenceOnFocus} type="button">
          下一个控件
        </button>
      </>,
    );
    const trigger = screen.getByRole("button", { name: "导出" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");

    await user.tab();

    expect(screen.getByRole("button", { name: "下一个控件" })).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
    expect(menuPresenceOnFocus).toHaveReturnedWith(true);
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    );
  });

  it("lets native Shift+Tab return to the trigger before closing the menu", async () => {
    const user = userEvent.setup();
    renderToolbar();
    const trigger = screen.getByRole("button", { name: "导出" });
    const menuPresenceOnFocus = vi.fn(() =>
      Boolean(screen.queryByRole("menu"))
    );
    trigger.addEventListener("focus", menuPresenceOnFocus);
    trigger.focus();
    await user.keyboard("{ArrowUp}");
    menuPresenceOnFocus.mockClear();

    await user.tab({ shift: true });

    expect(trigger).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
    expect(menuPresenceOnFocus).toHaveReturnedWith(true);
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    );
  });

  it("keeps trigger focus through keyboard export and busy completion", async () => {
    const user = userEvent.setup();
    const handlers = createHandlers();
    let finishExport!: () => void;
    const completion = new Promise<void>((resolve) => {
      finishExport = resolve;
    });
    render(<BusyExportHarness completion={completion} handlers={handlers} />);
    screen.getByRole("button", { name: "导出" }).focus();

    await user.keyboard("{ArrowDown}{Enter}");

    const busyTrigger = screen.getByRole("button", {
      name: "正在导出 PDF…",
    });
    expect(handlers.onExportPdf).toHaveBeenCalledOnce();
    expect(busyTrigger).toHaveFocus();
    expect(busyTrigger).toHaveAttribute("aria-disabled", "true");

    await act(async () => finishExport());

    expect(screen.getByRole("button", { name: "导出" })).toHaveFocus();
  });

  it("does not steal focus when export completion follows deliberate movement", async () => {
    const user = userEvent.setup();
    const handlers = createHandlers();
    let finishExport!: () => void;
    const completion = new Promise<void>((resolve) => {
      finishExport = resolve;
    });
    render(<BusyExportHarness completion={completion} handlers={handlers} />);
    screen.getByRole("button", { name: "导出" }).focus();
    await user.keyboard("{ArrowDown}{Enter}");

    await user.tab();
    const nextControl = screen.getByRole("button", { name: "导出后的控件" });
    expect(nextControl).toHaveFocus();

    await act(async () => finishExport());

    expect(nextControl).toHaveFocus();
  });

  it("keeps the busy trigger focusable and guards every activation path", async () => {
    const user = userEvent.setup();
    const { handlers } = renderToolbar(createHandlers(), true);
    const trigger = screen.getByRole("button", { name: "正在导出 PDF…" });

    expect(trigger).toHaveAttribute("aria-disabled", "true");
    expect(trigger).not.toBeDisabled();
    trigger.focus();
    await user.keyboard("{Enter} {ArrowDown}{ArrowUp}");
    await user.click(trigger);

    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(handlers.onExportPdf).not.toHaveBeenCalled();
    expect(handlers.onExportDocx).not.toHaveBeenCalled();
    expect(handlers.onExportLongImage).not.toHaveBeenCalled();
  });

  it.each([
    ["PDF", true, false, false, "正在导出 PDF…"],
    ["DOCX", false, true, false, "正在导出 DOCX…"],
    ["长图", false, false, true, "正在导出长图…"],
  ])(
    "closes the menu and presents format-specific %s progress",
    async (
      _format,
      exportingPdf,
      exportingDocx,
      exportingLongImage,
      progressLabel,
    ) => {
      const user = userEvent.setup();
      const handlers = createHandlers();
      const view = renderToolbar(handlers);
      await user.click(screen.getByRole("button", { name: "导出" }));
      expect(screen.getByRole("menu")).toBeVisible();

      view.rerender(
        <BlockNoteCanvasToolbar
          exportingDocx={exportingDocx}
          exportingLongImage={exportingLongImage}
          exportingPdf={exportingPdf}
          saveState="saving"
          zoom={1}
          {...handlers}
        />,
      );

      const trigger = await screen.findByRole("button", {
        name: progressLabel,
      });
      expect(trigger).toHaveAttribute("aria-disabled", "true");
      expect(trigger).not.toBeDisabled();
      expect(trigger).toHaveAttribute("title", progressLabel);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(screen.getByTestId("save-status")).toBeVisible();
    },
  );
});
