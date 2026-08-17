import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  timeout: 90_000,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:1420",
    navigationTimeout: 60_000,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: "msedge",
      },
    },
  ],
  webServer: {
    command: "pnpm dev --mode e2e --host 127.0.0.1",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: !process.env.CI,
  },
});
