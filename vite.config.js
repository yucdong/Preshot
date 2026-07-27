import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
var host = process.env.TAURI_DEV_HOST;
export default defineConfig({
    plugins: [react(), tailwindcss()],
    clearScreen: false,
    server: {
        host: host || false,
        port: 1420,
        strictPort: true,
        hmr: host
            ? {
                protocol: "ws",
                host: host,
                port: 1421,
            }
            : undefined,
        watch: {
            ignored: ["**/src-tauri/**"],
        },
    },
    test: {
        environment: "jsdom",
        setupFiles: ["./src/shared/testing/setup.ts"],
        css: true,
    },
});
