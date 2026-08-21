import { describe, expect, it, vi } from "vitest";
import { createTauriLongImageSaveTarget } from "./tauriLongImageSave";
import type {
  LongImageFormat,
  LongImageSaveRequest,
} from "../../domain/plan/longImageSave";
import {
  MAX_LONG_IMAGE_PARTS,
  MAX_LONG_IMAGE_TOTAL_BYTES,
} from "../../domain/plan/longImageSave";

function request(
  format: LongImageFormat,
  names: string[],
  defaultDirectory = "C:\\Editorial",
): LongImageSaveRequest {
  return {
    format,
    baseName: "output-long",
    defaultDirectory,
    parts: names.map((fileName, index) => ({
      fileName,
      bytes: Uint8Array.of(index + 1, 255 - index),
    })),
  };
}

function joinPath(directory: string, name: string): Promise<string> {
  return Promise.resolve(`${directory.replace(/[\\/]+$/, "")}\\${name}`);
}

describe("createTauriLongImageSaveTarget", () => {
  it.each([
    [
      "jpg",
      "\\\\?\\C:\\Client Shoots\\夏季 编辑\\",
      "C:\\Client Shoots\\夏季 编辑\\output-long.jpg",
      { name: "JPEG", extensions: ["jpg", "jpeg"] },
    ],
    [
      "png",
      "\\\\?\\UNC\\server\\share\\夏季 编辑\\",
      "\\\\server\\share\\夏季 编辑\\output-long.png",
      { name: "PNG", extensions: ["png"] },
    ],
  ] satisfies [
    LongImageFormat,
    string,
    string,
    { name: string; extensions: string[] },
  ][])(
    "normalizes the %s default path without writing on cancel",
    async (format, defaultDirectory, expectedPath, filter) => {
      const saveDialog = vi.fn().mockResolvedValue(null);
      const invokeCommand = vi.fn();
      const target = createTauriLongImageSaveTarget({
        saveDialog,
        invokeCommand,
        joinPath,
      });

      expect(
        await target.save(
          request(format, [`output-long.${format}`], defaultDirectory),
        ),
      ).toBeNull();
      expect(saveDialog).toHaveBeenCalledWith({
        defaultPath: expectedPath,
        filters: [filter],
      });
      expect(invokeCommand).not.toHaveBeenCalled();
    },
  );

  it("writes one JPEG part and returns the normalized native path", async () => {
    const invokeCommand = vi
      .fn()
      .mockResolvedValue(["C:\\Exports\\Hero.jpeg"]);
    const target = createTauriLongImageSaveTarget({
      saveDialog: vi.fn().mockResolvedValue("\\\\?\\C:\\Exports\\Hero.jpeg"),
      invokeCommand,
      joinPath,
    });

    await expect(
      target.save(request("jpeg", ["output-long.jpeg"])),
    ).resolves.toEqual(["C:\\Exports\\Hero.jpeg"]);
    expect(invokeCommand).toHaveBeenCalledWith("save_long_images", {
      format: "jpeg",
      parts: [
        {
          path: "C:\\Exports\\Hero.jpeg",
          contentsBase64: "Af8=",
        },
      ],
    });
  });

  it("derives numbered siblings from the selected first destination", async () => {
    const paths = [
      "\\\\server\\share\\交付\\Hero-01.png",
      "\\\\server\\share\\交付\\Hero-02.png",
      "\\\\server\\share\\交付\\Hero-03.png",
    ];
    const invokeCommand = vi.fn().mockResolvedValue(paths);
    const target = createTauriLongImageSaveTarget({
      saveDialog: vi.fn().mockResolvedValue(paths[0]),
      invokeCommand,
      joinPath,
    });

    await expect(
      target.save(
        request(
          "png",
          [
            "output-long-01.png",
            "output-long-02.png",
            "output-long-03.png",
          ],
          "\\\\server\\share\\交付",
        ),
      ),
    ).resolves.toEqual(paths);
    expect(invokeCommand.mock.calls[0]?.[1]).toMatchObject({
      parts: [
        { path: paths[0] },
        { path: paths[1] },
        { path: paths[2] },
      ],
    });
  });

  it("derives a numbered set when the user chooses an unnumbered base", async () => {
    const paths = [
      "C:\\Exports\\Campaign-01.jpg",
      "C:\\Exports\\Campaign-02.jpg",
    ];
    const invokeCommand = vi.fn().mockResolvedValue(paths);
    const target = createTauriLongImageSaveTarget({
      saveDialog: vi.fn().mockResolvedValue("C:\\Exports\\Campaign.jpg"),
      invokeCommand,
      joinPath,
    });

    await expect(
      target.save(
        request("jpg", ["output-long-01.jpg", "output-long-02.jpg"]),
      ),
    ).resolves.toEqual(paths);
  });

  it("rejects an unrelated selected extension before invoking Rust", async () => {
    const invokeCommand = vi.fn();
    const target = createTauriLongImageSaveTarget({
      saveDialog: vi.fn().mockResolvedValue("C:\\Exports\\Campaign.pdf"),
      invokeCommand,
      joinPath,
    });

    await expect(
      target.save(request("jpg", ["output-long.jpg"])),
    ).rejects.toThrow(/\.jpg or \.jpeg/);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rejects malformed native path results", async () => {
    const target = createTauriLongImageSaveTarget({
      saveDialog: vi.fn().mockResolvedValue("C:\\Exports\\Campaign.png"),
      invokeCommand: vi.fn().mockResolvedValue(["C:\\Other\\Campaign.png"]),
      joinPath,
    });

    await expect(
      target.save(request("png", ["output-long.png"])),
    ).rejects.toThrow(/native save result was invalid/);
  });

  it("accepts the exact bounded payload without changing multipart IPC", async () => {
    const partBytes = new Uint8Array(
      MAX_LONG_IMAGE_TOTAL_BYTES / MAX_LONG_IMAGE_PARTS,
    );
    const names = Array.from(
      { length: MAX_LONG_IMAGE_PARTS },
      (_, index) =>
        `output-long-${String(index + 1).padStart(2, "0")}.png`,
    );
    const paths = names.map((_, index) =>
      `C:\\Exports\\Campaign-${String(index + 1).padStart(2, "0")}.png`
    );
    const encodeBase64 = vi.fn().mockReturnValue("AA==");
    const invokeCommand = vi.fn().mockResolvedValue(paths);
    const target = createTauriLongImageSaveTarget({
      saveDialog: vi.fn().mockResolvedValue(paths[0]),
      invokeCommand,
      joinPath,
      encodeBase64,
    });

    await expect(target.save({
      format: "png",
      baseName: "output-long",
      defaultDirectory: "C:\\Editorial",
      parts: names.map((fileName) => ({ fileName, bytes: partBytes })),
    })).resolves.toEqual(paths);
    expect(encodeBase64).toHaveBeenCalledTimes(MAX_LONG_IMAGE_PARTS);
    expect(invokeCommand).toHaveBeenCalledOnce();
  });

  it("rejects one byte over budget before dialog, base64, or invoke", async () => {
    const encodeBase64 = vi.fn();
    const saveDialog = vi.fn();
    const invokeCommand = vi.fn();
    const target = createTauriLongImageSaveTarget({
      saveDialog,
      invokeCommand,
      joinPath,
      encodeBase64,
    });

    await expect(target.save({
      format: "png",
      baseName: "output-long",
      defaultDirectory: "C:\\Editorial",
      parts: [{
        fileName: "output-long.png",
        bytes: new Uint8Array(MAX_LONG_IMAGE_TOTAL_BYTES + 1),
      }],
    })).rejects.toThrow(/64 MiB/);
    expect(saveDialog).not.toHaveBeenCalled();
    expect(encodeBase64).not.toHaveBeenCalled();
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rejects many tiny parts before base64 or invoke", async () => {
    const encodeBase64 = vi.fn();
    const invokeCommand = vi.fn();
    const count = MAX_LONG_IMAGE_PARTS + 1;
    const target = createTauriLongImageSaveTarget({
      saveDialog: vi.fn(),
      invokeCommand,
      joinPath,
      encodeBase64,
    });

    await expect(target.save({
      format: "png",
      baseName: "output-long",
      defaultDirectory: "C:\\Editorial",
      parts: Array.from({ length: count }, (_, index) => ({
        fileName:
          `output-long-${String(index + 1).padStart(2, "0")}.png`,
        bytes: Uint8Array.of(index),
      })),
    })).rejects.toThrow(/32 parts/);
    expect(encodeBase64).not.toHaveBeenCalled();
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("treats a Unicode dialog rename as the authoritative numbered base", async () => {
    const selectedBase = "😀".repeat(60);
    const paths = [
      `C:\\交付\\${selectedBase}-01.png`,
      `C:\\交付\\${selectedBase}-02.png`,
    ];
    const invokeCommand = vi.fn().mockResolvedValue(paths);
    const target = createTauriLongImageSaveTarget({
      saveDialog: vi.fn().mockResolvedValue(paths[0]),
      invokeCommand,
      joinPath,
    });

    await expect(
      target.save(
        request("png", ["output-long-01.png", "output-long-02.png"]),
      ),
    ).resolves.toEqual(paths);
    expect(invokeCommand).toHaveBeenCalledWith("save_long_images", {
      format: "png",
      parts: [
        { path: paths[0], contentsBase64: "Af8=" },
        { path: paths[1], contentsBase64: "Av4=" },
      ],
    });
  });

  it.each([
    "C:\\Exports\\CON.png",
    "C:\\Exports\\project .png",
    "C:\\Exports\\..png",
    `C:\\Exports\\${"a".repeat(121)}.png`,
  ])("rejects an unsafe dialog-renamed destination: %s", async (path) => {
    const invokeCommand = vi.fn();
    const target = createTauriLongImageSaveTarget({
      saveDialog: vi.fn().mockResolvedValue(path),
      invokeCommand,
      joinPath,
    });

    await expect(
      target.save(request("png", ["output-long.png"])),
    ).rejects.toThrow(/Windows-safe base name/);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rejects traversal in the dialog-selected path", async () => {
    const invokeCommand = vi.fn();
    const target = createTauriLongImageSaveTarget({
      saveDialog: vi.fn().mockResolvedValue(
        "C:\\Exports\\..\\Other\\Campaign.png",
      ),
      invokeCommand,
      joinPath,
    });

    await expect(
      target.save(request("png", ["output-long.png"])),
    ).rejects.toThrow(/traversal segments/);
    expect(invokeCommand).not.toHaveBeenCalled();
  });
});
