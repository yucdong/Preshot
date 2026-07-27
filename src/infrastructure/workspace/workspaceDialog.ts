import { open } from "@tauri-apps/plugin-dialog";
import type { WorkspaceDirectoryPicker } from "../../domain/workspace/ports";

type OpenDialog = (options: {
  title: string;
  directory: true;
  multiple: false;
}) => Promise<string | string[] | null>;

interface Dependencies {
  openDialog?: OpenDialog;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function detail(error: unknown): string {
  if (isObjectRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  return error instanceof Error ? error.message : String(error);
}

export function createWorkspaceDirectoryPicker({
  openDialog = open,
}: Dependencies = {}): WorkspaceDirectoryPicker {
  return {
    async pickDirectory(title: string): Promise<string | null> {
      let selected: string | string[] | null;

      try {
        selected = await openDialog({
          title,
          directory: true,
          multiple: false,
        });
      } catch (error) {
        throw new Error(`Unable to select workspace directory: ${detail(error)}`, {
          cause: error,
        });
      }

      if (typeof selected === "string") {
        return selected;
      }

      if (selected === null) {
        return null;
      }

      throw new Error(
        "Unable to select workspace directory: Unexpected dialog response",
      );
    },
  };
}

export const workspaceDirectoryPicker = createWorkspaceDirectoryPicker();
