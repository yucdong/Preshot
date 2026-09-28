import { describe, it, expect } from "vitest";
import { normalizeSettings, DEFAULT_SETTINGS } from "./models";

describe("normalizeSettings", () => {
  it("accepts English and recovers missing or unsupported languages to Chinese", () => {
    expect(normalizeSettings({ language: "en" }).language).toBe("en");
    expect(normalizeSettings({ language: "zh" }).language).toBe("zh");
    expect(normalizeSettings({ language: "invalid" }).language).toBe("zh");
    expect(normalizeSettings({}).language).toBe("zh");
  });
  it("discards retired assistant settings while preserving the theme and custom project width", () => {
    expect(normalizeSettings({ language: "zh",
      theme: "dark",
      projectRailWidth: 260,
      assistantWidth: 360,
      assistantOpen: true,
      agentModel: { settings: { enabled: true, modelId: "previous-model" } },
    })).toEqual({ language: "zh", theme: "dark", projectRailWidth: 260 });
  });

  it("should accept valid light theme", () => {
    const result = normalizeSettings({ theme: "light" });
    expect(result).toEqual({ language: "zh", theme: "light", projectRailWidth: 192 });
  });

  it("should accept valid dark theme", () => {
    const result = normalizeSettings({ theme: "dark" });
    expect(result).toEqual({ language: "zh", theme: "dark", projectRailWidth: 192 });
  });

  it("should accept valid system theme", () => {
    const result = normalizeSettings({ theme: "system" });
    expect(result).toEqual({ language: "zh", theme: "system", projectRailWidth: 192 });
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
    expect(normalizeSettings({ language: "zh",
      theme: "light",
      projectRailWidth: 100,
      assistantWidth: 900,
    })).toEqual({ language: "zh",
      theme: "light",
      projectRailWidth: 176,
    });
  });

  it("migrates the former default panel widths without changing custom widths", () => {
    expect(normalizeSettings({ language: "zh",
      theme: "light",
      projectRailWidth: 208,
      assistantWidth: 304,
    })).toEqual({ language: "zh",
      theme: "light",
      projectRailWidth: 192,
    });

    expect(normalizeSettings({ language: "zh",
      theme: "light",
      projectRailWidth: 208,
      assistantWidth: 320,
      assistantOpen: false,
    })).toEqual({ language: "zh",
      theme: "light",
      projectRailWidth: 208,
    });
  });

  it("drops malformed or secret-bearing nested agent settings during recovery", () => {
    expect(normalizeSettings({
      theme: "dark",
      agentModel: {
        settings: {
          enabled: true,
          providerType: "openai",
          displayUrl: "http://localhost:4141",
          apiBaseUrl: "http://localhost:4141/v1",
          modelId: "model",
          wireApi: "responses",
          reasoningEffort: null,
          reasoningSummary: "concise",
          apiKey: "must-not-survive",
        },
        capabilityCache: null,
      },
    })).toEqual({ language: "zh",
      theme: "dark",
      projectRailWidth: 192,
    });
  });
});

describe("DEFAULT_SETTINGS", () => {
  it("should have system as default theme", () => {
    expect(DEFAULT_SETTINGS.theme).toBe("system");
    expect(DEFAULT_SETTINGS).toMatchObject({ projectRailWidth: 192 });
  });
});
