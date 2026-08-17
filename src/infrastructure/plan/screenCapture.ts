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
  return {
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
}

export const tauriScreenCapture = createTauriScreenCapture();
