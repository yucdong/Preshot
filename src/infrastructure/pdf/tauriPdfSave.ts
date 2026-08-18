import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { save } from "@tauri-apps/plugin-dialog";
import type { PdfSaveTarget } from "../../domain/plan/canvas/ports";
import { normalizeWindowsShellPath } from "../../shared/path/windowsShellPath";
import { bytesToBase64 } from "./base64";

type SaveDialog = (options: {
  defaultPath: string;
  filters: { name: string; extensions: string[] }[];
}) => Promise<string | null>;

type InvokeCommand = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
type JoinPath = (directory: string, name: string) => Promise<string>;

interface Dependencies {
  saveDialog?: SaveDialog;
  invokeCommand?: InvokeCommand;
  joinPath?: JoinPath;
}

export function createTauriPdfSaveTarget({
  saveDialog = save as unknown as SaveDialog,
  invokeCommand = invoke,
  joinPath = join,
}: Dependencies = {}): PdfSaveTarget {
  return {
    revealProjectDirectoryAfterSave: true,
    async save(bytes, { suggestedName, defaultDirectory }) {
      const defaultPath = await joinPath(
        normalizeWindowsShellPath(defaultDirectory),
        suggestedName,
      );
      const path = await saveDialog({
        defaultPath,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });

      if (path === null) {
        return null;
      }

      try {
        await invokeCommand("save_pdf", {
          path,
          contentsBase64: bytesToBase64(bytes),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Unable to save the PDF: ${message}`, {
          cause: error,
        });
      }

      return path;
    },
  };
}

export const tauriPdfSaveTarget = createTauriPdfSaveTarget();
