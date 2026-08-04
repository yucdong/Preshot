import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const conf = JSON.parse(
  readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"),
) as {
  bundle?: {
    targets?: unknown;
    publisher?: unknown;
    windows?: { wix?: { language?: unknown } };
  };
};

describe("MSI bundle configuration", () => {
  it("targets the msi bundle", () => {
    expect(conf.bundle?.targets).toEqual(["msi"]);
  });

  it("sets a publisher for the installer metadata", () => {
    expect(conf.bundle?.publisher).toBe("yucdong");
  });

  it("builds the WiX installer in en-US", () => {
    expect(conf.bundle?.windows?.wix?.language).toContain("en-US");
  });
});
