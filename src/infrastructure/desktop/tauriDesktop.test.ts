import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("getDesktopPlatform", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("uses the typed platform_info command", async () => {
    invoke.mockResolvedValue({ os: "windows" });
    const { getDesktopPlatform } = await import("./tauriDesktop");

    await expect(getDesktopPlatform()).resolves.toEqual({ os: "windows" });
    expect(invoke).toHaveBeenCalledWith("platform_info");
  });

  it("retains operation context when the command fails", async () => {
    invoke.mockRejectedValue(new Error("bridge unavailable"));
    const { getDesktopPlatform } = await import("./tauriDesktop");

    await expect(getDesktopPlatform()).rejects.toThrow(
      "Unable to read desktop platform: bridge unavailable",
    );
  });
});
