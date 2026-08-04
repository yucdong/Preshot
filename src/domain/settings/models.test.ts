import { describe, it, expect } from "vitest";
import { normalizeSettings, DEFAULT_SETTINGS } from "./models";

describe("normalizeSettings", () => {
  it("should accept valid light theme", () => {
    const result = normalizeSettings({ theme: "light" });
    expect(result).toEqual({ theme: "light" });
  });

  it("should accept valid dark theme", () => {
    const result = normalizeSettings({ theme: "dark" });
    expect(result).toEqual({ theme: "dark" });
  });

  it("should accept valid system theme", () => {
    const result = normalizeSettings({ theme: "system" });
    expect(result).toEqual({ theme: "system" });
  });

  it("should default to system for empty object", () => {
    const result = normalizeSettings({});
    expect(result).toEqual({ theme: "system" });
  });

  it("should default to system for null", () => {
    const result = normalizeSettings(null);
    expect(result).toEqual({ theme: "system" });
  });

  it("should default to system for undefined", () => {
    const result = normalizeSettings(undefined);
    expect(result).toEqual({ theme: "system" });
  });

  it("should default to system for invalid theme value", () => {
    const result = normalizeSettings({ theme: "nope" });
    expect(result).toEqual({ theme: "system" });
  });

  it("should default to system for non-object input", () => {
    const result = normalizeSettings("x");
    expect(result).toEqual({ theme: "system" });
  });

  it("should default to system for number input", () => {
    const result = normalizeSettings(42);
    expect(result).toEqual({ theme: "system" });
  });
});

describe("DEFAULT_SETTINGS", () => {
  it("should have system as default theme", () => {
    expect(DEFAULT_SETTINGS.theme).toBe("system");
  });
});
