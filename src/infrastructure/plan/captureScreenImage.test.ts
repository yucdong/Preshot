import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureScreenImage } from "./captureScreenImage";

const reviewImage = { reason: "uniformDark" as const, previewUrl: "data:image/png;base64,AA" };
const cancellation = new Promise<void>(() => {});
function fixture() {
  return { start: vi.fn().mockResolvedValue("token"),
    poll: vi.fn().mockResolvedValue({ status: "captured", path: "capture.png", review: reviewImage }),
    cancel: vi.fn().mockResolvedValue(undefined), discard: vi.fn().mockResolvedValue(undefined) };
}
describe("suspicious screenshot review", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("does not import a suspicious screenshot before a decision and cleans a rejected result", async () => {
    const capture = fixture(), importer = vi.fn().mockResolvedValue("image");
    let decide!: (decision: "cancel") => void;
    const review = vi.fn(() => new Promise<"cancel">(resolve => { decide = resolve; }));
    const result = captureScreenImage(capture, cancellation, importer, review);
    await vi.advanceTimersByTimeAsync(250);
    expect(review).toHaveBeenCalledWith(reviewImage, cancellation);
    expect(importer).not.toHaveBeenCalled();
    decide("cancel");
    await expect(result).resolves.toBeNull();
    expect(capture.discard).toHaveBeenCalledExactlyOnceWith("capture.png");
    expect(capture.cancel).not.toHaveBeenCalled();
  });
  it("discards the rejected attempt before retrying and imports only the kept result", async () => {
    const capture = fixture(), importer = vi.fn().mockResolvedValue("kept");
    capture.start.mockImplementation(async () => {
      if (capture.start.mock.calls.length === 2) expect(capture.discard).toHaveBeenCalledOnce();
      return "token";
    });
    const review = vi.fn().mockResolvedValueOnce("retry").mockResolvedValueOnce("keep");
    const result = captureScreenImage(capture, cancellation, importer, review);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toBe("kept");
    expect(capture.start).toHaveBeenCalledTimes(2);
    expect(importer).toHaveBeenCalledOnce();
    expect(capture.discard).toHaveBeenCalledTimes(2);
  });
  it("does not publish when cancellation wins a pending review", async () => {
    const capture = fixture(), importer = vi.fn();
    let cancel!: () => void;
    const aborted = new Promise<void>(resolve => { cancel = resolve; });
    let decide!: (value: "keep") => void;
    const result = captureScreenImage(capture, aborted, importer,
      () => new Promise<"keep">(resolve => { decide = resolve; }));
    await vi.advanceTimersByTimeAsync(250);
    cancel();
    decide("keep");
    await expect(result).resolves.toBeNull();
    expect(importer).not.toHaveBeenCalled();
    expect(capture.discard).toHaveBeenCalledOnce();
  });
  it("stops retry when cleanup fails and exposes the cleanup failure", async () => {
    const capture = fixture(), importer = vi.fn();
    capture.discard.mockRejectedValue(new Error("disk unavailable"));
    const result = expect(captureScreenImage(capture, cancellation, importer,
      async () => "retry")).rejects.toThrow(/无法清理截图临时文件.*disk unavailable/);
    await vi.advanceTimersByTimeAsync(250);
    await result;
    expect(capture.start).toHaveBeenCalledOnce();
    expect(importer).not.toHaveBeenCalled();
  });
});
