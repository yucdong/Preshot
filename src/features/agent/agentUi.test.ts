import i18n from "../../shared/i18n/config";
import {
  AGENT_ERROR_CODES,
  type AgentSessionState,
} from "../../domain/agent";
import { describe, expect, it } from "vitest";
import {
  errorLabel,
  extractAgentCitations,
  sessionStatusLabel,
  toolLabel,
} from "./agentUi";

describe("agent UI localization", () => {
  it("provides Chinese labels for every typed error and session status", () => {
    const t = i18n.t.bind(i18n);
    for (const code of AGENT_ERROR_CODES) {
      const label = errorLabel(t, code);
      expect(label).not.toContain("agent.");
      expect(label).toMatch(/[\u3400-\u9fff]/u);
    }
    const states: readonly AgentSessionState[] = [
      "creating",
      "idle",
      "running",
      "waiting_permission",
      "waiting_user_input",
      "stopping",
      "disconnected",
      "error",
      "deleting",
    ];
    for (const state of states) {
      expect(sessionStatusLabel(t, state)).toMatch(/[\u3400-\u9fff]/u);
    }
  });

  it("localizes the closed tool allowlist and parses bounded citations", () => {
    const t = i18n.t.bind(i18n);
    for (const name of [
      "get_project_summary",
      "read_text_blocks",
      "list_reference_images",
      "propose_text_block_edits",
    ]) {
      expect(toolLabel(t, name)).toMatch(/[\u3400-\u9fff]/u);
    }
    expect(extractAgentCitations(
      "检查 [[block:block-1]] 与 [[image:group-1:image-1]]",
      "project-1",
    )).toEqual({
      text: "检查  与",
      citations: [{
        index: 1,
        citation: {
          kind: "block",
          projectId: "project-1",
          blockId: "block-1",
        },
      }, {
        index: 2,
        citation: {
          kind: "image",
          projectId: "project-1",
          groupId: "group-1",
          imageId: "image-1",
        },
      }],
    });
  });
});
