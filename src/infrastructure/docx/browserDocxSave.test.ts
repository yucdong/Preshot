// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserDocxSaveTarget } from "./browserDocxSave";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("browserDocxSaveTarget", () => {
  it("downloads unchanged DOCX bytes as output.docx without reveal", async () => {
    const bytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1]);
    const createObjectURL = vi.spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:preshot-docx");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const anchor = document.createElement("a");
    vi.spyOn(document, "createElement").mockReturnValue(anchor);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    expect(browserDocxSaveTarget.revealProjectDirectoryAfterSave).toBe(false);
    await expect(browserDocxSaveTarget.save(bytes, {
      suggestedName: "output.docx",
      defaultDirectory: "C:\\Editorial",
    })).resolves.toBe("output.docx");

    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    await expect(blob.arrayBuffer()).resolves.toEqual(bytes.buffer);
    expect(anchor.download).toBe("output.docx");
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preshot-docx");
  });
});
