import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

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

export async function maximizeCurrentWindow(): Promise<void> {
  try {
    await getCurrentWindow().maximize();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to maximize the desktop window: ${detail}`, {
      cause: error,
    });
  }
}
