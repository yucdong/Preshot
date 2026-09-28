// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanDependencies } from "../../features/plan/blocknote/dependencies";
import { createEmptyProjectPlanV14 } from "../../domain/plan/canvas/blockDocument";
import { ThemeProvider } from "../theme/ThemeProvider";
import { Workspace } from "./Workspace";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("in-memory project sessions", () => {
  it("keeps real editors and images, isolates shortcuts, autosaves in the background and flushes before close", async () => {
    class DecodedImage {
      naturalWidth = 800;
      naturalHeight = 600;
      src = "";
      decode() { return Promise.resolve(); }
    }
    vi.stubGlobal("Image", DecodedImage);
    const savePlan = vi.fn().mockResolvedValue(undefined);
    const loadImage = vi.fn().mockResolvedValue("data:image/png;base64,AA");
    const loadPlan = vi.fn().mockImplementation(async (_path: string, name: string) => {
      const plan = createEmptyProjectPlanV14(name, { makeId: () => `${name}-text` });
      plan.document.blocks.push({ id: `${name}-gallery`, type: "imageGroup", props: { groupId: "gallery" }, content: undefined, children: [] });
      plan.imageGroups = [{
        id: "gallery", type: "reference", name: "参考", description: "", x: 0, width: 1008, height: 258,
        images: [{ id: "image", file: "references/0001.png", aspectRatio: 4 / 3, frameWidth: 320, frameHeight: 240 }],
      }];
      return { status: "missing", plan };
    });
    const dependencies: PlanDependencies = {
      service: {
        loadPlan, loadImage, savePlan, loadMedia: vi.fn(), importMedia: vi.fn(), importImages: vi.fn(),
        commitImageCrop: vi.fn(), removeImage: vi.fn(), removeGroup: vi.fn(),
        purgeDetachedGroups: vi.fn(), purgeDetachedMedia: vi.fn(),
      },
      picker: { pickImageFile: vi.fn(), pickImageFiles: vi.fn() },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      exporter: { implementation: "react-pdf", export: vi.fn() },
      docxExporter: { implementation: "blocknote-docx", export: vi.fn() },
      longImageExporter: { export: vi.fn() },
      saver: { save: vi.fn() }, docxSaver: { save: vi.fn() }, longImageSaver: { save: vi.fn() },
    };
    const flushers = new Map<string, () => Promise<void>>();
    const registerBeforeClose = (path: string, flush: () => Promise<void>) => {
      flushers.set(path, flush);
      return () => { flushers.delete(path); };
    };
    const settings = { read: async () => ({ theme: "light" as const }), write: async () => {} };
    const revealer = { revealProjectDirectory: vi.fn() };
    const ui = (active: string) => <ThemeProvider repository={settings}>
      {["one", "two"].map((id, index) => <Workspace key={id}
        active={active === id} loadId={index + 1} projectId={id} projectName={id} projectPath={`C:\\${id}`}
        dependencies={dependencies} projectDirectoryRevealer={revealer} registerBeforeClose={registerBeforeClose}
      />)}
    </ThemeProvider>;
    const view = render(ui("one"));
    await waitFor(() => expect(screen.getAllByRole("group", { name: "方案正文", hidden: true })).toHaveLength(2));
    const firstEditor = screen.getByRole("group", { name: "方案正文" });
    const firstImage = firstEditor.querySelector("img");
    expect(firstImage).not.toBeNull();
    const scroller = firstEditor.closest('[data-testid="canvas-scroller"]')!;
    scroller.scrollTop = 180;
    view.rerender(ui("two"));
    expect(firstEditor).not.toBeVisible();
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await act(async () => {});
    expect(savePlan).toHaveBeenCalledTimes(1);
    expect(savePlan.mock.calls[0][0]).toBe("C:\\two");
    view.rerender(ui("one"));
    expect(screen.getByRole("group", { name: "方案正文" })).toBe(firstEditor);
    expect(firstEditor.querySelector("img")).toBe(firstImage);
    expect(scroller.scrollTop).toBe(180);
    expect(loadPlan).toHaveBeenCalledTimes(2);
    expect(loadImage).toHaveBeenCalledTimes(2);

    // A failed close flush keeps the mounted draft available for retry.
    savePlan.mockRejectedValueOnce(new Error("Disk is full"));
    await act(async () => {
      await expect(flushers.get("C:\\one")!()).rejects.toThrow("Disk is full");
    });
    expect(firstEditor).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Disk is full");
    view.rerender(ui("two"));
    await waitFor(() => expect(savePlan).toHaveBeenCalledTimes(3), { timeout: 7_000 });
    expect(savePlan.mock.calls.at(-1)?.[0]).toBe("C:\\one");
    const saves = savePlan.mock.calls.length;
    await act(async () => { await flushers.get("C:\\one")!(); });
    expect(savePlan).toHaveBeenCalledTimes(saves);
    expect(loadPlan).toHaveBeenCalledTimes(2);
  }, 10_000);
});
