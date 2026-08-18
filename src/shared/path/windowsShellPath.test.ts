import { describe, expect, it } from "vitest";
import { normalizeWindowsShellPath } from "./windowsShellPath";

describe("normalizeWindowsShellPath", () => {
  it.each([
    ["C:\\Editorial", "C:\\Editorial"],
    ["C:\\Client Shoots\\夏季 编辑\\", "C:\\Client Shoots\\夏季 编辑\\"],
    ["\\\\?\\C:\\Editorial", "C:\\Editorial"],
    ["\\\\?\\C:\\Client Shoots\\夏季 编辑\\", "C:\\Client Shoots\\夏季 编辑\\"],
    ["\\\\server\\share\\Editorial", "\\\\server\\share\\Editorial"],
    ["\\\\server\\share\\夏季 编辑\\", "\\\\server\\share\\夏季 编辑\\"],
    ["\\\\?\\UNC\\server\\share\\Editorial", "\\\\server\\share\\Editorial"],
    ["\\\\?\\unc\\server\\share\\Editorial", "\\\\server\\share\\Editorial"],
    ["\\\\?\\UNC\\server\\share\\夏季 编辑\\", "\\\\server\\share\\夏季 编辑\\"],
  ])("normalizes %s", (path, expected) => {
    expect(normalizeWindowsShellPath(path)).toBe(expected);
  });
});
