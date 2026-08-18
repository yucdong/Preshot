// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../../app/theme/ThemeProvider";
import { createEmptyProjectPlanV14 } from "../../../domain/plan/canvas/blockDocument";
import type { SettingsRepository } from "../../../domain/settings/ports";
import type { BlockNotePlanService } from "../../../domain/plan/blocknote/service";
import type { PdfSaveTarget } from "../../../domain/plan/canvas/ports";
import type {
  ProjectDirectoryRevealer,
  WorkspaceLogger,
} from "../../../domain/workspace/ports";
import type { BlockNotePdfExporter } from "../../../infrastructure/pdf/blockNotePdfExporter";
import type { BlockNoteDocxExporter } from "../../../infrastructure/docx/blockNoteDocxExporter";
import { BlockNoteProjectCanvasProvider } from "./BlockNoteProjectCanvasProvider";

const settings: SettingsRepository = {
  read: vi.fn().mockResolvedValue({ theme: "light" }),
  write: vi.fn().mockResolvedValue(undefined),
};

function renderProvider(
  service: BlockNotePlanService,
  dependencies: {
    docxExporter?: BlockNoteDocxExporter;
    docxSaver?: PdfSaveTarget;
    exporter?: BlockNotePdfExporter;
    logger?: WorkspaceLogger;
    projectDirectoryRevealer?: ProjectDirectoryRevealer;
    saver?: PdfSaveTarget;
  } = {},
) {
  return render(
    <ThemeProvider repository={settings}>
      <BlockNoteProjectCanvasProvider
        docxExporter={dependencies.docxExporter ?? {
          implementation: "blocknote-docx",
          export: vi.fn(),
        }}
        docxSaver={dependencies.docxSaver ?? { save: vi.fn() }}
        exporter={dependencies.exporter ?? {
          implementation: "react-pdf",
          export: vi.fn(),
        }}
        picker={{
          pickImageFile: vi.fn().mockResolvedValue(null),
          pickImageFiles: vi.fn().mockResolvedValue(null),
        }}
        projectName="Editorial"
        projectPath={"C:\\Editorial"}
        logger={dependencies.logger ?? {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        }}
        projectDirectoryRevealer={dependencies.projectDirectoryRevealer ?? {
          revealProjectDirectory: vi.fn().mockResolvedValue(undefined),
        }}
        saver={dependencies.saver ?? { save: vi.fn() }}
        service={service}
      />
    </ThemeProvider>,
  );
}

function serviceWith(
  overrides: Partial<BlockNotePlanService>,
): BlockNotePlanService {
  return {
    loadPlan: vi.fn(),
    savePlan: vi.fn(),
    loadImage: vi.fn(),
    importMedia: vi.fn(),
    loadMedia: vi.fn(),
    importImages: vi.fn(),
    commitImageCrop: vi.fn(),
    removeImage: vi.fn(),
    removeGroup: vi.fn(),
    purgeDetachedGroups: vi.fn(),
    purgeDetachedMedia: vi.fn(),
    ...overrides,
  };
}

function selectExport(format: "PDF" | "DOCX") {
  fireEvent.click(screen.getByRole("button", { name: "导出" }));
  fireEvent.click(screen.getByRole("menuitem", {
    name: `导出 ${format}`,
  }));
}

