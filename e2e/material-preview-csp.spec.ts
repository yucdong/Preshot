import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("material thumbnail retains actual image pixels under the production policy", async ({ page }) => {
  const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  await page.goto("/e2e/fixtures/material-library.html");
  await expect(page.getByRole("button", { name: "素材库", exact: true })).toBeVisible();
  const coloredPixels = await page.evaluate(async policy => {
    const meta = document.createElement("meta");
    meta.httpEquiv = "Content-Security-Policy";
    meta.content = policy;
    document.head.append(meta);
    const fixturePath = "/e2e/fixtures/materialLibraryPreviewPolicy.tsx";
    const fixture = await import(fixturePath);
    return fixture.captureColoredMaterial();
  }, config.app.security.csp);
  expect(coloredPixels).toBeGreaterThan(1_000);
});

test("installed image policy permits local material originals and thumbnails", async ({ page }) => {
  const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  const image = readFileSync("docs/demo/photos/model-a.png").toString("base64");
  await page.route("http://preshot-policy.test/", route => route.fulfill({
    contentType: "text/html", headers: { "Content-Security-Policy": config.app.security.csp },
    body: "<!doctype html><title>Material image policy</title><body></body>",
  }));
  await page.goto("http://preshot-policy.test/");
  const result = await page.evaluate(async base64 => {
    const violations: string[] = [];
    document.addEventListener("securitypolicyviolation", event => violations.push(event.effectiveDirective));
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    try {
      const dimensions = [];
      for (const src of [blobUrl, `data:image/png;base64,${base64}`]) {
        const image = new Image();
        image.src = src;
        document.body.append(image);
        await image.decode();
        dimensions.push([image.naturalWidth, image.naturalHeight]);
      }
      return { dimensions, violations };
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }, image);
  expect(result).toEqual({ dimensions: [[960, 720], [960, 720]], violations: [] });
});
