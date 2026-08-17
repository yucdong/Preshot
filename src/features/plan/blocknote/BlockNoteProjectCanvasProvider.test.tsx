// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../../app/theme/ThemeProvider";
import { createEmptyProjectPlanV14 } from "../../../domain/plan/canvas/blockDocument";
import type { SettingsRepository } from "../../../domain/settings/ports";
import type { BlockNotePlanService } from "../../../domain/plan/blocknote/service";
import { BlockNoteProjectCanvasProvider } from "./BlockNoteProjectCanvasProvider";

const settings: SettingsRepository = {
  read: vi.fn().mockResolvedValue({ theme: "light" }),
  write: vi.fn().mockResolvedValue(undefined),
};

function renderProvider(service: BlockNotePlanService) {
  return render(
    <ThemeProvider repository={settings}>
      <BlockNoteProjectCanvasProvider
        exporter={{ export: vi.fn() }}
        picker={{
          pickImageFile: vi.fn().mockResolvedValue(null),
          pickImageFiles: vi.fn().mockResolvedValue(null),
        }}
        projectName="Editorial"
        projectPath={"C:\\Editorial"}
        saver={{ save: vi.fn() }}
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
});