describe("BlockNoteProjectCanvasProvider", () => {
  it("renders a new schema-v14 BlockNote canvas", async () => {
    const plan = createEmptyProjectPlanV14("Editorial", {
      makeId: () => "block-1",
    });
    renderProvider(serviceWith({
      loadPlan: vi.fn().mockResolvedValue({ status: "missing", plan }),
    }));

    expect(await screen.findByText("BlockNote Canvas v14")).toBeVisible();
    expect(screen.getByRole("group", { name: "方案正文" })).toHaveAttribute(
      "data-editor-engine",
      "blocknote",
    );
    expect(screen.getByTestId("plan-document-canvas")).toHaveStyle({
      width: "1080px",
    });
    expect(screen.getByRole("button", { name: "适合宽度" })).toBeVisible();
    expect(screen.getByTestId("save-status")).toHaveTextContent("未保存");
  });

  it("blocks legacy schemas without opening the editor", async () => {
    renderProvider(serviceWith({
      loadPlan: vi.fn().mockResolvedValue({
        status: "incompatible",
        foundSchemaVersion: 12,
        requiredSchemaVersion: 13,
      }),
    }));

    expect(await screen.findByRole("alert")).toHaveTextContent("方案版本不兼容");
    expect(screen.getByRole("alert")).toHaveTextContent("schema 12");
    expect(screen.queryByRole("group", { name: "方案正文" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导出" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("flushes an unsaved plan when the project canvas unmounts", async () => {
    const plan = createEmptyProjectPlanV14("Editorial", {
      makeId: () => "block-1",
    });
    const savePlan = vi.fn().mockResolvedValue(undefined);
    const view = renderProvider(serviceWith({
      loadPlan: vi.fn().mockResolvedValue({ status: "missing", plan }),
      savePlan,
    }));
    await screen.findByText("BlockNote Canvas v14");

    view.unmount();

    await waitFor(() => {
      expect(savePlan).toHaveBeenCalledWith("C:\\Editorial", plan);
    });
  });

  it("surfaces save failures and leaves the plan unsaved", async () => {
    const plan = createEmptyProjectPlanV14("Editorial", {
      makeId: () => "block-1",
    });
    const savePlan = vi.fn()
      .mockRejectedValueOnce(new Error("Disk is full"))
      .mockResolvedValue(undefined);
    renderProvider(serviceWith({
      loadPlan: vi.fn().mockResolvedValue({ status: "missing", plan }),
      savePlan,
    }));
    await screen.findByText("BlockNote Canvas v14");

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "无法保存方案：Disk is full",
    );
    expect(screen.getByTestId("save-status")).toHaveTextContent("未保存");
  });

  it("serializes overlapping save requests", async () => {
    const plan = createEmptyProjectPlanV14("Editorial", {
      makeId: () => "block-1",
    });
    let resolveFirst: (() => void) | undefined;
    const firstSave = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const savePlan = vi.fn()
      .mockReturnValueOnce(firstSave)
      .mockResolvedValue(undefined);
    renderProvider(serviceWith({
      loadPlan: vi.fn().mockResolvedValue({ status: "missing", plan }),
      savePlan,
    }));
    await screen.findByText("BlockNote Canvas v14");

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(savePlan).toHaveBeenCalledTimes(1));

    resolveFirst?.();

    await waitFor(() => expect(savePlan).toHaveBeenCalledTimes(2));
  });

  it("surfaces export progress and rejection without saving or mutating the plan", async () => {
    const plan = createEmptyProjectPlanV14("Editorial", {
      makeId: () => "block-1",
    });
    const snapshot = structuredClone(plan);
    let rejectExport: ((error: Error) => void) | undefined;
    const exportPromise = new Promise<Uint8Array>((_resolve, reject) => {
      rejectExport = reject;
    });
    const exportPdf = vi.fn().mockReturnValue(exportPromise);
    const savePdf = vi.fn();
    const revealProjectDirectory = vi.fn();
    renderProvider(serviceWith({
      loadPlan: vi.fn().mockResolvedValue({ status: "missing", plan }),
    }), {
      exporter: {
        implementation: "react-pdf",
        export: exportPdf,
      },
      projectDirectoryRevealer: { revealProjectDirectory },
      saver: { save: savePdf },
    });
    await screen.findByText("BlockNote Canvas v14");

    selectExport("PDF");

    expect(screen.getByRole("button", {
      name: "正在导出 PDF…",
    })).toHaveAttribute("aria-disabled", "true");
    expect(exportPdf).toHaveBeenCalledTimes(1);
    expect(exportPdf.mock.calls[0]?.[0]).toEqual(snapshot);
    rejectExport?.(new Error("group group-1 asset missing"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "无法导出 PDF：group group-1 asset missing",
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "导出" })).toBeEnabled()
    );
    expect(savePdf).not.toHaveBeenCalled();
    expect(revealProjectDirectory).not.toHaveBeenCalled();
    expect(exportPdf.mock.calls[0]?.[0]).toEqual(snapshot);
  });

  it("passes unchanged bytes and typed save options, then reveals the project directory", async () => {
    const plan = createEmptyProjectPlanV14("Editorial", {
      makeId: () => "block-1",
    });
    const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 1]);
    const order: string[] = [];
    const savePdf = vi.fn().mockResolvedValue("C:\\Editorial\\output.pdf");
    savePdf.mockImplementation(async () => {
      order.push("save");
      return "C:\\Editorial\\output.pdf";
    });
    const revealProjectDirectory = vi.fn().mockImplementation(async () => {
      order.push("reveal");
    });
    renderProvider(serviceWith({
      loadPlan: vi.fn().mockResolvedValue({ status: "missing", plan }),
    }), {
      exporter: {
        implementation: "react-pdf",
        export: vi.fn().mockImplementation(async () => {
          order.push("export");
          return bytes;
        }),
      },
      projectDirectoryRevealer: { revealProjectDirectory },
      saver: { save: savePdf },
    });
    await screen.findByText("BlockNote Canvas v14");

    selectExport("PDF");

    await waitFor(() => {
      expect(revealProjectDirectory).toHaveBeenCalledWith("C:\\Editorial");
    });
    expect(savePdf).toHaveBeenCalledWith(bytes, {
      suggestedName: "output.pdf",
      defaultDirectory: "C:\\Editorial",
    });
    expect(savePdf.mock.calls[0]?.[0]).toBe(bytes);
    expect(order).toEqual(["export", "save", "reveal"]);
  });

  it("does not write or reveal when the save dialog is cancelled", async () => {
    const plan = createEmptyProjectPlanV14("Editorial", {
      makeId: () => "block-1",
    });
    const savePdf = vi.fn().mockResolvedValue(null);
    const revealProjectDirectory = vi.fn();
    renderProvider(serviceWith({
      loadPlan: vi.fn().mockResolvedValue({ status: "missing", plan }),
    }), {
      exporter: {
        implementation: "react-pdf",
        export: vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3])),
      },
      projectDirectoryRevealer: { revealProjectDirectory },
      saver: { save: savePdf },
    });
    await screen.findByText("BlockNote Canvas v14");

    selectExport("PDF");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "导出" })).toBeEnabled()
    );
    expect(savePdf).toHaveBeenCalledTimes(1);
    expect(revealProjectDirectory).not.toHaveBeenCalled();
    expect(screen.queryByText(/无法导出 PDF/)).not.toBeInTheDocument();
  });

  it("downloads through browser-style save targets without revealing a directory", async () => {
    const plan = createEmptyProjectPlanV14("Editorial", {
      makeId: () => "block-1",
    });
    const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46]);
    const savePdf = vi.fn().mockResolvedValue("output.pdf");
    const revealProjectDirectory = vi.fn();
    renderProvider(serviceWith({
      loadPlan: vi.fn().mockResolvedValue({ status: "missing", plan }),
    }), {
      exporter: {
        implementation: "react-pdf",
        export: vi.fn().mockResolvedValue(bytes),
      },
      projectDirectoryRevealer: { revealProjectDirectory },
      saver: {
        revealProjectDirectoryAfterSave: false,
        save: savePdf,
      },
    });
    await screen.findByText("BlockNote Canvas v14");

    selectExport("PDF");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "导出" })).toBeEnabled()
    );
    expect(savePdf).toHaveBeenCalledWith(bytes, {
      suggestedName: "output.pdf",
      defaultDirectory: "C:\\Editorial",
    });
    expect(revealProjectDirectory).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not reveal when the PDF write fails", async () => {
    const plan = createEmptyProjectPlanV14("Editorial", {
      makeId: () => "block-1",
    });
    const revealProjectDirectory = vi.fn();
    renderProvider(serviceWith({
      loadPlan: vi.fn().mockResolvedValue({ status: "missing", plan }),
    }), {
      exporter: {
        implementation: "react-pdf",
        export: vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3])),
      },
      projectDirectoryRevealer: { revealProjectDirectory },
      saver: {
        save: vi.fn().mockRejectedValue(new Error("Disk is full")),
      },
    });
    await screen.findByText("BlockNote Canvas v14");

    selectExport("PDF");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "无法导出 PDF：Disk is full",
    );
    expect(revealProjectDirectory).not.toHaveBeenCalled();
  });

  it("reports directory reveal failure as non-fatal after one successful write", async () => {
    const plan = createEmptyProjectPlanV14("Editorial", {
      makeId: () => "block-1",
    });
    const savePdf = vi.fn().mockResolvedValue("C:\\Editorial\\output.pdf");
    const revealError = new Error("Explorer is unavailable");
    const revealProjectDirectory = vi.fn().mockRejectedValue(revealError);
    const logger: WorkspaceLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    renderProvider(serviceWith({
      loadPlan: vi.fn().mockResolvedValue({ status: "missing", plan }),
    }), {
      exporter: {
        implementation: "react-pdf",
        export: vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3])),
      },
      logger,
      projectDirectoryRevealer: { revealProjectDirectory },
      saver: { save: savePdf },
    });
    await screen.findByText("BlockNote Canvas v14");

    selectExport("PDF");

    const notice = await screen.findByText(
      /PDF 已保存，但无法打开项目文件夹/,
    );
    expect(notice).toHaveTextContent(
      "PDF 已保存，但无法打开项目文件夹：Explorer is unavailable",
    );
    expect(notice).toHaveTextContent(
      "请从文件资源管理器手动打开项目文件夹。",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(savePdf).toHaveBeenCalledTimes(1);
    expect(revealProjectDirectory).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "PDF saved but unable to open project directory",
      {
        error: revealError,
        projectPath: "C:\\Editorial",
      },
    );
  });

  it("exports unchanged DOCX bytes to output.docx and reveals after the write", async () => {
    const plan = createEmptyProjectPlanV14("Editorial", {
      makeId: () => "block-1",
    });
    const snapshot = structuredClone(plan);
    const bytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1]);
    const order: string[] = [];
    const exportDocx = vi.fn().mockImplementation(async () => {
      order.push("export");
      return bytes;
    });
    const saveDocx = vi.fn().mockImplementation(async () => {
      order.push("save");
      return "C:\\Editorial\\output.docx";
    });
    const revealProjectDirectory = vi.fn().mockImplementation(async () => {
      order.push("reveal");
    });
    renderProvider(serviceWith({
      loadPlan: vi.fn().mockResolvedValue({ status: "missing", plan }),
    }), {
      docxExporter: {
        implementation: "blocknote-docx",
        export: exportDocx,
      },
      docxSaver: { save: saveDocx },
      projectDirectoryRevealer: { revealProjectDirectory },
    });
    await screen.findByText("BlockNote Canvas v14");

    selectExport("DOCX");

    expect(screen.getByRole("button", {
      name: "正在导出 DOCX…",
    })).toHaveAttribute("aria-disabled", "true");
    await waitFor(() =>
      expect(revealProjectDirectory).toHaveBeenCalledWith("C:\\Editorial")
    );
    expect(exportDocx).toHaveBeenCalledWith(
      snapshot,
      expect.any(Object),
    );
    expect(saveDocx).toHaveBeenCalledWith(bytes, {
      suggestedName: "output.docx",
      defaultDirectory: "C:\\Editorial",
    });
    expect(saveDocx.mock.calls[0]?.[0]).toBe(bytes);
    expect(exportDocx.mock.calls[0]?.[0]).toEqual(snapshot);
    expect(order).toEqual(["export", "save", "reveal"]);
  });

  it("treats DOCX save cancellation as a quiet no-reveal result", async () => {
    const plan = createEmptyProjectPlanV14("Editorial", {
      makeId: () => "block-1",
    });
    const revealProjectDirectory = vi.fn();
    const saveDocx = vi.fn().mockResolvedValue(null);
    renderProvider(serviceWith({
      loadPlan: vi.fn().mockResolvedValue({ status: "missing", plan }),
    }), {
      docxExporter: {
        implementation: "blocknote-docx",
        export: vi.fn().mockResolvedValue(Uint8Array.from([0x50, 0x4b])),
      },
      docxSaver: { save: saveDocx },
      projectDirectoryRevealer: { revealProjectDirectory },
    });
    await screen.findByText("BlockNote Canvas v14");

    selectExport("DOCX");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "导出" })).toBeEnabled()
    );
    expect(saveDocx).toHaveBeenCalledTimes(1);
    expect(revealProjectDirectory).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    [
      "generation",
      vi.fn().mockRejectedValue(new Error("mapping failed")),
      vi.fn(),
      "无法导出 DOCX：mapping failed",
    ],
    [
      "write",
      vi.fn().mockResolvedValue(Uint8Array.from([0x50, 0x4b])),
      vi.fn().mockRejectedValue(new Error("Disk is full")),
      "无法导出 DOCX：Disk is full",
    ],
  ])(
    "surfaces actionable DOCX %s failures without revealing",
    async (_stage, exportDocx, saveDocx, expected) => {
      const plan = createEmptyProjectPlanV14("Editorial", {
        makeId: () => "block-1",
      });
      const revealProjectDirectory = vi.fn();
      renderProvider(serviceWith({
        loadPlan: vi.fn().mockResolvedValue({ status: "missing", plan }),
      }), {
        docxExporter: {
          implementation: "blocknote-docx",
          export: exportDocx,
        },
        docxSaver: { save: saveDocx },
        projectDirectoryRevealer: { revealProjectDirectory },
      });
      await screen.findByText("BlockNote Canvas v14");

      selectExport("DOCX");

      expect(await screen.findByRole("alert")).toHaveTextContent(expected);
      expect(revealProjectDirectory).not.toHaveBeenCalled();
    },
  );

  it("reports DOCX reveal failure separately after a successful write", async () => {
    const plan = createEmptyProjectPlanV14("Editorial", {
      makeId: () => "block-1",
    });
    const revealError = new Error("Explorer is unavailable");
    const revealProjectDirectory = vi.fn().mockRejectedValue(revealError);
    const logger: WorkspaceLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    renderProvider(serviceWith({
      loadPlan: vi.fn().mockResolvedValue({ status: "missing", plan }),
    }), {
      docxExporter: {
        implementation: "blocknote-docx",
        export: vi.fn().mockResolvedValue(Uint8Array.from([0x50, 0x4b])),
      },
      docxSaver: {
        save: vi.fn().mockResolvedValue("C:\\Editorial\\output.docx"),
      },
      logger,
      projectDirectoryRevealer: { revealProjectDirectory },
    });
    await screen.findByText("BlockNote Canvas v14");

    selectExport("DOCX");

    expect(await screen.findByText(
      /DOCX 已保存，但无法打开项目文件夹/,
    )).toHaveTextContent(
      "DOCX 已保存，但无法打开项目文件夹：Explorer is unavailable",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(logger.warn).toHaveBeenCalledWith(
      "DOCX saved but unable to open project directory",
      { error: revealError, projectPath: "C:\\Editorial" },
    );
  });

  it("downloads DOCX through browser targets without reveal", async () => {
    const plan = createEmptyProjectPlanV14("Editorial", {
      makeId: () => "block-1",
    });
    const bytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
    const saveDocx = vi.fn().mockResolvedValue("output.docx");
    const revealProjectDirectory = vi.fn();
    renderProvider(serviceWith({
      loadPlan: vi.fn().mockResolvedValue({ status: "missing", plan }),
    }), {
      docxExporter: {
        implementation: "blocknote-docx",
        export: vi.fn().mockResolvedValue(bytes),
      },
      docxSaver: {
        revealProjectDirectoryAfterSave: false,
        save: saveDocx,
      },
      projectDirectoryRevealer: { revealProjectDirectory },
    });
    await screen.findByText("BlockNote Canvas v14");

    selectExport("DOCX");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "导出" })).toBeEnabled()
    );
    expect(saveDocx).toHaveBeenCalledWith(bytes, {
      suggestedName: "output.docx",
      defaultDirectory: "C:\\Editorial",
    });
    expect(revealProjectDirectory).not.toHaveBeenCalled();
  });

  it("prevents PDF and DOCX exports from running concurrently", async () => {
    const plan = createEmptyProjectPlanV14("Editorial", {
      makeId: () => "block-1",
    });
    let resolvePdf: ((bytes: Uint8Array) => void) | undefined;
    const pdfPromise = new Promise<Uint8Array>((resolve) => {
      resolvePdf = resolve;
    });
    const exportPdf = vi.fn().mockReturnValue(pdfPromise);
    const exportDocx = vi.fn();
    renderProvider(serviceWith({
      loadPlan: vi.fn().mockResolvedValue({ status: "missing", plan }),
    }), {
      exporter: { implementation: "react-pdf", export: exportPdf },
      saver: { save: vi.fn().mockResolvedValue(null) },
      docxExporter: {
        implementation: "blocknote-docx",
        export: exportDocx,
      },
    });
    await screen.findByText("BlockNote Canvas v14");

    fireEvent.click(screen.getByRole("button", { name: "导出" }));
    const pdfOption = screen.getByRole("menuitem", { name: "导出 PDF" });
    const docxOption = screen.getByRole("menuitem", { name: "导出 DOCX" });
    fireEvent.click(pdfOption);
    fireEvent.click(docxOption);

    expect(exportPdf).toHaveBeenCalledTimes(1);
    expect(exportDocx).not.toHaveBeenCalled();
    expect(screen.getByRole("button", {
      name: "正在导出 PDF…",
    })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    resolvePdf?.(Uint8Array.from([0x25, 0x50, 0x44, 0x46]));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "导出" })).toBeEnabled()
    );
  });
});
