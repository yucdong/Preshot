import { afterEach, describe, expect, it, vi } from "vitest";
import { createTauriScreenCapture } from "./screenCapture";

describe("createTauriScreenCapture", () => {
  afterEach(() => vi.useRealTimers());

  it("ends a system-cancelled capture quietly and starts the next session without sending another Escape", async () => {
    vi.useFakeTimers();
    let starts = 0;
    const media = { file: "media/0001.png", dataUrl: "data:image/png;base64,png", name: "截图.png", mimeType: "image/png" };
    const invokeCommand = vi.fn(async (command: string) => {
      if (command === "start_screen_capture") return `token-${++starts}`;
      if (command === "poll_screen_capture") return starts === 1 ? { status: "cancelled" } : { status: "captured", path: "capture.png" };
      if (command === "import_screen_capture_media") return media;
      return null;
    });
    const capture = createTauriScreenCapture({ invokeCommand });
    const first = expect(capture.captureMedia!("project", new Promise(() => {}))).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(250);
    await first;
    expect(invokeCommand).not.toHaveBeenCalledWith("cancel_screen_capture", expect.anything());
    expect(invokeCommand).not.toHaveBeenCalledWith("import_screen_capture_media", expect.anything());
    const second = capture.captureMedia!("project", new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(250);
    await expect(second).resolves.toEqual(media);
    expect(starts).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("copies the captured PNG into project media and drains temporary cleanup", async () => {
    vi.useFakeTimers();
    const media = { file: "media/0001.png", dataUrl: "data:image/png;base64,png", name: "截图.png", mimeType: "image/png" };
    const invokeCommand = vi.fn(async (command: string) => {
      if (command === "start_screen_capture") return "token";
      if (command === "poll_screen_capture") return { status: "captured", path: "capture.png" };
      if (command === "import_screen_capture_media") return media;
      if (command === "discard_screen_capture") return null;
      throw new Error(command);
    });
    const capture = createTauriScreenCapture({ invokeCommand });
    const pending = capture.captureMedia!("project", new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(250);
    await expect(pending).resolves.toEqual(media);
    expect(invokeCommand.mock.calls.map(([command]) => command)).toEqual([
      "start_screen_capture", "poll_screen_capture", "import_screen_capture_media", "discard_screen_capture",
    ]);
    expect(invokeCommand).toHaveBeenCalledWith("import_screen_capture_media", { projectPath: "project", path: "capture.png" });
  });

  it("rejects malformed imported media while still discarding the temporary capture", async () => {
    vi.useFakeTimers();
    const invokeCommand = vi.fn(async (command: string) => {
      if (command === "start_screen_capture") return "token";
      if (command === "poll_screen_capture") return { status: "captured", path: "capture.png" };
      if (command === "import_screen_capture_media") return { file: "C:/outside.png" };
      return null;
    });
    const pending = expect(createTauriScreenCapture({ invokeCommand }).captureMedia!("project", new Promise(() => {})))
      .rejects.toThrow(/无法保存截图到项目.*Malformed native response/);
    await vi.advanceTimersByTimeAsync(250);
    await pending;
    expect(invokeCommand).toHaveBeenLastCalledWith("discard_screen_capture", { path: "capture.png" });
  });

  it("starts, polls, cancels, and discards a native capture session", async () => {
    const invokeCommand = vi
      .fn()
      .mockResolvedValueOnce("capture-token")
      .mockResolvedValueOnce({ status: "captured", path: String.raw`C:\Temp\capture.png` })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const capture = createTauriScreenCapture({ invokeCommand });

    await expect(capture.start()).resolves.toBe("capture-token");
    await expect(capture.poll("capture-token")).resolves.toEqual({
      status: "captured",
      path: String.raw`C:\Temp\capture.png`,
    });
    await expect(capture.cancel("capture-token")).resolves.toBeUndefined();
    await expect(
      capture.discard(String.raw`C:\Temp\capture.png`),
    ).resolves.toBeUndefined();

    expect(invokeCommand.mock.calls).toEqual([
      ["start_screen_capture"],
      ["poll_screen_capture", { token: "capture-token" }],
      ["cancel_screen_capture", { token: "capture-token" }],
      ["discard_screen_capture", { path: String.raw`C:\Temp\capture.png` }],
    ]);
  });

  it("accepts a pending response and rejects malformed native data with context", async () => {
    const invokeCommand = vi
      .fn()
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "captured", path: "" });
    const capture = createTauriScreenCapture({ invokeCommand });

    await expect(capture.poll("token")).resolves.toEqual({ status: "pending" });
    await expect(capture.poll("token")).rejects.toThrow(
      /Unable to poll the screen capture: Malformed native response/,
    );
  });
});
