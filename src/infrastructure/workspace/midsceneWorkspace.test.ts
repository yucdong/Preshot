import { beforeEach, describe, expect, it } from "vitest";
import {
  clearMidsceneWorkspaceStorage,
  createMidsceneWorkspaceDependencies,
  MIDSCENE_PROJECT_ROOT,
} from "./midsceneWorkspace";

beforeEach(() => clearMidsceneWorkspaceStorage());

describe("createMidsceneWorkspaceDependencies", () => {
  it("creates isolated projects from the deterministic picker and removes records", async () => {
    const dependencies = createMidsceneWorkspaceDependencies();
    await expect(dependencies.directoryPicker.pickDirectory("ignored")).resolves.toBe(MIDSCENE_PROJECT_ROOT);

    const first = await dependencies.service.createProject(MIDSCENE_PROJECT_ROOT, "UIAUTO-A");
    const second = await dependencies.service.createProject(MIDSCENE_PROJECT_ROOT, "UIAUTO-B");

    expect(first.path).not.toBe(second.path);
    expect((await dependencies.service.loadProjects()).map((project) => project.name)).toEqual([
      "UIAUTO-B",
      "UIAUTO-A",
    ]);

    await dependencies.service.removeRecord(first.projectId);
    expect((await dependencies.service.loadProjects()).map((project) => project.name)).toEqual(["UIAUTO-B"]);
  });

  it("clears only Midscene-prefixed storage", () => {
    window.localStorage.setItem("preshot.midscene.test", "value");
    window.localStorage.setItem("unrelated", "keep");

    clearMidsceneWorkspaceStorage();

    expect(window.localStorage.getItem("preshot.midscene.test")).toBeNull();
    expect(window.localStorage.getItem("unrelated")).toBe("keep");
  });
});
