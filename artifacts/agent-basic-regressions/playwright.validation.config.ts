import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "responsive-accessibility.spec.ts",
  fullyParallel: false,
  timeout: 90_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:1425",
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
    command: "pnpm dev --mode e2e --host 127.0.0.1 --port 1425",
    url: "http://127.0.0.1:1425",
    reuseExistingServer: false,
  },
});
