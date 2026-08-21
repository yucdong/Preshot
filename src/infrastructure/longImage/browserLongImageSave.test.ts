// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createBrowserLongImageSaveTarget } from "./browserLongImageSave";

describe("createBrowserLongImageSaveTarget", () => {
  it.each([
    ["jpg", "output-long.jpg", "image/jpeg"],
    ["jpeg", "output-long.jpeg", "image/jpeg"],
    ["png", "output-long.png", "image/png"],
  ] as const)(
    "downloads one %s part with unchanged bytes and name",
    async (format, fileName, mimeType) => {
      const download = vi.fn();
      const bytes = Uint8Array.of(1, 3, 5, 7);
      const target = createBrowserLongImageSaveTarget({ download });

      await expect(
        target.save({
          format,
          baseName: "output-long",
          defaultDirectory: "C:\\Editorial",
          parts: [{ fileName, bytes }],
        }),
      ).resolves.toEqual([fileName]);

      expect(target.revealProjectDirectoryAfterSave).toBe(false);
      expect(download).toHaveBeenCalledOnce();
      const [blob, downloadedName] = download.mock.calls[0] as [Blob, string];
      expect(downloadedName).toBe(fileName);
      expect(blob.type).toBe(mimeType);
      await expect(blob.arrayBuffer()).resolves.toEqual(bytes.buffer);
    },
  );

  it("uses the explicit typed no-op adapter for deterministic multi-part tests", async () => {
    const download = vi.fn();
    const multiPartAdapter = {
      implementation: "noop-test" as const,
      save: vi.fn().mockResolvedValue([
        "output-long-01.png",
        "output-long-02.png",
      ]),
    };
    const target = createBrowserLongImageSaveTarget({
      download,
      multiPartAdapter,
    });
    const request = {
      format: "png" as const,
      baseName: "output-long",
      defaultDirectory: "C:\\Editorial",
      parts: [
        { fileName: "output-long-01.png", bytes: Uint8Array.of(1) },
        { fileName: "output-long-02.png", bytes: Uint8Array.of(2) },
      ],
    };

    await expect(target.save(request)).resolves.toEqual([
      "output-long-01.png",
      "output-long-02.png",
    ]);
    expect(multiPartAdapter.save).toHaveBeenCalledWith(request);
    expect(download).not.toHaveBeenCalled();
  });
});
