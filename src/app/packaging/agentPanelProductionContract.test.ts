import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("production agent panel contract", () => {
  it("keeps container-width stacking, forced colors, and reduced motion", () => {
    const styles = readFileSync("src/styles.css", "utf8");
    expect(styles).toContain(".agent-panel");
    expect(styles).toContain("@container (max-width: 319px)");
    expect(styles).toContain("@media (forced-colors: active)");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles.indexOf("@media (forced-colors: active)"))
      .toBeGreaterThan(styles.indexOf("@media (prefers-reduced-motion: reduce)"));
    const panel = readFileSync("src/features/agent/AgentPanel.tsx", "utf8");
    expect(panel).toContain("overflow-x-hidden");
  });

  it("uses the production panel decomposition and a non-live transcript log", () => {
    const panel = readFileSync("src/features/agent/AgentPanel.tsx", "utf8");
    const transcript = readFileSync(
      "src/features/agent/AgentTranscript.tsx",
      "utf8",
    );
    for (const component of [
      "AgentHeader",
      "AgentHistory",
      "AgentTranscript",
      "AgentComposer",
      "AgentProposalReview",
    ]) {
      expect(panel).toContain(`<${component}`);
    }
    expect(transcript).toContain('aria-live="off"');
    expect(transcript).toContain('role="log"');
  });

  it("keeps native logs metadata-only and the renderer off the model network", () => {
    const runtime = readFileSync("src-tauri/src/agent/runtime.rs", "utf8");
    const tauri = readFileSync("src-tauri/tauri.conf.json", "utf8");
    const logs = [...runtime.matchAll(/tracing::(?:info|warn)!\(([\s\S]*?)\);/g)]
      .map((match) => match[1])
      .join("\n");

    expect(logs).toContain("redacted_id");
    for (const forbidden of [
      "request.text",
      "project_root",
      "project_path",
      "attachment",
      "message",
    ]) {
      expect(logs).not.toContain(forbidden);
    }
    expect(tauri).not.toContain("localhost:4141");
    expect(tauri).not.toContain("https://*");
    expect(tauri).not.toContain("http://*");
  });
});
