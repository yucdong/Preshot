import { invoke } from "@tauri-apps/api/core";
import type { ProjectDirectoryRevealer } from "../../domain/workspace/ports";

type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

export function createProjectDirectoryRevealer(
  invokeCommand: InvokeCommand = invoke,
): ProjectDirectoryRevealer {
  return {
    async revealProjectDirectory(path: string): Promise<void> {
      try {
        await invokeCommand("open_project_directory", { path });
      } catch (error) {
        throw new Error(
          `Unable to open the project directory: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    },
  };
}

export const projectDirectoryRevealer = createProjectDirectoryRevealer();