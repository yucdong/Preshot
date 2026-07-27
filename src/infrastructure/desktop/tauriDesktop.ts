import { invoke } from "@tauri-apps/api/core";

export interface DesktopPlatform {
  os: string;
}

export async function getDesktopPlatform(): Promise<DesktopPlatform> {
  try {
    return await invoke<DesktopPlatform>("platform_info");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read desktop platform: ${detail}`, {
      cause: error,
    });
  }
}
