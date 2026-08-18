import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const blockNotePackages = [
  "@blocknote/core",
  "@blocknote/mantine",
  "@blocknote/react",
  "@blocknote/xl-multi-column",
  "@blocknote/xl-pdf-exporter",
] as const;

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function readPackage(path: string): {
  version?: string;
  peerDependencies?: Record<string, string>;
} {
  return JSON.parse(read(path)) as {
    version?: string;
    peerDependencies?: Record<string, string>;
  };
}

function lockVersions(lockfile: string, packageName: string): string[] {
  const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    ...lockfile.matchAll(
      new RegExp(`^  ['"]?${escapedName}@([^:'"(]+)`, "gm"),
    ),
  ].map((match) => match[1]);
}

describe("PDF export dependency versions", () => {
  it("keeps BlockNote and React-PDF pinned to the approved versions", () => {
    const packageJson = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
    };

    expect(
      Object.fromEntries(
        blockNotePackages.map((name) => [
          name,
          packageJson.dependencies?.[name],
        ]),
      ),
    ).toEqual(
      Object.fromEntries(blockNotePackages.map((name) => [name, "0.53.0"])),
    );
    expect(packageJson.dependencies?.["@react-pdf/renderer"]).toBe("4.3.0");
  });

  it("resolves one compatible version of each gated package", () => {
    const lockfile = read("pnpm-lock.yaml");

    for (const packageName of blockNotePackages) {
      expect(new Set(lockVersions(lockfile, packageName))).toEqual(
        new Set(["0.53.0"]),
      );
    }
    expect(
      new Set(lockVersions(lockfile, "@react-pdf/renderer")),
    ).toEqual(new Set(["4.3.0"]));

    for (const packageName of ["react", "react-dom"]) {
      const versions = new Set(lockVersions(lockfile, packageName));
      expect(versions.size).toBe(1);
      expect([...versions][0]).toMatch(/^19\./);
    }
  });

  it("supports the repository React 19 line", () => {
    const exporter = readPackage(
      "node_modules/@blocknote/xl-pdf-exporter/package.json",
    );
    const renderer = readPackage(
      "node_modules/@react-pdf/renderer/package.json",
    );

    expect(exporter.version).toBe("0.53.0");
    expect(exporter.peerDependencies?.react).toContain("^19.0");
    expect(exporter.peerDependencies?.["react-dom"]).toContain("^19.0");
    expect(renderer.version).toBe("4.3.0");
    expect(renderer.peerDependencies?.react).toContain("^19.0.0");
  });
});
