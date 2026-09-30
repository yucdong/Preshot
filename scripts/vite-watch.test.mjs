import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build, createServer, normalizePath } from "vite";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function until(predicate, message) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, message);
    await delay(25);
  }
}

test("generated HTML and capture profiles never reach Vite's watcher, while source changes do", async () => {
  const root = await mkdtemp(join(tmpdir(), "preshot-vite-watch-"));
  const generated = [
    ".preshot-build-cache/e2e/.playwright-artifacts/traces/resources/page.html",
    ".preshot-build-cache/recording/webview/profile/Preferences",
    "test-results/journey/report.html",
    "playwright-report/index.html",
    "midscene_run/report/journey.html",
    "tests/.production-tools-fixture/project/package.json",
  ];
  const source = join(root, "src", "main.ts");
  let server;
  try {
    for (const path of [source, ...generated.map(path => join(root, path))]) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "initial");
    }
    server = await createServer({
      configFile: join(repository, "vite.config.ts"),
      root,
      logLevel: "silent",
      appType: "custom",
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { middlewareMode: true, hmr: false },
    });
    await until(
      () => Object.keys(server.watcher.getWatched()).some(path => normalizePath(path) === normalizePath(dirname(source))),
      "Vite did not start watching the source directory",
    );
    await delay(400);
    const changed = new Set();
    server.watcher.on("all", (_event, path) => changed.add(normalizePath(path)));
    for (const path of generated) await writeFile(join(root, path), "generated output");
    await writeFile(source, "export const edited = true;");
    await until(() => changed.has(normalizePath(source)), "Vite stopped watching real source edits");
    await delay(400);
    const unexpected = generated.filter(path => changed.has(normalizePath(join(root, path))));
    assert.deepEqual(unexpected, [], "Generated output reached the Vite watcher");
  } finally {
    await server?.close();
    // mkdtemp owns this exact disposable root; never remove the real workspace.
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("preshot-vite-watch-"));
    await rm(root, { recursive: true, force: true });
  }
});

test("Tailwind scans application and browser-fixture classes without reading generated release fixtures", async () => {
  const root = await mkdtemp(join(tmpdir(), "preshot-vite-watch-"));
  try {
    const styles = await readFile(join(repository, "src", "styles.css"), "utf8");
    const directives = styles.split(/\r?\n/).filter(line => /^@import "tailwindcss"|^@source /.test(line)).join("\n");
    const files = {
      "src/styles.css": directives,
      "src/app/probe.tsx": '<div className="w-[133px]" />',
      "e2e/fixtures/probe.html": '<div class="w-[211px]"></div>',
      "tests/.production-tools-fixture/project/package.json": '{"label":"w-[409px]"}',
      "docs/notes.md": '<div class="w-[287px]"></div>',
    };
    for (const [file, contents] of Object.entries(files)) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), contents);
    }
    const result = await build({
      configFile: join(repository, "vite.config.ts"), root,
      logLevel: "silent", appType: "custom",
      resolve: { alias: { tailwindcss: join(repository, "node_modules", "tailwindcss", "index.css") } },
      build: { write: false, rollupOptions: { input: join(root, "src", "styles.css") } },
    });
    const outputs = Array.isArray(result) ? result : [result];
    const css = outputs.flatMap(output => output.output).filter(file => file.type === "asset" && file.fileName.endsWith(".css")).map(file => String(file.source)).join("\n");
    assert.ok(css.includes("133px"), "Application utility was omitted");
    assert.ok(css.includes("211px"), "Browser fixture utility was omitted");
    assert.ok(!css.includes("409px"), "Generated release fixture was scanned for application styles");
    assert.ok(!css.includes("287px"), "Documentation was scanned for application styles");
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("preshot-vite-watch-"));
    await rm(root, { recursive: true, force: true });
  }
});
