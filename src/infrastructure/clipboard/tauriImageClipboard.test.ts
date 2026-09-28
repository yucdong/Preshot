import { describe, expect, it, vi } from "vitest";
import { createPlatformImageClipboard, createTauriImageClipboard } from "./tauriImageClipboard";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));

const image = { dataUrl: "data:image/png;base64,iVBORw0KGgo=", name: "照片.png" };
const contents = { original: image, renderedDataUrl: image.dataUrl, animated: false, external: false };

describe("native image clipboard boundary", () => {
  it("uses the three narrow commands and the shared contract", async () => {
    const invokeCommand = vi.fn()
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(contents).mockResolvedValueOnce(true);
    const port = createTauriImageClipboard({ invokeCommand });
    expect(port.availability).toBe("desktop");
    await port.write(image);
    expect(await port.read()).toEqual(contents);
    expect(await port.hasImage()).toBe(true);
    expect(invokeCommand.mock.calls).toEqual([
      ["image_clipboard_write", { image }],
      ["image_clipboard_read"],
      ["image_clipboard_has_image"],
    ]);
  });

  it("freezes a validated deep copy before invoking native code", async () => {
    const invokeCommand = vi.fn().mockResolvedValue(undefined);
    const input = { ...image, presentation: {
      aspectRatio: 1, frameWidth: 100, frameHeight: 100,
      crop: { x: 0, y: 0, width: 1, height: 1 },
    } };
    const pending = createTauriImageClipboard({ invokeCommand }).write(input);
    input.presentation.crop.x = 0.5;
    await pending;
    expect(invokeCommand.mock.calls[0][1].image.presentation.crop.x).toBe(0);
  });

  it.each([
    { ...image, dataUrl: "file:///C:/private/image.png" },
    { ...image, dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" },
    { ...image, dataUrl: "data:image/png;base64,%%%%" },
    { ...image, name: "C:\\private\\image.png" },
    { ...image, sourcePath: "C:\\private\\image.png" },
    { ...image, nativeProps: { previewWidth: Infinity } },
    { ...image, nativeProps: { caption: "x".repeat(8193) } },
    { ...image, presentation: { aspectRatio: 1, frameWidth: 0, frameHeight: 1 } },
    { ...image, presentation: { aspectRatio: 1, frameWidth: 1, frameHeight: 1, crop: {
      x: 0.5, y: 0, width: 1, height: 1,
    } } },
    { ...image, nativeProps: { textAlignment: "justify" } },
  ])("rejects invalid or path-bearing input before IPC", async (input) => {
    const invokeCommand = vi.fn();
    await expect(createTauriImageClipboard({ invokeCommand }).write(input as typeof image)).rejects.toThrow();
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rejects over-16-MiB encoded payloads before IPC", async () => {
    const invokeCommand = vi.fn();
    await expect(createTauriImageClipboard({ invokeCommand }).write({
      ...image, dataUrl: `data:image/png;base64,${"A".repeat(4 * Math.ceil((16 * 1024 * 1024 + 1) / 3))}`,
    })).rejects.toThrow(/16/);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("preserves explicit empty, lock errors, and malformed response errors separately", async () => {
    const invokeCommand = vi.fn().mockResolvedValueOnce(null)
      .mockRejectedValueOnce({ code: "image_clipboard_busy", message: "剪贴板正被其他应用占用，请稍后重试。" })
      .mockResolvedValueOnce({ ...contents, animated: "yes" })
      .mockResolvedValueOnce("false");
    const port = createTauriImageClipboard({ invokeCommand });
    expect(await port.read()).toBeNull();
    await expect(port.read()).rejects.toThrow(/其他应用占用/);
    await expect(port.read()).rejects.toThrow(/无效/);
    await expect(port.hasImage()).rejects.toThrow(/无效/);
  });

  it("never claims native clipboard capability in the browser", async () => {
    const port = createPlatformImageClipboard();
    expect(port.availability).toBe("unavailable");
    expect(await port.hasImage()).toBe(false);
    await expect(port.write(image)).rejects.toThrow(/桌面/);
    await expect(port.read()).rejects.toThrow(/桌面/);
  });
});
