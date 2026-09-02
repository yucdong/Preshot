import { describe, expect, it } from "vitest";
import { createBrowserSettingsRepository } from "../settings/browserSettings";
import {
  defaultPersistedAgentModelSettings,
} from "../../domain/agent";
import { createSettingsAgentModelStore } from "./settingsAgentModelStore";

describe("settings-backed agent model store", () => {
  it("migrates absent settings to defaults and preserves unrelated app settings", async () => {
    const repository = createBrowserSettingsRepository();
    await repository.write({ theme: "dark", assistantOpen: true });
    const store = createSettingsAgentModelStore(repository);

    expect(await store.load()).toEqual(defaultPersistedAgentModelSettings());
    const persisted = defaultPersistedAgentModelSettings();
    await store.save(persisted);

    expect(await repository.read()).toEqual({
      theme: "dark",
      assistantOpen: true,
      agentModel: persisted,
    });
  });

  it("rejects secret fields before persistence", async () => {
    const repository = createBrowserSettingsRepository();
    const store = createSettingsAgentModelStore(repository);
    const invalid = {
      ...defaultPersistedAgentModelSettings(),
      settings: {
        ...defaultPersistedAgentModelSettings().settings,
        apiKey: "secret",
      },
    };

    await expect(store.save(invalid)).rejects.toThrow(/unsupported field/i);
    expect(JSON.stringify(await repository.read())).not.toContain("secret");
  });
});
