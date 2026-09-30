export interface StorageInfo {
  configurationDirectory: string;
  existingWorkingDirectory: string | null;
  applicationDirectory: string;
  libraryDirectory: string;
  needsSetup: boolean;
  pendingMove: boolean;
  problem: string | null;
  generation: number;
}

export interface StorageRepository {
  status(): Promise<StorageInfo>;
  configure(path: string, confirmSwitch?: boolean): Promise<StorageInfo>;
  move(path: string | null): Promise<StorageInfo>;
  cancelMove(): Promise<StorageInfo>;
  reveal(kind: "configuration" | "application" | "library"): Promise<void>;
  pickDirectory(current: string): Promise<string | null>;
}
