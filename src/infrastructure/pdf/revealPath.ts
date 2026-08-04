import { invoke } from "@tauri-apps/api/core";

export interface PdfRevealTarget {
  reveal(path: string): Promise<void>;
}

type InvokeCommand = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

interface Dependencies {
  invokeCommand?: InvokeCommand;
}

export function createTauriRevealTarget({
  invokeCommand = invoke,
}: Dependencies = {}): PdfRevealTarget {
  return {
    async reveal(path) {
      try {
        await invokeCommand("reveal_path", { path });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Unable to reveal the file: ${message}`, {
          cause: error,
        });
      }
    },
  };
}

export const tauriRevealTarget = createTauriRevealTarget();
