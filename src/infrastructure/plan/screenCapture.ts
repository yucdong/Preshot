import { captureScreenImage } from "./captureScreenImage";
import { invoke } from "@tauri-apps/api/core";
import type {
  ScreenCapture,
  ScreenCapturePollResult,
} from "../../domain/plan/ports";

type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

interface Dependencies {
  invokeCommand?: InvokeCommand;
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireToken(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Malformed native response");
  }
  return value;
}

function requirePollResult(value: unknown): ScreenCapturePollResult {
  if (typeof value !== "object" || value === null || !("status" in value)) {
    throw new Error("Malformed native response");
  }
  if (value.status === "pending") {
    return { status: "pending" };
  }
  if (value.status === "cancelled") return { status: "cancelled" };
  if (
    value.status === "captured" &&
    "path" in value &&
    typeof value.path === "string" &&
    value.path.length > 0
  ) {
    return { status: "captured", path: value.path };
  }
  throw new Error("Malformed native response");
}

export function createTauriScreenCapture({
  invokeCommand = invoke,
}: Dependencies = {}): ScreenCapture {
  const capture: ScreenCapture = {
    async captureMedia(projectPath, cancellation) {
      return captureScreenImage(capture, cancellation, async (path) => {
        try {
          const result = await invokeCommand("import_screen_capture_media", { projectPath, path });
          if (typeof result !== "object" || result === null ||
            !("file" in result) || typeof result.file !== "string" || !/^media\/[a-zA-Z0-9_-]+\.png$/.test(result.file) ||
            !("dataUrl" in result) || typeof result.dataUrl !== "string" || !result.dataUrl.startsWith("data:image/png;base64,") ||
            !("name" in result) || typeof result.name !== "string" ||
            !("mimeType" in result) || result.mimeType !== "image/png") {
            throw new Error("Malformed native response");
          }
          return { file: result.file, dataUrl: result.dataUrl, name: result.name, mimeType: result.mimeType };
        } catch (cause) {
          throw new Error(`无法保存截图到项目：${detail(cause)}`, { cause });
        }
      });
    },
    async start() {
      try {
        return requireToken(await invokeCommand("start_screen_capture"));
      } catch (error) {
        throw new Error(`Unable to start the screen capture: ${detail(error)}`, {
          cause: error,
        });
      }
    },
    async poll(token) {
      try {
        return requirePollResult(
          await invokeCommand("poll_screen_capture", { token }),
        );
      } catch (error) {
        throw new Error(`Unable to poll the screen capture: ${detail(error)}`, {
          cause: error,
        });
      }
    },
    async cancel(token) {
      try {
        await invokeCommand("cancel_screen_capture", { token });
      } catch (error) {
        throw new Error(`Unable to cancel the screen capture: ${detail(error)}`, {
          cause: error,
        });
      }
    },
    async discard(path) {
      try {
        await invokeCommand("discard_screen_capture", { path });
      } catch (error) {
        throw new Error(`Unable to discard the screen capture: ${detail(error)}`, {
          cause: error,
        });
      }
    },
  };
  return capture;
}

export const tauriScreenCapture = createTauriScreenCapture();
