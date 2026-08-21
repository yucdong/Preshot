import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "long-image-capture.spec.ts",
  fullyParallel: false,
  timeout: 90_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:1440",
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
    command: "pnpm dev --mode e2e --host 127.0.0.1 --port 1440",
    url: "http://127.0.0.1:1440/e2e/fixtures/long-image-capture.html",
    reuseExistingServer: !process.env.CI,
  },
});
