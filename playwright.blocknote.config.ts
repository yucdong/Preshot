import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "blocknote-v14.spec.ts",
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:1430",
    trace: "on-first-retry",
  },
  projects: [{
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      channel: "msedge",
    },
  }],
  webServer: {
    command: "pnpm dev --mode e2e --host 127.0.0.1 --port 1430",
    url: "http://127.0.0.1:1430",
    reuseExistingServer: !process.env.CI,
  },
});
