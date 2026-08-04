import { describe, expect, it, vi } from "vitest";
import { createTauriPdfSaveTarget } from "./tauriPdfSave";

describe("createTauriPdfSaveTarget", () => {
  it("returns null when the dialog is cancelled", async () => {
    const saveDialog = vi.fn().mockResolvedValue(null);
    const invokeCommand = vi.fn();
    const target = createTauriPdfSaveTarget({ saveDialog, invokeCommand });

    expect(await target.save(new Uint8Array([1]), "Shoot.pdf")).toBeNull();
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("writes the chosen path via save_pdf and returns the path", async () => {
    const saveDialog = vi.fn().mockResolvedValue("C:\\out\\Shoot.pdf");
    const invokeCommand = vi.fn().mockResolvedValue(undefined);
    const target = createTauriPdfSaveTarget({ saveDialog, invokeCommand });

    expect(await target.save(new Uint8Array([37, 80]), "Shoot.pdf")).toBe("C:\\out\\Shoot.pdf");
    expect(saveDialog).toHaveBeenCalledWith({
      defaultPath: "Shoot.pdf",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    expect(invokeCommand).toHaveBeenCalledWith("save_pdf", {
      path: "C:\\out\\Shoot.pdf",
      contentsBase64: expect.any(String),
    });
  });
});
