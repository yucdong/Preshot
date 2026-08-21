// @vitest-environment node

import { resolve } from "node:path";
import { build, type Rollup } from "vite";
import { describe, expect, it } from "vitest";

function outputFiles(
  result: Rollup.RollupOutput | Rollup.RollupOutput[],
): Array<Rollup.OutputAsset | Rollup.OutputChunk> {
  const outputs = Array.isArray(result) ? result : [result];
  return outputs.flatMap((output) => output.output);
}

describe("DOM capture browser bundle", () => {
  it("emits the modern-screenshot worker as a same-origin asset", async () => {
    const root = process.cwd();
    const result = await build({
      configFile: false,
      root,
      publicDir: false,
      logLevel: "silent",
      build: {
        write: false,
        rollupOptions: {
          input: resolve(root, "e2e/fixtures/long-image-capture.html"),
        },
      },
    });
    if (!Array.isArray(result) && "on" in result) {
      throw new Error("Expected a completed Vite build");
    }
    const files = outputFiles(result);
    const JavaScript = files
      .filter((file): file is Rollup.OutputChunk => file.type === "chunk")
      .map((file) => file.code)
      .join("\n");
    const worker = files.find(
      (file): file is Rollup.OutputAsset =>
        file.type === "asset" &&
        file.fileName.endsWith(".js") &&
        String(file.source).includes("[modern-screenshot]"),
    );

    expect(worker).toBeDefined();
    expect(JavaScript).toContain(worker?.fileName ?? "missing-worker");
    expect(JavaScript).not.toContain("data:text/javascript");
    expect(JavaScript).not.toMatch(
      /(?:from\s+["']node:|require\(|\bprocess\.|\bBuffer\b|\bglobal\.)/,
    );
  });
});
