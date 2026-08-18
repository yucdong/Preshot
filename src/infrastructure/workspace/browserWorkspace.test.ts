import { describe, expect, it } from "vitest";
import { createBrowserWorkspaceDependencies, EDITORIAL_DEMO_PATH } from "./browserWorkspace";

describe("createBrowserWorkspaceDependencies", () => {
  it("seeds 编辑大片示例, opens it deterministically, and clones returned state", async () => {
    const dependencies = createBrowserWorkspaceDependencies();

    const loadedProjects = await dependencies.service.loadProjects();

    expect(loadedProjects).toEqual([
      expect.objectContaining({
        projectId: "editorial-demo",
        path: EDITORIAL_DEMO_PATH,
        name: "编辑大片示例",
        status: "available",
        coverImage: null,
        coverDataUrl: null,
      }),
    ]);

    loadedProjects[0].name = "Mutated";
    loadedProjects[0].coverDataUrl = "data:image/png;base64,mutated";

    await expect(
      dependencies.directoryPicker.pickDirectory("ignored"),
    ).resolves.toBeNull();

    const openedProject = await dependencies.service.openProject(
      EDITORIAL_DEMO_PATH,
    );
    const reloadedProjects = await dependencies.service.loadProjects();

    expect(openedProject.name).toBe("编辑大片示例");
    expect(openedProject.coverDataUrl).toBeNull();
    expect(reloadedProjects[0].name).toBe("编辑大片示例");
    expect(reloadedProjects[0].coverDataUrl).toBeNull();
    await expect(
      dependencies.projectDirectoryRevealer.revealProjectDirectory(
        EDITORIAL_DEMO_PATH,
      ),
    ).resolves.toBeUndefined();
  });
});
