import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { PdfSaveTarget } from "../../domain/plan/pdf/ports";
import { bytesToBase64 } from "./base64";

type SaveDialog = (options: {
  defaultPath: string;
  filters: { name: string; extensions: string[] }[];
}) => Promise<string | null>;

type InvokeCommand = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

interface Dependencies {
  saveDialog?: SaveDialog;
  invokeCommand?: InvokeCommand;
}

export function createTauriPdfSaveTarget({
  saveDialog = save as unknown as SaveDialog,
  invokeCommand = invoke,
}: Dependencies = {}): PdfSaveTarget {
  return {
    async save(bytes, suggestedName) {
      const path = await saveDialog({
        defaultPath: suggestedName,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });

      if (path === null) {
        return false;
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

      return true;
    },
  };
}

export const tauriPdfSaveTarget = createTauriPdfSaveTarget();
