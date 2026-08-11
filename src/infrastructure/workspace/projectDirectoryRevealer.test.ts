import { describe, expect, it, vi } from "vitest";
import { createProjectDirectoryRevealer } from "./projectDirectoryRevealer";

describe("projectDirectoryRevealer", () => {
  it("opens the project directory through the narrow native command", async () => {
    const invokeCommand = vi.fn().mockResolvedValue(undefined);
    const revealer = createProjectDirectoryRevealer(invokeCommand);

    await revealer.revealProjectDirectory("C:\\shoots\\Editorial");

    expect(invokeCommand).toHaveBeenCalledWith("open_project_directory", {
      path: "C:\\shoots\\Editorial",
    });
  });
});
