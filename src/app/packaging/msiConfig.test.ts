import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const conf = JSON.parse(
  readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"),
) as {
  bundle?: {
    targets?: unknown;
    windows?: { wix?: { language?: unknown; fragmentPaths?: unknown; componentGroupRefs?: unknown } };
  };
};
const wxs = readFileSync(resolve(root, "src-tauri/wix/shortcuts.wxs"), "utf8");

describe("MSI bundle configuration", () => {
  it("targets the msi bundle", () => {
    expect(conf.bundle?.targets).toEqual(["msi"]);
  });

  it("configures the WiX installer for en-US with the shortcuts fragment", () => {
    const wix = conf.bundle?.windows?.wix;
    expect(wix?.language).toContain("en-US");
    expect(wix?.fragmentPaths).toContain("./wix/shortcuts.wxs");
    expect(wix?.componentGroupRefs).toContain("DesktopShortcuts");
  });

  it("ships a well-formed fragment whose ComponentGroup matches componentGroupRefs", () => {
    const doc = new DOMParser().parseFromString(wxs, "application/xml");
    expect(doc.querySelector("parsererror")).toBeNull();

    const group = doc.querySelector('ComponentGroup[Id="DesktopShortcuts"]');
    expect(group).not.toBeNull();

    const componentRef = group?.querySelector('ComponentRef[Id="ApplicationShortcutDesktop"]');
    expect(componentRef).not.toBeNull();

    const shortcut = doc.querySelector('Shortcut[Id="DesktopShortcut"]');
    expect(shortcut?.getAttribute("Target")).toBe("[INSTALLDIR]Preshot.exe");
    // The Desktop shortcut is created under the standard DesktopFolder.
    expect(doc.querySelector('DirectoryRef[Id="DesktopFolder"]')).not.toBeNull();
  });
});
