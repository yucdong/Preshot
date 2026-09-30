import { createContext, useContext } from "react";
import type { StorageInfo, StorageRepository } from "../../domain/storage/ports";

export interface StorageController {
  info: StorageInfo | null;
  busy: boolean;
  error: string | null;
  moved: boolean;
  refresh(): Promise<void>;
  configure(path: string, confirmSwitch?: boolean): Promise<void>;
  move(path: string | null): Promise<void>;
  cancelMove(): Promise<void>;
  reveal(kind: Parameters<StorageRepository["reveal"]>[0]): Promise<void>;
  pickDirectory(current: string): Promise<string | null>;
}
export const StorageContext = createContext<StorageController | null>(null);
export const useStorage = () => useContext(StorageContext);
