// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../../app/theme/ThemeProvider";
import { createEmptyProjectPlanV14 } from "../../../domain/plan/canvas/blockDocument";
import type { SettingsRepository } from "../../../domain/settings/ports";
import type { BlockNotePlanService } from "../../../domain/plan/blocknote/service";
import type { PdfSaveTarget } from "../../../domain/plan/canvas/ports";
import type { BlockNotePdfExporter } from "../../../infrastructure/pdf/blockNotePdfExporter";
import { BlockNoteProjectCanvasProvider } from "./BlockNoteProjectCanvasProvider";

const settings: SettingsRepository = {
  read: vi.fn().mockResolvedValue({ theme: "light" }),
  write: vi.fn().mockResolvedValue(undefined),
};

function renderProvider(
  service: BlockNotePlanService,
  dependencies: {
    exporter?: BlockNotePdfExporter;
    saver?: PdfSaveTarget;
  } = {},
) {
  return render(
    <ThemeProvider repository={settings}>
      <BlockNoteProjectCanvasProvider
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
    renderProvider(serviceWith({
      loadPlan: vi.fn().mockResolvedValue({ status: "missing", plan }),
    }), {
      exporter: {
        implementation: "react-pdf",
        export: exportPdf,
      },
      saver: { save: savePdf },
    });
    await screen.findByText("BlockNote Canvas v14");

    fireEvent.click(screen.getByRole("button", { name: "导出 PDF" }));

    expect(screen.getByRole("button", { name: "导出中…" })).toBeDisabled();
    expect(exportPdf).toHaveBeenCalledTimes(1);
    expect(exportPdf.mock.calls[0]?.[0]).toEqual(snapshot);
    rejectExport?.(new Error("group group-1 asset missing"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "无法导出 PDF：group group-1 asset missing",
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "导出 PDF" })).toBeEnabled()
    );
    expect(savePdf).not.toHaveBeenCalled();
    expect(exportPdf.mock.calls[0]?.[0]).toEqual(snapshot);
  });

  it("passes exported bytes and the filename to the save target unchanged", async () => {
    const plan = createEmptyProjectPlanV14("Editorial", {
      makeId: () => "block-1",
    });
    const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 1]);
    const savePdf = vi.fn().mockResolvedValue("C:\\Editorial\\output.pdf");
    renderProvider(serviceWith({
      loadPlan: vi.fn().mockResolvedValue({ status: "missing", plan }),
    }), {
      exporter: {
        implementation: "react-pdf",
        export: vi.fn().mockResolvedValue(bytes),
      },
      saver: { save: savePdf },
    });
    await screen.findByText("BlockNote Canvas v14");

    fireEvent.click(screen.getByRole("button", { name: "导出 PDF" }));

    await waitFor(() => {
      expect(savePdf).toHaveBeenCalledWith(bytes, "output.pdf");
    });
    expect(savePdf.mock.calls[0]?.[0]).toBe(bytes);
  });
});
