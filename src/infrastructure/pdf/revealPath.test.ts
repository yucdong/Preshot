import { describe, it, expect, vi } from "vitest";
import { createTauriRevealTarget } from "./revealPath";

describe("createTauriRevealTarget", () => {
  it("invokes reveal_path with the given path", async () => {
    const invokeCommand = vi.fn().mockResolvedValue(undefined);
    const target = createTauriRevealTarget({ invokeCommand });

    await target.reveal("C:\\Users\\test\\output.pdf");

    expect(invokeCommand).toHaveBeenCalledWith("reveal_path", {
      path: "C:\\Users\\test\\output.pdf",
    });
  });

  it("wraps invoke errors with context", async () => {
    const invokeCommand = vi.fn().mockRejectedValue(new Error("spawn failed"));
    const target = createTauriRevealTarget({ invokeCommand });

    await expect(target.reveal("C:\\test.pdf")).rejects.toThrow(
      "Unable to reveal the file: spawn failed",
    );
  });
});
