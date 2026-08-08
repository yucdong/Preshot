import { describe, it, expect } from "vitest";
import { normalizeSettings, DEFAULT_SETTINGS } from "./models";

describe("normalizeSettings", () => {
  it("should accept valid light theme", () => {
    const result = normalizeSettings({ theme: "light" });
    expect(result).toEqual({ theme: "light", projectRailWidth: 192, assistantWidth: 272 });
  });

  it("should accept valid dark theme", () => {
    const result = normalizeSettings({ theme: "dark" });
    expect(result).toEqual({ theme: "dark", projectRailWidth: 192, assistantWidth: 272 });
  });

  it("should accept valid system theme", () => {
    const result = normalizeSettings({ theme: "system" });
    expect(result).toEqual({ theme: "system", projectRailWidth: 192, assistantWidth: 272 });
  });

  it("should default to system for empty object", () => {
    const result = normalizeSettings({});
    expect(result).toEqual(DEFAULT_SETTINGS);
  });

  it("should default to system for null", () => {
    const result = normalizeSettings(null);
    expect(result).toEqual(DEFAULT_SETTINGS);
  });

  it("should default to system for undefined", () => {
    const result = normalizeSettings(undefined);
    expect(result).toEqual(DEFAULT_SETTINGS);
  });

  it("should default to system for invalid theme value", () => {
    const result = normalizeSettings({ theme: "nope" });
    expect(result).toEqual(DEFAULT_SETTINGS);
  });

  it("should default to system for non-object input", () => {
    const result = normalizeSettings("x");
    expect(result).toEqual(DEFAULT_SETTINGS);
  });

  it("should default to system for number input", () => {
    const result = normalizeSettings(42);
    expect(result).toEqual(DEFAULT_SETTINGS);
  });

  it("accepts and clamps persisted global panel widths", () => {
    expect(normalizeSettings({
      theme: "light",
      projectRailWidth: 100,
      assistantWidth: 900,
    })).toEqual({
      theme: "light",
      projectRailWidth: 176,
      assistantWidth: 420,
    });
  });

  it("migrates the former default panel widths without changing custom widths", () => {
    expect(normalizeSettings({
      theme: "light",
      projectRailWidth: 208,
      assistantWidth: 304,
    })).toEqual({
      theme: "light",
      projectRailWidth: 192,
      assistantWidth: 272,
    });
    expect(normalizeSettings({
      theme: "light",
      projectRailWidth: 208,
      assistantWidth: 320,
    })).toEqual({
      theme: "light",
      projectRailWidth: 208,
      assistantWidth: 320,
    });
  });
});

describe("DEFAULT_SETTINGS", () => {
  it("should have system as default theme", () => {
    expect(DEFAULT_SETTINGS.theme).toBe("system");
    expect(DEFAULT_SETTINGS).toMatchObject({ projectRailWidth: 192, assistantWidth: 272 });
  });
});
