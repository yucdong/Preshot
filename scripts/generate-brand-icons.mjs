import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const staging = resolve(root, ".preshot-build-cache/brand-icons");
const destination = resolve(root, "src-tauri/icons");

mkdirSync(staging, { recursive: true });
const generated = spawnSync(process.execPath, [
  resolve(root, "node_modules/@tauri-apps/cli/tauri.js"),
  "icon",
  resolve(root, "public/preshot-mark.svg"),
  "--output",
  staging,
], { cwd: root, stdio: "inherit" });

if (generated.error) throw generated.error;
if (generated.status !== 0) {
  throw new Error(`Brand icon generation failed (${generated.status ?? generated.signal}).`);
}

// Desktop assets only. Tauri's generated mobile directories stay in the cache.
const files = readdirSync(staging, { withFileTypes: true }).filter((file) =>
  file.isFile() && [".png", ".ico", ".icns"].includes(extname(file.name)));
mkdirSync(destination, { recursive: true });
for (const file of files) {
  copyFileSync(resolve(staging, file.name), resolve(destination, file.name));
}
console.log(`Updated ${files.length} desktop icons from public/preshot-mark.svg.`);
