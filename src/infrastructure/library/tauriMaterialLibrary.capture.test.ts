import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MaterialEditImage } from "../../domain/library/models";
import type { ScreenCapture, ScreenCapturePollResult } from "../../domain/plan/ports";
import { createTauriMaterialLibrary } from "./tauriMaterialLibrary";

const sessionId = "cb481ce3-64d4-4cd4-9cbb-79eb9d0a3c88";
const capturePath = "C:\\capture-staging\\preshot-capture-token.png";
const staged: MaterialEditImage = {
  localImageId: "copied-screenshot",
  mimeType: "image/png",
  byteLength: 3,
  width: 20,
  height: 30,
  dataUrl: "data:image/png;base64,YWJj",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup() {
  const cancellation = deferred<void>();
  const screenCapture = {
    start: vi.fn<ScreenCapture["start"]>().mockResolvedValue("capture-token"),
    poll: vi.fn<ScreenCapture["poll"]>().mockResolvedValue({ status: "captured", path: capturePath }),
    cancel: vi.fn<ScreenCapture["cancel"]>().mockResolvedValue(undefined),
    discard: vi.fn<ScreenCapture["discard"]>().mockResolvedValue(undefined),
  };
  const invokeCommand = vi.fn().mockResolvedValue([staged]);
  const pickImageFiles = vi.fn().mockRejectedValue(new Error("Capture must not open a picker"));
  const editor = createTauriMaterialLibrary({
    invokeCommand, screenCapture, imagePicker: { pickImageFiles },
  }).contentEditor!;
  return {
    cancellation, screenCapture, invokeCommand, pickImageFiles,
    capture: () => editor.captureEditImage(sessionId, cancellation.promise),
  };
}

describe("isolated material screenshot insertion", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("treats system cancellation as a quiet empty result and allows another material capture", async () => {
    const { capture, screenCapture, invokeCommand } = setup();
    screenCapture.poll.mockResolvedValueOnce({ status: "cancelled" });
    const first = capture();
    await vi.advanceTimersByTimeAsync(250);
    await expect(first).resolves.toBeNull();
    expect(invokeCommand).not.toHaveBeenCalled();
    expect(screenCapture.cancel).not.toHaveBeenCalled();
    const second = capture();
    await vi.advanceTimersByTimeAsync(250);
    await expect(second).resolves.toEqual(staged);
    expect(screenCapture.start).toHaveBeenCalledTimes(2);
  });

  it("uses the default native capture port, polls at 250ms, and copies exactly one image into this draft", async () => {
    let polls = 0;
    const invokeCommand = vi.fn(async (command: string) => {
      switch (command) {
        case "start_screen_capture": return "capture-token";
        case "poll_screen_capture":
          return ++polls === 1 ? { status: "pending" } : { status: "captured", path: capturePath };
        case "library_import_edit_images": return [staged];
        case "discard_screen_capture": return null;
        default: throw new Error(`Unexpected command: ${command}`);
      }
    });
    const pickImageFiles = vi.fn();
    const editor = createTauriMaterialLibrary({ invokeCommand, imagePicker: { pickImageFiles } }).contentEditor!;
    const result = editor.captureEditImage(sessionId, deferred<void>().promise);
    await vi.advanceTimersByTimeAsync(249);
    expect(polls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(polls).toBe(1);
    await vi.advanceTimersByTimeAsync(250);
    await expect(result).resolves.toEqual(staged);
    expect(pickImageFiles).not.toHaveBeenCalled();
    expect(invokeCommand.mock.calls).toEqual([
      ["start_screen_capture"],
      ["poll_screen_capture", { token: "capture-token" }],
      ["poll_screen_capture", { token: "capture-token" }],
      ["library_import_edit_images", { sessionId, sourcePaths: [capturePath] }],
      ["discard_screen_capture", { path: capturePath }],
    ]);
  });

  it("does not start an already cancelled capture", async () => {
    const { cancellation, capture, screenCapture, invokeCommand } = setup();
    cancellation.resolve();
    await expect(capture()).resolves.toBeNull();
    expect(screenCapture.start).not.toHaveBeenCalled();
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("drains a late start before cancelling its token", async () => {
    const { cancellation, capture, screenCapture, invokeCommand } = setup();
    const started = deferred<string>();
    screenCapture.start.mockReturnValue(started.promise);
    const settled = vi.fn();
    const result = capture().then((value) => { settled(); return value; });
    await vi.advanceTimersByTimeAsync(0);
    expect(screenCapture.start).toHaveBeenCalledOnce();
    cancellation.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(screenCapture.cancel).not.toHaveBeenCalled();
    expect(settled).not.toHaveBeenCalled();
    started.resolve("late-token");
    await expect(result).resolves.toBeNull();
    expect(screenCapture.cancel).toHaveBeenCalledExactlyOnceWith("late-token");
    expect(screenCapture.poll).not.toHaveBeenCalled();
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("cancels a polling delay immediately without waiting for the next tick", async () => {
    const { cancellation, capture, screenCapture } = setup();
    screenCapture.poll.mockResolvedValue({ status: "pending" });
    const result = capture();
    await vi.advanceTimersByTimeAsync(251);
    cancellation.resolve();
    await expect(result).resolves.toBeNull();
    expect(screenCapture.poll).toHaveBeenCalledTimes(1);
    expect(screenCapture.cancel).toHaveBeenCalledExactlyOnceWith("capture-token");
  });

  it.each(["pending", "captured"] as const)("drains a pending poll and cleans its late %s result", async (status) => {
    const { cancellation, capture, screenCapture, invokeCommand } = setup();
    const polled = deferred<ScreenCapturePollResult>();
    screenCapture.poll.mockReturnValue(polled.promise);
    const settled = vi.fn();
    const result = capture().then((value) => { settled(); return value; });
    await vi.advanceTimersByTimeAsync(250);
    cancellation.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(screenCapture.cancel).not.toHaveBeenCalled();
    expect(screenCapture.discard).not.toHaveBeenCalled();
    expect(settled).not.toHaveBeenCalled();
    polled.resolve(status === "pending" ? { status } : { status, path: capturePath });
    await expect(result).resolves.toBeNull();
    expect(invokeCommand).not.toHaveBeenCalled();
    if (status === "pending") {
      expect(screenCapture.cancel).toHaveBeenCalledExactlyOnceWith("capture-token");
      expect(screenCapture.discard).not.toHaveBeenCalled();
    } else {
      expect(screenCapture.discard).toHaveBeenCalledExactlyOnceWith(capturePath);
      expect(screenCapture.cancel).not.toHaveBeenCalled();
    }
  });

  it("never imports a captured response that resolves in the same turn as cancellation", async () => {
    const { cancellation, capture, screenCapture, invokeCommand } = setup();
    const polled = deferred<ScreenCapturePollResult>();
    screenCapture.poll.mockReturnValue(polled.promise);
    const result = capture();
    await vi.advanceTimersByTimeAsync(250);
    polled.resolve({ status: "captured", path: capturePath });
    cancellation.resolve();
    await expect(result).resolves.toBeNull();
    expect(invokeCommand).not.toHaveBeenCalled();
    expect(screenCapture.discard).toHaveBeenCalledExactlyOnceWith(capturePath);
  });

  it("drains an in-flight import before discarding its source and suppresses the late image", async () => {
    const { cancellation, capture, screenCapture, invokeCommand } = setup();
    const imported = deferred<unknown>();
    invokeCommand.mockReturnValue(imported.promise);
    const settled = vi.fn();
    const result = capture().then((value) => { settled(); return value; });
    await vi.advanceTimersByTimeAsync(250);
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith(
      "library_import_edit_images", { sessionId, sourcePaths: [capturePath] },
    );
    cancellation.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(screenCapture.discard).not.toHaveBeenCalled();
    expect(settled).not.toHaveBeenCalled();
    imported.resolve([staged]);
    await expect(result).resolves.toBeNull();
    expect(screenCapture.discard).toHaveBeenCalledExactlyOnceWith(capturePath);
  });

  it("stops the capture deadline once a PNG is acquired, even when staging takes longer", async () => {
    const { capture, screenCapture, invokeCommand } = setup();
    const imported = deferred<unknown>();
    invokeCommand.mockReturnValue(imported.promise);
    const result = capture();
    await vi.advanceTimersByTimeAsync(250);
    expect(invokeCommand).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(90_000);
    imported.resolve([staged]);
    await expect(result).resolves.toEqual(staged);
    expect(screenCapture.discard).toHaveBeenCalledExactlyOnceWith(capturePath);
    expect(screenCapture.cancel).not.toHaveBeenCalled();
  });

  it("awaits discard and suppresses an image cancelled during cleanup", async () => {
    const { cancellation, capture, screenCapture } = setup();
    const discarded = deferred<void>();
    screenCapture.discard.mockReturnValue(discarded.promise);
    const settled = vi.fn();
    const result = capture().then((value) => { settled(); return value; });
    await vi.advanceTimersByTimeAsync(250);
    expect(screenCapture.discard).toHaveBeenCalledOnce();
    expect(settled).not.toHaveBeenCalled();
    cancellation.resolve();
    discarded.resolve();
    await expect(result).resolves.toBeNull();
  });

  it("bounds pending polling at 90 seconds and rejects with an actionable timeout", async () => {
    const { capture, screenCapture, invokeCommand } = setup();
    screenCapture.poll.mockResolvedValue({ status: "pending" });
    const result = expect(capture()).rejects.toThrow(/超时.*重试/);
    await vi.advanceTimersByTimeAsync(90_000);
    await result;
    expect(screenCapture.poll.mock.calls.length).toBeLessThanOrEqual(360);
    expect(screenCapture.cancel).toHaveBeenCalledExactlyOnceWith("capture-token");
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("drains a poll past the timeout and discards a late capture without importing", async () => {
    const { capture, screenCapture, invokeCommand } = setup();
    const polled = deferred<ScreenCapturePollResult>();
    screenCapture.poll.mockReturnValue(polled.promise);
    const settled = vi.fn();
    const result = capture().finally(settled);
    const rejected = expect(result).rejects.toThrow(/超时.*重试/);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(settled).not.toHaveBeenCalled();
    expect(screenCapture.cancel).not.toHaveBeenCalled();
    polled.resolve({ status: "captured", path: capturePath });
    await rejected;
    expect(invokeCommand).not.toHaveBeenCalled();
    expect(screenCapture.discard).toHaveBeenCalledExactlyOnceWith(capturePath);
  });

  it("drains a start past the timeout before cancelling its late token", async () => {
    const { capture, screenCapture } = setup();
    const started = deferred<string>();
    screenCapture.start.mockReturnValue(started.promise);
    const settled = vi.fn();
    const result = capture().finally(settled);
    const rejected = expect(result).rejects.toThrow(/超时.*重试/);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(settled).not.toHaveBeenCalled();
    expect(screenCapture.cancel).not.toHaveBeenCalled();
    started.resolve("late-token");
    await rejected;
    expect(screenCapture.cancel).toHaveBeenCalledExactlyOnceWith("late-token");
    expect(screenCapture.poll).not.toHaveBeenCalled();
  });

  it.each(["start", "poll", "import"] as const)("surfaces a failed %s even after cancellation", async (operation) => {
    const { cancellation, capture, screenCapture, invokeCommand } = setup();
    const pending = deferred<never>();
    if (operation === "import") invokeCommand.mockReturnValue(pending.promise);
    else screenCapture[operation].mockReturnValue(pending.promise);
    const result = expect(capture()).rejects.toThrow(`failed ${operation}`);
    await vi.advanceTimersByTimeAsync(250);
    cancellation.resolve();
    pending.reject(new Error(`failed ${operation}`));
    await result;
    if (operation === "import") {
      expect(screenCapture.discard).toHaveBeenCalledExactlyOnceWith(capturePath);
    } else {
      expect(screenCapture.discard).not.toHaveBeenCalled();
      expect(screenCapture.cancel).toHaveBeenCalledTimes(operation === "poll" ? 1 : 0);
    }
  });

  it.each(["start", "poll"] as const)("rejects malformed native %s data with operation context", async (operation) => {
    const invokeCommand = vi.fn(async (command: string) => {
      if (command === "start_screen_capture") return operation === "start" ? "" : "capture-token";
      if (command === "poll_screen_capture") return { status: "captured", path: "" };
      if (command === "cancel_screen_capture") return null;
      throw new Error(`Unexpected command: ${command}`);
    });
    const editor = createTauriMaterialLibrary({ invokeCommand }).contentEditor!;
    const result = expect(editor.captureEditImage(sessionId, deferred<void>().promise))
      .rejects.toThrow(/截图.*Malformed native response/);
    await vi.advanceTimersByTimeAsync(250);
    await result;
    expect(invokeCommand.mock.calls.map(([command]) => command)).toEqual(operation === "start"
      ? ["start_screen_capture"]
      : ["start_screen_capture", "poll_screen_capture", "cancel_screen_capture"]);
  });

  it.each([
    { response: null },
    { response: [] },
    { response: [staged, staged] },
    { response: [{ ...staged, localImageId: "" }] },
    { response: [{ ...staged, width: 8192, height: 8192 }] },
    { response: [{ ...staged, byteLength: 2 }] },
    { response: [{ ...staged, dataUrl: "https://example.com/image.png" }] },
  ])("rejects malformed or non-single image imports and still discards the capture ($response)", async ({ response }) => {
    const { capture, screenCapture, invokeCommand } = setup();
    invokeCommand.mockResolvedValue(response);
    const result = expect(capture()).rejects.toThrow(/素材/);
    await vi.advanceTimersByTimeAsync(250);
    await result;
    expect(screenCapture.discard).toHaveBeenCalledExactlyOnceWith(capturePath);
  });

  it.each([false, true])("surfaces discard failures instead of returning a successful image or cancellation (%s)", async (cancelled) => {
    const { cancellation, capture, screenCapture } = setup();
    screenCapture.discard.mockImplementation(async () => {
      if (cancelled) cancellation.resolve();
      throw new Error("discard failed");
    });
    const result = expect(capture()).rejects.toThrow(/清理.*discard failed/);
    await vi.advanceTimersByTimeAsync(250);
    await result;
  });

  it("surfaces cancellation cleanup failures instead of returning null", async () => {
    const { cancellation, capture, screenCapture } = setup();
    screenCapture.cancel.mockRejectedValue(new Error("cancel failed"));
    const result = expect(capture()).rejects.toThrow(/取消.*cancel failed/);
    await vi.advanceTimersByTimeAsync(0);
    cancellation.resolve();
    await result;
  });

  it("surfaces a rejected cancellation signal and cancels the active token", async () => {
    const { cancellation, capture, screenCapture } = setup();
    const result = expect(capture()).rejects.toThrow(/取消状态.*signal failed/);
    await vi.advanceTimersByTimeAsync(0);
    cancellation.reject(new Error("signal failed"));
    await result;
    expect(screenCapture.cancel).toHaveBeenCalledExactlyOnceWith("capture-token");
  });

  it.each(["poll", "import"] as const)("preserves both the primary %s error and cleanup failure", async (operation) => {
    const { capture, screenCapture, invokeCommand } = setup();
    if (operation === "poll") {
      screenCapture.poll.mockRejectedValue(new Error("primary poll failure"));
      screenCapture.cancel.mockRejectedValue(new Error("cleanup failure"));
    } else {
      invokeCommand.mockRejectedValue(new Error("primary import failure"));
      screenCapture.discard.mockRejectedValue(new Error("cleanup failure"));
    }
    const result = expect(capture()).rejects.toMatchObject({
      message: expect.stringMatching(/primary .* failure.*cleanup failure/),
      cause: expect.objectContaining({ errors: expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining(`primary ${operation} failure`) }),
        expect.objectContaining({ message: expect.stringContaining("cleanup failure") }),
      ]) }),
    });
    await vi.advanceTimersByTimeAsync(250);
    await result;
  });
});
