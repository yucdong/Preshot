import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import type {
  DirectoryPickerOptions,
  WorkspaceDirectoryPicker,
} from "../../domain/workspace/ports";

type OpenDialog = (options: {
  title: string;
  directory: true;
  multiple: false;
  defaultPath?: string;
}) => Promise<string | string[] | null>;

type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

interface Dependencies {
  openDialog?: OpenDialog;
  invokeCommand?: InvokeCommand;
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
  invokeCommand = invoke,
}: Dependencies = {}): WorkspaceDirectoryPicker {
  return {
    async pickDirectory(
      title: string,
      options?: DirectoryPickerOptions,
    ): Promise<string | null> {
      let defaultPath: string | undefined;

      if (options?.defaultToProjectsDir) {
        try {
          const resolved = await invokeCommand("default_projects_dir");
          if (typeof resolved === "string" && resolved.length > 0) {
            defaultPath = resolved;
          }
        } catch {
          defaultPath = undefined;
        }
      }

      let selected: string | string[] | null;

      try {
        selected = await openDialog({
          title,
          directory: true,
          multiple: false,
          ...(defaultPath === undefined ? {} : { defaultPath }),
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
