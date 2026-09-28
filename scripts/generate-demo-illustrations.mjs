import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Original vector mockups, rasterized for the production JPG/PNG image picker.
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 1 });
  await mkdir(resolve("docs/demo/photos"), { recursive: true });
  for (const name of ["model-a", "transparent-umbrella", "bubble-machine"]) {
    await page.goto(pathToFileURL(resolve(`docs/demo/illustrations/${name}.svg`)).href);
    await page.locator("svg").screenshot({ path: resolve(`docs/demo/photos/${name}.png`) });
    console.log(`Rendered ${name}.png`);
  }
} finally {
  await browser.close();
}
