import { describe, expect, it, vi } from "vitest";
import { createTauriPdfSaveTarget } from "./tauriPdfSave";

describe("createTauriPdfSaveTarget", () => {
  it("returns false when the dialog is cancelled", async () => {
    const saveDialog = vi.fn().mockResolvedValue(null);
    const invokeCommand = vi.fn();
    const target = createTauriPdfSaveTarget({ saveDialog, invokeCommand });

    expect(await target.save(new Uint8Array([1]), "Shoot.pdf")).toBe(false);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("writes the chosen path via save_pdf", async () => {
    const saveDialog = vi.fn().mockResolvedValue("C:\\out\\Shoot.pdf");
    const invokeCommand = vi.fn().mockResolvedValue(undefined);
    const target = createTauriPdfSaveTarget({ saveDialog, invokeCommand });

    expect(await target.save(new Uint8Array([37, 80]), "Shoot.pdf")).toBe(true);
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
