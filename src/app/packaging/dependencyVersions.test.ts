import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const blockNotePackages = [
  "@blocknote/core",
  "@blocknote/mantine",
  "@blocknote/react",
  "@blocknote/xl-docx-exporter",
  "@blocknote/xl-multi-column",
  "@blocknote/xl-pdf-exporter",
] as const;

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function readPackage(path: string): {
  version?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
} {
  return JSON.parse(read(path)) as {
    version?: string;
    dependencies?: Record<string, string>;
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

describe("export dependency versions", () => {
  it("keeps BlockNote, React-PDF, and DOCX pinned to approved versions", () => {
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
    expect(packageJson.dependencies?.docx).toBe("9.6.1");
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
    expect(new Set(lockVersions(lockfile, "docx"))).toEqual(
      new Set(["9.6.1"]),
    );

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
    const docxExporter = readPackage(
      "node_modules/@blocknote/xl-docx-exporter/package.json",
    );
    const renderer = readPackage(
      "node_modules/@react-pdf/renderer/package.json",
    );

    expect(exporter.version).toBe("0.53.0");
    expect(exporter.peerDependencies?.react).toContain("^19.0");
    expect(exporter.peerDependencies?.["react-dom"]).toContain("^19.0");
    expect(docxExporter.version).toBe("0.53.0");
    expect(docxExporter.peerDependencies?.react).toContain("^19.0");
    expect(docxExporter.peerDependencies?.["react-dom"]).toContain("^19.0");
    expect(renderer.version).toBe("4.3.0");
    expect(renderer.peerDependencies?.react).toContain("^19.0.0");
  });

  it("uses exporter-supplied browser polyfills without app-wide globals", () => {
    const packageJson = readPackage("package.json");
    const exporter = readPackage(
      "node_modules/@blocknote/xl-docx-exporter/package.json",
    );
    const exporterBundle = read(
      "node_modules/@blocknote/xl-docx-exporter/dist/blocknote-xl-docx-exporter.js",
    );
    const docxBundle = read("node_modules/docx/dist/index.mjs");

    expect(exporter.dependencies?.buffer).toBe("^6.0.3");
    expect(exporter.dependencies?.docx).toBe("^9.6.1");
    expect(exporterBundle).toContain('await import("buffer")');
    expect(docxBundle).toContain("process.browser = true");
    expect(docxBundle).toContain("function requireBuffer()");
    expect(packageJson.dependencies?.buffer).toBeUndefined();
    expect(read("vite.config.ts")).not.toContain("globalThis.Buffer");
  });
});
