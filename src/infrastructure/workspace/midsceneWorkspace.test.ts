import { beforeEach, describe, expect, it } from "vitest";
import {
  clearMidsceneWorkspaceStorage,
  createMidsceneWorkspaceDependencies,
  MIDSCENE_PROJECT_ROOT,
  MIDSCENE_STARTER_PATH,
} from "./midsceneWorkspace";
import { browserBlockNotePlanRepository } from "../plan/browserBlockNotePlan";

beforeEach(() => clearMidsceneWorkspaceStorage());

describe("createMidsceneWorkspaceDependencies", () => {
  it("deterministically bootstraps, registers, and reuses one starter project", async () => {
    const dependencies = createMidsceneWorkspaceDependencies();

    const [starter] = await dependencies.service.loadProjects();
    const [reloaded] = await dependencies.service.loadProjects();

    expect(starter).toEqual(expect.objectContaining({
      projectId: "midscene-starter-project",
      path: MIDSCENE_STARTER_PATH,
      name: "Preshot 入门示例",
      status: "available",
    }));
    expect(reloaded.projectId).toBe(starter.projectId);
    await expect(
      browserBlockNotePlanRepository.loadRawPlan(MIDSCENE_STARTER_PATH),
    ).resolves.toEqual(expect.objectContaining({
      schemaVersion: 15,
      document: expect.objectContaining({ version: 3 }),
      imageGroups: [],
      artifacts: [],
    }));
  });

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
    await expect(
      dependencies.projectDirectoryRevealer.revealProjectDirectory(
        second.path,
      ),
    ).resolves.toBeUndefined();
  });

  it("clears only Midscene-prefixed storage", () => {
    window.localStorage.setItem("preshot.midscene.test", "value");
    window.localStorage.setItem("unrelated", "keep");

    clearMidsceneWorkspaceStorage();

    expect(window.localStorage.getItem("preshot.midscene.test")).toBeNull();
    expect(window.localStorage.getItem("unrelated")).toBe("keep");
  });
});
