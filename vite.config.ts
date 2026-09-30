import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  optimizeDeps: {
    entries: ["index.html", "e2e/fixtures/*.html"],
  },
  server: {
    host: host || false,
    port: 1420,
    strictPort: true,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Trace HTML and WebView capture profiles are generated output, not app edits.
      ignored: [
        "**/src-tauri/**",
        "**/.docs-check-*/**",
        "**/.production-tools-*/**",
        "**/.preshot-build-cache/**",
        "**/test-results/**",
        "**/playwright-report/**",
        "**/midscene_run/**",
      ],
    },
  },
  test: {
    // Editor/exporter suites load large module graphs; bound memory and CPU contention.
    maxWorkers: 4,
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/shared/testing/setup.ts"],
    css: true,
  },
});
