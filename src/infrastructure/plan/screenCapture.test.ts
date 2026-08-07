import { describe, expect, it, vi } from "vitest";
import { createTauriScreenCapture } from "./screenCapture";

describe("createTauriScreenCapture", () => {
  it("starts, polls, and cancels a native capture session", async () => {
    const invokeCommand = vi
      .fn()
      .mockResolvedValueOnce("capture-token")
      .mockResolvedValueOnce({ status: "captured", path: String.raw`C:\Temp\capture.png` })
      .mockResolvedValueOnce(null);
    const capture = createTauriScreenCapture({ invokeCommand });

    await expect(capture.start()).resolves.toBe("capture-token");
    await expect(capture.poll("capture-token")).resolves.toEqual({
      status: "captured",
      path: String.raw`C:\Temp\capture.png`,
    });
    await expect(capture.cancel("capture-token")).resolves.toBeUndefined();

    expect(invokeCommand.mock.calls).toEqual([
      ["start_screen_capture"],
      ["poll_screen_capture", { token: "capture-token" }],
      ["cancel_screen_capture", { token: "capture-token" }],
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
