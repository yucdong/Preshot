import { invoke, isTauri } from "@tauri-apps/api/core";
import { unavailableImageClipboard, type ImageClipboardPort } from "../../domain/clipboard/imageClipboard";
import { validateClipboardContents, validateClipboardInput } from "./validation";

type InvokeCommand = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export function createPlatformImageClipboard(): ImageClipboardPort {
  return isTauri() ? createTauriImageClipboard() : unavailableImageClipboard;
}

export function createTauriImageClipboard(
  { invokeCommand = invoke }: { invokeCommand?: InvokeCommand } = {},
): ImageClipboardPort {
  async function call(command: string, args?: Record<string, unknown>) {
    try {
      return await (args === undefined ? invokeCommand(command) : invokeCommand(command, args));
    } catch (error) {
      const message = error && typeof error === "object" && "message" in error
        ? error.message : error;
      throw new Error(typeof message === "string" && /[\u3400-\u9fff]/.test(message)
        ? message : "无法访问系统图片剪贴板，请关闭正在占用剪贴板的应用后重试。");
    }
  }
  return {
    availability: "desktop",
    async write(image) {
      await call("image_clipboard_write", { image: validateClipboardInput(image) });
    },
    async read() {
      return validateClipboardContents(await call("image_clipboard_read"));
    },
    async hasImage() {
      const result = await call("image_clipboard_has_image");
      if (typeof result !== "boolean") throw new Error("图片剪贴板返回了无效状态，请重试。");
      return result;
    },
  };
}
