import { describe, expect, it } from "vitest";
import { createEmptyProject } from "./models";

describe("createEmptyProject", () => {
  it("creates a project with one empty board", () => {
    const project = createEmptyProject("project-1", "Editorial shoot");

    expect(project).toEqual({
      id: "project-1",
      name: "Editorial shoot",
      boards: [
        {
          id: "project-1-board-1",
          name: "Main board",
          assets: [],
          textBlocks: [],
        },
      ],
    });
  });
});
