// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserPdfSaveTarget } from "./browserPdfSave";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("browserPdfSaveTarget", () => {
  it("downloads the production PDF bytes with the requested filename", async () => {
    const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 1]);
    const createObjectURL = vi.spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:preshot-pdf");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const anchor = document.createElement("a");
    vi.spyOn(document, "createElement").mockReturnValue(anchor);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    expect(browserPdfSaveTarget.revealProjectDirectoryAfterSave).toBe(false);
    await expect(browserPdfSaveTarget.save(bytes, {
      suggestedName: "output.pdf",
      defaultDirectory: "C:\\Editorial",
    }))
      .resolves.toBe("output.pdf");

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob | undefined;
    expect(blob?.type).toBe("application/pdf");
    await expect(blob?.arrayBuffer()).resolves.toEqual(bytes.buffer);
    expect(click).toHaveBeenCalledTimes(1);
    expect(anchor.download).toBe("output.pdf");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preshot-pdf");
  });
});
