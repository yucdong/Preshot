import { describe, expect, it } from "vitest";
import { createBrowserWorkspaceDependencies, EDITORIAL_DEMO_PATH } from "./browserWorkspace";

describe("createBrowserWorkspaceDependencies", () => {
  it("seeds Editorial Demo, opens it deterministically, and clones returned state", async () => {
    const dependencies = createBrowserWorkspaceDependencies();

    const loadedProjects = await dependencies.service.loadProjects();

    expect(loadedProjects).toEqual([
      expect.objectContaining({
        projectId: "editorial-demo",
        path: EDITORIAL_DEMO_PATH,
        name: "Editorial Demo",
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

    expect(openedProject.name).toBe("Editorial Demo");
    expect(openedProject.coverDataUrl).toBeNull();
    expect(reloadedProjects[0].name).toBe("Editorial Demo");
    expect(reloadedProjects[0].coverDataUrl).toBeNull();
  });
});
