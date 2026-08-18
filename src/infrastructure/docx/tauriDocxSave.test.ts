import { describe, expect, it, vi } from "vitest";
import { createTauriDocxSaveTarget } from "./tauriDocxSave";

describe("createTauriDocxSaveTarget", () => {
  it("defaults to current project output.docx and writes unchanged bytes", async () => {
    const saveDialog = vi.fn().mockResolvedValue("C:\\out\\Shoot.docx");
    const invokeCommand = vi.fn().mockResolvedValue(undefined);
    const joinPath = vi.fn().mockResolvedValue("C:\\Editorial\\output.docx");
    const target = createTauriDocxSaveTarget({
      saveDialog,
      invokeCommand,
      joinPath,
    });

    await expect(target.save(Uint8Array.from([0x50, 0x4b]), {
      suggestedName: "output.docx",
      defaultDirectory: "\\\\?\\C:\\Editorial",
    })).resolves.toBe("C:\\out\\Shoot.docx");

    expect(target.revealProjectDirectoryAfterSave).toBe(true);
    expect(joinPath).toHaveBeenCalledWith("C:\\Editorial", "output.docx");
    expect(saveDialog).toHaveBeenCalledWith({
      defaultPath: "C:\\Editorial\\output.docx",
      filters: [{ name: "DOCX", extensions: ["docx"] }],
    });
    expect(invokeCommand).toHaveBeenCalledWith("save_docx", {
      path: "C:\\out\\Shoot.docx",
      contentsBase64: "UEs=",
    });
  });

  it("returns null on cancel without invoking the native command", async () => {
    const invokeCommand = vi.fn();
    const target = createTauriDocxSaveTarget({
      saveDialog: vi.fn().mockResolvedValue(null),
      invokeCommand,
      joinPath: vi.fn().mockResolvedValue("C:\\Editorial\\output.docx"),
    });

    await expect(target.save(Uint8Array.from([1]), {
      suggestedName: "output.docx",
      defaultDirectory: "C:\\Editorial",
    })).resolves.toBeNull();
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("adds DOCX context to native write failures", async () => {
    const target = createTauriDocxSaveTarget({
      saveDialog: vi.fn().mockResolvedValue("C:\\Editorial\\output.docx"),
      invokeCommand: vi.fn().mockRejectedValue(new Error("access denied")),
      joinPath: vi.fn().mockResolvedValue("C:\\Editorial\\output.docx"),
    });

    await expect(target.save(Uint8Array.from([1]), {
      suggestedName: "output.docx",
      defaultDirectory: "C:\\Editorial",
    })).rejects.toThrow("Unable to save the DOCX: access denied");
  });
});
