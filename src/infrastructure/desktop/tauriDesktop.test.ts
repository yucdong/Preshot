import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(),
}));
const { maximize } = vi.hoisted(() => ({
  maximize: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ maximize }),
}));

describe("getDesktopPlatform", () => {
  beforeEach(() => {
    invoke.mockReset();
    maximize.mockReset();
  });

  it("maximizes the current desktop window", async () => {
    maximize.mockResolvedValue(undefined);
    const { maximizeCurrentWindow } = await import("./tauriDesktop");

    await expect(maximizeCurrentWindow()).resolves.toBeUndefined();
    expect(maximize).toHaveBeenCalledTimes(1);
  });

  it("retains context when maximizing the window fails", async () => {
    maximize.mockRejectedValue(new Error("window unavailable"));
    const { maximizeCurrentWindow } = await import("./tauriDesktop");

    await expect(maximizeCurrentWindow()).rejects.toThrow(
      "Unable to maximize the desktop window: window unavailable",
    );
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
