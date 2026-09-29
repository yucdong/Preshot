import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PRESHOT_BLOCK_TYPES, validateProjectPlanV15, type PreshotBlock } from "../plan/canvas/blockDocument";

const root = resolve("samples/nanjing-bridge");
const manifest = JSON.parse(readFileSync(resolve(root, ".preshotproj"), "utf8"));
describe("bundled Nanjing bridge project", () => {
  it("covers every supported block with a valid current plan and offline owned files", () => {
    const plan = validateProjectPlanV15(manifest.plan);
    const flatten = (blocks: PreshotBlock[]): PreshotBlock[] => blocks.flatMap(block => [block, ...flatten(block.children)]);
    const blocks = flatten(plan.document.blocks);
    expect([...new Set(blocks.map(block => block.type))].sort()).toEqual([...PRESHOT_BLOCK_TYPES].sort());
    const paths = new Set<string>();
    const collect = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        if ((key === "file" || key === "url") && typeof child === "string") paths.add(child);
        else collect(child);
      }
    };
    collect(plan);
    expect(paths.size).toBeGreaterThanOrEqual(11);
    for (const path of paths) {
      expect(path).toMatch(/^(references|media)\/[a-z0-9.-]+$/);
      expect(existsSync(resolve(root, path)), path).toBe(true);
      expect(readFileSync(resolve(root, path)).byteLength).toBeGreaterThan(20);
    }
    expect(existsSync(resolve(root, manifest.coverImage))).toBe(true);
    expect(readFileSync(resolve(root, "CREDITS.md"), "utf8")).toContain("CC BY-SA 4.0");
  });
});
