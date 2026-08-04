import { describe, it, expect, beforeEach } from "vitest";
import { createBrowserSettingsRepository } from "./browserSettings";
import { DEFAULT_SETTINGS } from "../../domain/settings/models";

describe("BrowserSettingsRepository", () => {
  let repo: ReturnType<typeof createBrowserSettingsRepository>;

  beforeEach(() => {
    repo = createBrowserSettingsRepository();
  });

  it("should default to system theme", async () => {
    const result = await repo.read();
    expect(result).toEqual(DEFAULT_SETTINGS);
  });

  it("should round-trip light theme", async () => {
    await repo.write({ theme: "light" });
    const result = await repo.read();
    expect(result).toEqual({ theme: "light" });
  });

  it("should round-trip dark theme", async () => {
    await repo.write({ theme: "dark" });
    const result = await repo.read();
    expect(result).toEqual({ theme: "dark" });
  });

  it("should round-trip system theme", async () => {
    await repo.write({ theme: "system" });
    const result = await repo.read();
    expect(result).toEqual({ theme: "system" });
  });

  it("should overwrite previous settings", async () => {
    await repo.write({ theme: "light" });
    await repo.write({ theme: "dark" });
    const result = await repo.read();
    expect(result).toEqual({ theme: "dark" });
  });
});
