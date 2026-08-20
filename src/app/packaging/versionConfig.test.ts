import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function firstMatch(source: string, pattern: RegExp, context: string): string {
  const match = pattern.exec(source);
  if (!match) throw new Error(`Unable to read ${context} version`);
  return match[1];
}

describe("release version configuration", () => {
  it("keeps JavaScript, Tauri, Rust, and Cargo lock versions synchronized", () => {
    const packageJson = JSON.parse(read("package.json")) as {
      version?: string;
    };
    const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json")) as {
      version?: string;
    };
    const cargoVersion = firstMatch(
      read("src-tauri/Cargo.toml"),
      /^\[package\][\s\S]*?^version = "([^"]+)"/m,
      "Cargo.toml",
    );
    const cargoLockVersion = firstMatch(
      read("src-tauri/Cargo.lock"),
      /\[\[package\]\]\s+name = "preshot"\s+version = "([^"]+)"/m,
      "Cargo.lock",
    );

    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(tauriConfig.version).toBe(packageJson.version);
    expect(cargoVersion).toBe(packageJson.version);
    expect(cargoLockVersion).toBe(packageJson.version);
  });
});
