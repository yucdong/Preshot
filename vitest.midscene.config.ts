import "dotenv/config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["e2e-midscene/**/*.test.ts"],
    testTimeout: 900_000,
    hookTimeout: 120_000,
    maxWorkers: 1,
    fileParallelism: false,
    sequence: { concurrent: false },
    reporters: ["./e2e-midscene/context/reporter.ts"],
  },
  ssr: {
    external: ["@silvia-odwyer/photon"],
  },
});
