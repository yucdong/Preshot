import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "agent-render-diagnostic.spec.ts",
  fullyParallel: false,
  timeout: 90_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:1426",
    trace: "off",
  },
  projects: [{
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      channel: "msedge",
    },
  }],
  webServer: {
    command: "pnpm dev --mode e2e --host 127.0.0.1 --port 1426",
    url: "http://127.0.0.1:1426",
    reuseExistingServer: false,
  },
});
