import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_MODEL_SETTINGS } from "../../domain/agent";
import { createBrowserAgentModelProbe } from "./browserAgentModelProbe";

describe("browser agent model probe", () => {
  it("is deterministic and keeps vision separate from text verification", async () => {
    const port = createBrowserAgentModelProbe();
    const models = await port.listModels(DEFAULT_AGENT_MODEL_SETTINGS);
    expect(models.map((model) => model.id)).toEqual([
      "preshot-text",
      "preshot-vision",
    ]);
    const text = await port.probeModel(
      DEFAULT_AGENT_MODEL_SETTINGS,
      "preshot-text",
      { verifyVision: false },
    );
    expect(text.capabilities).toMatchObject({
      responsesApi: "verified",
      streaming: "verified",
      customTools: "verified",
      imageInput: "unknown",
    });
    const vision = await port.probeModel(
      DEFAULT_AGENT_MODEL_SETTINGS,
      "preshot-text",
      { verifyVision: true },
    );
    expect(vision.capabilities.imageInput).toBe("verified");
  });
});
