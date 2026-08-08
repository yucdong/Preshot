import { describe, it, expect, vi } from "vitest";
import { createTauriSettingsRepository } from "./tauriSettings";
import type { AppSettings } from "../../domain/settings/models";

describe("TauriSettingsRepository", () => {
  it("should read settings and normalize", async () => {
    const mockInvoke = vi.fn().mockResolvedValue({ theme: "dark" });
    const repo = createTauriSettingsRepository({ invokeCommand: mockInvoke });

    const result = await repo.read();

    expect(mockInvoke).toHaveBeenCalledWith("read_settings");
    expect(result).toEqual({ theme: "dark", projectRailWidth: 192, assistantWidth: 272 });
  });

  it("should normalize invalid settings from backend", async () => {
    const mockInvoke = vi.fn().mockResolvedValue({ theme: "invalid" });
    const repo = createTauriSettingsRepository({ invokeCommand: mockInvoke });

    const result = await repo.read();

    expect(result).toEqual({ theme: "system", projectRailWidth: 192, assistantWidth: 272 });
  });

  it("should normalize null from backend", async () => {
    const mockInvoke = vi.fn().mockResolvedValue(null);
    const repo = createTauriSettingsRepository({ invokeCommand: mockInvoke });

    const result = await repo.read();

    expect(result).toEqual({ theme: "system", projectRailWidth: 192, assistantWidth: 272 });
  });

  it("should write settings", async () => {
    const mockInvoke = vi.fn().mockResolvedValue(undefined);
    const repo = createTauriSettingsRepository({ invokeCommand: mockInvoke });
    const settings: AppSettings = { theme: "light" };

    await repo.write(settings);

    expect(mockInvoke).toHaveBeenCalledWith("write_settings", { value: { theme: "light" } });
  });

  it("should throw on write error with context", async () => {
    const mockInvoke = vi.fn().mockRejectedValue(new Error("Disk full"));
    const repo = createTauriSettingsRepository({ invokeCommand: mockInvoke });

    await expect(repo.write({ theme: "dark" })).rejects.toThrow(
      "Unable to write settings: Disk full"
    );
  });

  it("should throw on read error with context", async () => {
    const mockInvoke = vi.fn().mockRejectedValue(new Error("File corrupt"));
    const repo = createTauriSettingsRepository({ invokeCommand: mockInvoke });

    await expect(repo.read()).rejects.toThrow("Unable to read settings: File corrupt");
  });
});
