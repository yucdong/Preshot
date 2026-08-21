// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
import type { LongImageSaveTarget } from "../../../domain/plan/longImageSave";
import type { LongImageExporter } from "./dependencies";
import {
  LONG_IMAGE_PRESETS,
  LongImageContractError,
  createLongImageGeometry,
  type LongImageExportResult,
} from "../../../domain/plan/blocknote/longImageExportContract";
import type {
  BlockNoteLongImageExportRequest,
} from "../../../infrastructure/longImage/BlockNoteLongImageExporter";
import { BlockNoteProjectCanvasProvider } from "./BlockNoteProjectCanvasProvider";

const settings: SettingsRepository = {
  read: vi.fn().mockResolvedValue({ theme: "light" }),
  write: vi.fn().mockResolvedValue(undefined),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderProvider(
  service: BlockNotePlanService,
  dependencies: {
    docxExporter?: BlockNoteDocxExporter;
    docxSaver?: PdfSaveTarget;
    exporter?: BlockNotePdfExporter;
    logger?: WorkspaceLogger;
    longImageExporter?: LongImageExporter;
    longImageSaver?: LongImageSaveTarget;
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
        longImageExporter={dependencies.longImageExporter ?? {
          export: vi.fn(),
        }}
        longImageSaver={dependencies.longImageSaver ?? { save: vi.fn() }}
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

function openLongImageDialog() {
  fireEvent.click(screen.getByRole("button", { name: "导出" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "导出长图" }));
}

function longImageResult(partCount = 1): LongImageExportResult {
  const baseName = "Editorial";
  const parts = Array.from({ length: partCount }, (_, index) => ({
    index,
    top: index * 100,
    bottom: (index + 1) * 100,
    height: 100,
    endKind: index === partCount - 1
      ? "document-end" as const
      : "block" as const,
    ...(index === partCount - 1 ? {} : { endBlockId: `block-${index}` }),
  }));
  const fileNames = parts.map((_, index) =>
    partCount === 1
      ? `${baseName}.jpg`
      : `${baseName}-${String(index + 1).padStart(2, "0")}.jpg`
  );
  const encodedParts = parts.map((part, index) => ({
    part,
    fileName: fileNames[index]!,
    mime: "image/jpeg" as const,
    width: 900 as const,
    height: part.height,
    encodedBytes: 4,
    bytes: Uint8Array.from([0xff, 0xd8, index, 0xd9]),
    quality: 0.84,
  }));
  return {
    manifest: {
      version: 1,
      projectTitle: "Editorial",
      baseName,
      preset: "wechat",
      format: "jpeg",
      geometry: createLongImageGeometry(900),
      limits: LONG_IMAGE_PRESETS.wechat.limits,
      cumulativeBudget: LONG_IMAGE_PRESETS.wechat.cumulativeBudget,
      documentHeight: partCount * 100,
      allowSplit: true,
      blocks: [],
      parts,
      fileNames,
      warnings: [],
    },
    parts: encodedParts,
    totalBytes: encodedParts.reduce(
      (total, part) => total + part.encodedBytes,
      0,
    ),
    warnings: [],
  };
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

  it("marks a loaded compatibility migration unsaved, saves it, and reloads stably", async () => {
    class MeasuredImage {
      naturalWidth = 900;
      naturalHeight = 600;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }

      decode() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal("Image", MeasuredImage);

    let persisted = {
      schemaVersion: 14 as const,
      title: "Editorial",
      document: {
        format: "preshot-blocks" as const,
        version: 2 as const,
        blocks: [{
          id: "group-block",
          type: "imageGroup" as const,
          props: { groupId: "group" },
          content: undefined,
          children: [],
        }],
      },
      imageGroups: [{
        id: "group",
        name: "References",
        type: "reference" as const,
        x: 17,
        width: 500,
        height: 300,
        description: "",
        images: [{
          id: "legacy",
          file: "references/legacy.png",
          aspectRatio: 1.5,
          sourceWidth: 900,
          sourceHeight: 600,
          frameWidth: 202.5,
          frameHeight: 135,
        }],
      }],
    };
    const savePlan = vi.fn().mockImplementation(async (
      _projectPath: string,
      plan: typeof persisted,
    ) => {
      persisted = structuredClone(plan);
    });
    const service = serviceWith({
      loadPlan: vi.fn().mockImplementation(async () => ({
        status: "loaded",
        plan: structuredClone(persisted),
      })),
      loadImage: vi.fn().mockResolvedValue("data:image/png;base64,AA"),
      savePlan,
    });

    const first = renderProvider(service);

    expect(await screen.findByText("BlockNote Canvas v14")).toBeVisible();
    expect(screen.getByTestId("save-status")).toHaveTextContent("未保存");
    expect(screen.getByText(
      /已升级 1 张旧版默认尺寸图片/,
      { suggest: false },
    )).toHaveTextContent("已升级 1 张旧版默认尺寸图片");

    first.unmount();
    await waitFor(() => {
      expect(savePlan).toHaveBeenCalledTimes(1);
    });
    expect(persisted.imageGroups[0]).toMatchObject({
      x: 17,
      width: 500,
      height: 258,
      images: [{
        id: "legacy",
        file: "references/legacy.png",
        frameWidth: 360,
        frameHeight: 240,
      }],
    });

    renderProvider(service);

    expect(await screen.findByText("BlockNote Canvas v14")).toBeVisible();
    expect(screen.getByTestId("save-status")).toHaveTextContent("已保存");
    expect(screen.queryByText(/已升级 1 张旧版默认尺寸图片/))
      .not.toBeInTheDocument();
    expect(savePlan).toHaveBeenCalledTimes(1);
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

  it("exports and saves multiple long-image parts with progress, shared inputs, and one export lock", async () => {
    const plan = createEmptyProjectPlanV14("Editorial", {
      makeId: () => "block-1",
    });
    let capturedRequest: BlockNoteLongImageExportRequest | undefined;
    let resolveExport: ((result: LongImageExportResult) => void) | undefined;
    const exportPromise = new Promise<LongImageExportResult>((resolve) => {
      resolveExport = resolve;
    });
    const exportLongImage = vi.fn().mockImplementation(
      (request: BlockNoteLongImageExportRequest) => {
        capturedRequest = request;
        return exportPromise;
      },
    );
    const saveLongImage = vi.fn().mockResolvedValue([
      "C:\\Editorial\\Editorial-01.jpg",
      "C:\\Editorial\\Editorial-02.jpg",
    ]);
    const revealProjectDirectory = vi.fn().mockResolvedValue(undefined);
    const exportPdf = vi.fn();
    renderProvider(serviceWith({
      loadPlan: vi.fn().mockResolvedValue({ status: "missing", plan }),
    }), {
      exporter: { implementation: "react-pdf", export: exportPdf },
      longImageExporter: { export: exportLongImage },
      longImageSaver: {
        revealProjectDirectoryAfterSave: true,
        save: saveLongImage,
      },
      projectDirectoryRevealer: { revealProjectDirectory },
    });
    await screen.findByText("BlockNote Canvas v14");

    openLongImageDialog();
    fireEvent.click(screen.getByRole("checkbox", { name: "自动分图" }));
    fireEvent.click(screen.getByRole("button", { name: "开始导出" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "正在导出长图…" }))
      .toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("status", { name: "长图导出进度" }))
      .toHaveTextContent("正在准备长图文档…");
    expect(capturedRequest?.plan).toEqual(plan);
    expect(capturedRequest?.resolvedAssets).toEqual({});
    expect(capturedRequest?.preset).toBe("wechat");
    expect(capturedRequest?.options).toEqual({
      allowSplit: true,
      theme: "light",
      width: 900,
    });

    fireEvent.click(screen.getByRole("button", { name: "正在导出长图…" }));
    expect(exportPdf).not.toHaveBeenCalled();
    await act(async () => {
      capturedRequest?.onProgress?.({
        phase: "render",
        partNumber: 1,
        partCount: 2,
      });
    });
    expect(screen.getByRole("status", { name: "长图导出进度" })).toHaveTextContent(
      "正在渲染第 1/2 张…",
    );

    const result = longImageResult(2);
    await act(async () => {
      resolveExport?.(result);
      await exportPromise;
    });
    await waitFor(() =>
      expect(revealProjectDirectory).toHaveBeenCalledWith("C:\\Editorial")
    );
    expect(saveLongImage).toHaveBeenCalledWith({
      format: "jpeg",
      baseName: "Editorial",
      defaultDirectory: "C:\\Editorial",
      parts: [
        {
          fileName: "Editorial-01.jpg",
          bytes: Uint8Array.from([0xff, 0xd8, 0, 0xd9]),
        },
        {
          fileName: "Editorial-02.jpg",
          bytes: Uint8Array.from([0xff, 0xd8, 1, 0xd9]),
        },
      ],
    });
    const savedParts = saveLongImage.mock.calls[0]?.[0].parts;
    expect(savedParts[0].bytes).toBe(result.parts[0]?.bytes);
    expect(savedParts[1].bytes).toBe(result.parts[1]?.bytes);
    expect(screen.getByRole("button", { name: "导出" })).toBeEnabled();
  });

  it("returns promptly from long-image cancellation without surfacing an error", async () => {
    const plan = createEmptyProjectPlanV14("Editorial", {
      makeId: () => "block-1",
    });
    let exportSignal: AbortSignal | undefined;
    const exportLongImage = vi.fn().mockImplementation(
      (request: BlockNoteLongImageExportRequest) =>
        new Promise<LongImageExportResult>((_resolve, reject) => {
          exportSignal = request.signal;
          request.signal?.addEventListener("abort", () => {
            reject(new DOMException("cancelled", "AbortError"));
          }, { once: true });
        }),
    );
    const saveLongImage = vi.fn();
    const logger: WorkspaceLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    renderProvider(serviceWith({
      loadPlan: vi.fn().mockResolvedValue({ status: "missing", plan }),
    }), {
      logger,
      longImageExporter: { export: exportLongImage },
      longImageSaver: { save: saveLongImage },
    });
    await screen.findByText("BlockNote Canvas v14");

    openLongImageDialog();
    fireEvent.click(screen.getByRole("button", { name: "开始导出" }));
    fireEvent.click(screen.getByRole("button", { name: "取消长图导出" }));

    expect(exportSignal?.aborted).toBe(true);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "导出" })).toBeEnabled()
    );
    expect(saveLongImage).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(screen.queryByText(/无法导出长图/)).not.toBeInTheDocument();
  });

  it("treats a cancelled long-image save as a quiet no-reveal result", async () => {
    const plan = createEmptyProjectPlanV14("Editorial", {
      makeId: () => "block-1",
    });
    const revealProjectDirectory = vi.fn();
    const exportLongImage = vi.fn().mockResolvedValue(longImageResult());
    renderProvider(serviceWith({
      loadPlan: vi.fn().mockResolvedValue({ status: "missing", plan }),
    }), {
      longImageExporter: {
        export: exportLongImage,
      },
      longImageSaver: { save: vi.fn().mockResolvedValue(null) },
      projectDirectoryRevealer: { revealProjectDirectory },
    });
    await screen.findByText("BlockNote Canvas v14");

    openLongImageDialog();
    fireEvent.click(screen.getByRole("button", { name: "开始导出" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "导出" })).toBeEnabled()
    );
    expect(exportLongImage).toHaveBeenCalledWith(expect.objectContaining({
      options: {
        allowSplit: false,
        theme: "light",
        width: 900,
      },
    }));
    expect(revealProjectDirectory).not.toHaveBeenCalled();
    expect(screen.queryByText(/无法导出长图/)).not.toBeInTheDocument();
  });

  it.each([
    [
      "generation",
      vi.fn().mockRejectedValue(new Error("capture failed")),
      vi.fn(),
      "无法导出长图：capture failed",
    ],
    [
      "save",
      vi.fn().mockResolvedValue(longImageResult()),
      vi.fn().mockRejectedValue(new Error("Disk is full")),
      "无法导出长图：Disk is full",
    ],
  ])(
    "surfaces contextual long-image %s failures without revealing",
    async (_stage, exportLongImage, saveLongImage, expected) => {
      const plan = createEmptyProjectPlanV14("Editorial", {
        makeId: () => "block-1",
      });
      const revealProjectDirectory = vi.fn();
      renderProvider(serviceWith({
        loadPlan: vi.fn().mockResolvedValue({ status: "missing", plan }),
      }), {
        longImageExporter: { export: exportLongImage },
        longImageSaver: { save: saveLongImage },
        projectDirectoryRevealer: { revealProjectDirectory },
      });
      await screen.findByText("BlockNote Canvas v14");

      openLongImageDialog();
      fireEvent.click(screen.getByRole("button", { name: "开始导出" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(expected);
      expect(revealProjectDirectory).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      name: "high-quality JPEG byte",
      code: "NO_EARLIER_BOUNDARY" as const,
      configure: (): void => {
        fireEvent.change(screen.getByLabelText("JPEG 体积目标"), {
          target: { value: "high-quality" },
        });
      },
      expected:
        "无法导出长图：自动分图无法继续：当前完整区块或图片组单行仍超过 JPEG 的高度或体积限制。请缩短或拆分这个区块/图片组，或将方案分段导出。也可改用体积更小的“微信兼容” JPEG 预设、降低图片细节，或改用 PDF/DOCX。",
    },
    {
      name: "lossless PNG byte",
      code: "NO_EARLIER_BOUNDARY" as const,
      configure: (): void => {
        fireEvent.change(screen.getByLabelText("图片格式"), {
          target: { value: "png" },
        });
      },
      expected:
        "无法导出长图：自动分图无法继续：当前完整区块或图片组单行仍超过 PNG 的高度或体积限制。请缩短或拆分这个区块/图片组，或将方案分段导出。如可接受 JPEG，也可选择体积更小的“微信兼容” JPEG 预设或降低图片细节；也可改用 PDF/DOCX。",
    },
    {
      name: "WeChat JPEG height",
      code: "UNSAFE_CANVAS" as const,
      configure: (): void => {},
      expected:
        "无法导出长图：自动分图无法继续：当前完整区块或图片组单行仍超过 JPEG 的高度或体积限制。请缩短或拆分这个区块/图片组，或将方案分段导出。也可降低图片细节，或改用 PDF/DOCX。",
    },
  ])(
    "gives actionable Chinese recovery for an unsplittable $name limit",
    async ({ code, configure, expected }) => {
      const plan = createEmptyProjectPlanV14("Editorial", {
        makeId: () => "block-1",
      });
      const internalMessage = code === "NO_EARLIER_BOUNDARY"
        ? "No earlier boundary is available."
        : "Unsafe canvas height.";
      renderProvider(serviceWith({
        loadPlan: vi.fn().mockResolvedValue({ status: "missing", plan }),
      }), {
        longImageExporter: {
          export: vi.fn().mockRejectedValue(
            new LongImageContractError(code, internalMessage, {
              partIndex: 0,
              blockId: "block-1",
            }),
          ),
        },
      });
      await screen.findByText("BlockNote Canvas v14");

      openLongImageDialog();
      configure();
      fireEvent.click(screen.getByRole("checkbox", { name: "自动分图" }));
      fireEvent.click(screen.getByRole("button", { name: "开始导出" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(expected);
      expect(screen.queryByText(internalMessage)).not.toBeInTheDocument();
    },
  );

  it("reports long-image reveal failure separately after successful native saves", async () => {
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
      logger,
      longImageExporter: {
        export: vi.fn().mockResolvedValue(longImageResult()),
      },
      longImageSaver: {
        revealProjectDirectoryAfterSave: true,
        save: vi.fn().mockResolvedValue(["C:\\Editorial\\Editorial.jpg"]),
      },
      projectDirectoryRevealer: { revealProjectDirectory },
    });
    await screen.findByText("BlockNote Canvas v14");

    openLongImageDialog();
    fireEvent.click(screen.getByRole("button", { name: "开始导出" }));

    expect(await screen.findByText(
      /长图已保存，但无法打开项目文件夹/,
    )).toHaveTextContent(
      "长图已保存，但无法打开项目文件夹：Explorer is unavailable",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(logger.warn).toHaveBeenCalledWith(
      "Long image saved but unable to open project directory",
      { error: revealError, projectPath: "C:\\Editorial" },
    );
  });
});
