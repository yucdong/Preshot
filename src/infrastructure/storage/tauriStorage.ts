import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { StorageRepository } from "../../domain/storage/ports";

export const tauriStorage: StorageRepository = {
  status: () => invoke("storage_status"),
  configure: (path, confirmSwitch = false) => invoke("storage_configure", { path, confirmSwitch }),
  move: (path) => invoke("storage_move", { path }),
  cancelMove: () => invoke("storage_cancel_move"),
  reveal: (kind) => invoke("storage_reveal", { kind }),
  async pickDirectory(current) {
    const result = await open({ directory: true, multiple: false, defaultPath: current });
    return typeof result === "string" ? result : null;
  },
};

export function createStorageRepository(): StorageRepository | null {
  return isTauri() && import.meta.env.MODE !== "test"
    && !["memory", "midscene"].includes(import.meta.env.VITE_WORKSPACE_ADAPTER ?? "")
    ? tauriStorage : null;
}
