import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { save } from "@tauri-apps/plugin-dialog";
import {
  isPathSafeLongImageFileName,
  isSafeLongImageBaseName,
  isFormatExtension,
  validateLongImageSaveRequest,
  type LongImageSaveRequest,
  type LongImageSaveTarget,
} from "../../domain/plan/longImageSave";
import { normalizeWindowsShellPath } from "../../shared/path/windowsShellPath";
import { bytesToBase64 } from "../pdf/base64";

type SaveDialog = (options: {
  defaultPath: string;
  filters: { name: string; extensions: string[] }[];
}) => Promise<string | null>;

type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
type JoinPath = (directory: string, name: string) => Promise<string>;

interface Dependencies {
  saveDialog?: SaveDialog;
  invokeCommand?: InvokeCommand;
  joinPath?: JoinPath;
  encodeBase64?: typeof bytesToBase64;
}

interface SplitPath {
  parent: string;
  separator: "/" | "\\";
  stem: string;
  extension: string;
}

export function createTauriLongImageSaveTarget({
  saveDialog = save as unknown as SaveDialog,
  invokeCommand = invoke,
  joinPath = join,
  encodeBase64 = bytesToBase64,
}: Dependencies = {}): LongImageSaveTarget {
  return {
    revealProjectDirectoryAfterSave: true,
    async save(request) {
      const expectedExtension = validateLongImageSaveRequest(request);
      const defaultPath = await joinPath(
        normalizeWindowsShellPath(request.defaultDirectory),
        request.parts[0]!.fileName,
      );
      const path = await saveDialog({
        defaultPath,
        filters: [
          request.format === "png"
            ? { name: "PNG", extensions: ["png"] }
            : { name: "JPEG", extensions: ["jpg", "jpeg"] },
        ],
      });
      if (path === null) {
        return null;
      }

      const normalizedPath = normalizeWindowsShellPath(path);
      const targets = deriveTargetPaths(
        normalizedPath,
        request,
        expectedExtension,
      );
      let result: unknown;
      try {
        result = await invokeCommand("save_long_images", {
          format: request.format,
          parts: request.parts.map((part, index) => ({
            path: targets[index],
            contentsBase64: encodeBase64(part.bytes),
          })),
        });
      } catch (error) {
        throw new Error(
          `Unable to save the long image: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error },
        );
      }

      if (
        !Array.isArray(result) ||
        result.length !== targets.length ||
        !result.every(
          (value, index) =>
            typeof value === "string" &&
            normalizeWindowsShellPath(value) === targets[index],
        )
      ) {
        throw new Error(
          "Unable to save the long image: the native save result was invalid.",
        );
      }
      return result.map(normalizeWindowsShellPath);
    },
  };
}

function deriveTargetPaths(
  selectedPath: string,
  request: LongImageSaveRequest,
  expectedExtension: string,
): string[] {
  const selected = splitPath(selectedPath);
  if (
    !isFormatExtension(request.format, selected.extension) ||
    !isFormatExtension(request.format, expectedExtension)
  ) {
    throw new Error(
      `The selected long-image path must use a ${
        request.format === "png" ? ".png" : ".jpg or .jpeg"
      } extension.`,
    );
  }
  if (request.parts.length === 1) {
    validateSelectedBaseName(selected.stem);
    validateSelectedFileName(selectedPath);
    return [selectedPath];
  }

  const width = Math.max(2, String(request.parts.length).length);
  const firstSuffix = `-${String(1).padStart(width, "0")}`;
  const outputBase = selected.stem.endsWith(firstSuffix)
    ? selected.stem.slice(0, -firstSuffix.length)
    : selected.stem;
  validateSelectedBaseName(outputBase);

  const targets = request.parts.map(
    (_, index) =>
      `${selected.parent}${selected.separator}${outputBase}-${String(
        index + 1,
      ).padStart(width, "0")}.${selected.extension}`,
  );
  targets.forEach(validateSelectedFileName);
  return targets;
}

function validateSelectedBaseName(baseName: string): void {
  if (!isSafeLongImageBaseName(baseName)) {
    throw new Error(
      "The selected long-image path has no usable Windows-safe base name.",
    );
  }
}

function validateSelectedFileName(path: string): void {
  const fileName = path.slice(Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")) + 1);
  if (!isPathSafeLongImageFileName(fileName)) {
    throw new Error(
      "The selected long-image filename exceeds the Windows component limit.",
    );
  }
}

function splitPath(path: string): SplitPath {
  if (path.split(/[\\/]/).some((segment) => segment === "." || segment === "..")) {
    throw new Error(
      "The selected long-image path must not contain traversal segments.",
    );
  }
  const slashIndex = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  if (slashIndex <= 0 || slashIndex === path.length - 1) {
    throw new Error("The selected long-image path must include a directory.");
  }
  const fileName = path.slice(slashIndex + 1);
  const extensionIndex = fileName.lastIndexOf(".");
  if (extensionIndex <= 0 || extensionIndex === fileName.length - 1) {
    throw new Error("The selected long-image path must include an extension.");
  }
  return {
    parent: path.slice(0, slashIndex),
    separator: path[slashIndex] as "/" | "\\",
    stem: fileName.slice(0, extensionIndex),
    extension: fileName.slice(extensionIndex + 1),
  };
}

export const tauriLongImageSaveTarget = createTauriLongImageSaveTarget();
