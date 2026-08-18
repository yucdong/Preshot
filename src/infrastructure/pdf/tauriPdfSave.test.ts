import { describe, expect, it, vi } from "vitest";
import { createTauriPdfSaveTarget } from "./tauriPdfSave";

describe("createTauriPdfSaveTarget", () => {
  it.each([
    ["C:\\Editorial", "C:\\Editorial", "C:\\Editorial\\output.pdf"],
    ["C:\\Editorial\\", "C:\\Editorial\\", "C:\\Editorial\\output.pdf"],
    ["\\\\?\\C:\\Editorial", "C:\\Editorial", "C:\\Editorial\\output.pdf"],
    [
      "C:\\Client Shoots\\夏季 编辑",
      "C:\\Client Shoots\\夏季 编辑",
      "C:\\Client Shoots\\夏季 编辑\\output.pdf",
    ],
    [
      "\\\\?\\C:\\Client Shoots\\夏季 编辑\\",
      "C:\\Client Shoots\\夏季 编辑\\",
      "C:\\Client Shoots\\夏季 编辑\\output.pdf",
    ],
    [
      "\\\\server\\share\\Editorial",
      "\\\\server\\share\\Editorial",
      "\\\\server\\share\\Editorial\\output.pdf",
    ],
    [
      "\\\\?\\UNC\\server\\share\\夏季 编辑\\",
      "\\\\server\\share\\夏季 编辑\\",
      "\\\\server\\share\\夏季 编辑\\output.pdf",
    ],
  ])(
    "uses the exact project output path for %s",
    async (defaultDirectory, expectedDirectory, expectedDefaultPath) => {
      const saveDialog = vi.fn().mockResolvedValue(null);
      const joinPath = vi.fn().mockImplementation(
        async (directory: string, name: string) =>
          `${directory.replace(/[\\/]+$/, "")}\\${name}`,
      );
      const target = createTauriPdfSaveTarget({
        saveDialog,
        invokeCommand: vi.fn(),
        joinPath,
      });

      await target.save(new Uint8Array([1]), {
        suggestedName: "output.pdf",
        defaultDirectory,
      });

      expect(joinPath).toHaveBeenCalledWith(expectedDirectory, "output.pdf");
      expect(saveDialog).toHaveBeenCalledWith({
        defaultPath: expectedDefaultPath,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
    },
  );

  it("returns null when the dialog is cancelled", async () => {
    const saveDialog = vi.fn().mockResolvedValue(null);
    const invokeCommand = vi.fn();
    const joinPath = vi.fn().mockResolvedValue("C:\\Editorial\\output.pdf");
    const target = createTauriPdfSaveTarget({
      saveDialog,
      invokeCommand,
      joinPath,
    });

    expect(target.revealProjectDirectoryAfterSave).toBe(true);
    expect(await target.save(new Uint8Array([1]), {
      suggestedName: "output.pdf",
      defaultDirectory: "C:\\Editorial",
    })).toBeNull();
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("defaults to project output.pdf, writes unchanged bytes, and returns the chosen path", async () => {
    const saveDialog = vi.fn().mockResolvedValue("C:\\out\\Shoot.pdf");
    const invokeCommand = vi.fn().mockResolvedValue(undefined);
    const joinPath = vi.fn().mockResolvedValue("C:\\Editorial\\output.pdf");
    const target = createTauriPdfSaveTarget({
      saveDialog,
      invokeCommand,
      joinPath,
    });

    expect(await target.save(new Uint8Array([37, 80]), {
      suggestedName: "output.pdf",
      defaultDirectory: "C:\\Editorial\\",
    })).toBe("C:\\out\\Shoot.pdf");
    expect(joinPath).toHaveBeenCalledWith("C:\\Editorial\\", "output.pdf");
    expect(saveDialog).toHaveBeenCalledWith({
      defaultPath: "C:\\Editorial\\output.pdf",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    expect(invokeCommand).toHaveBeenCalledWith("save_pdf", {
      path: "C:\\out\\Shoot.pdf",
      contentsBase64: "JVA=",
    });
  });
});
