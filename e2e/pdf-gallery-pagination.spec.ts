import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";

type Matrix = [number, number, number, number, number, number];
const identity = (): Matrix => [1, 0, 0, 1, 0, 0];
function compose(a: Matrix, b: Matrix): Matrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

function inspectPage(pdf: PDFDocument, pageIndex: number) {
  const page = pdf.getPages()[pageIndex];
  const entries = page.node.normalizedEntries();
  const chunks: string[] = [];
  if (entries.Contents instanceof PDFArray) {
    for (let index = 0; index < entries.Contents.size(); index += 1) {
      const stream = pdf.context.lookup(entries.Contents.get(index));
      if (stream instanceof PDFRawStream) chunks.push(new TextDecoder().decode(decodePDFRawStream(stream).decode()));
    }
  }
  const xObjects = entries.Resources.lookup(PDFName.of("XObject"), PDFDict);
  const images: Array<{ resource: string; x: number; y: number; width: number; height: number }> = [];
  let matrix = identity(); const stack: Matrix[] = [];
  for (const rawLine of chunks.join("\n").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "q") stack.push([...matrix]);
    else if (line === "Q") matrix = stack.pop() ?? identity();
    else if (line.endsWith(" cm")) {
      const numbers = line.slice(0, -3).split(/\s+/).map(Number);
      if (numbers.length === 6 && numbers.every(Number.isFinite)) matrix = compose(matrix, numbers as Matrix);
    } else {
      const draw = line.match(/^\/(I\d+) Do$/);
      if (!draw) continue;
      const x = [matrix[4], matrix[0] + matrix[4], matrix[2] + matrix[4], matrix[0] + matrix[2] + matrix[4]];
      const y = [matrix[5], matrix[1] + matrix[5], matrix[3] + matrix[5], matrix[1] + matrix[3] + matrix[5]];
      images.push({ resource: String(xObjects.get(PDFName.of(draw[1]))), x: Math.min(...x), y: page.getHeight() - Math.max(...y),
        width: Math.max(...x) - Math.min(...x), height: Math.max(...y) - Math.min(...y) });
    }
  }
  return { width: page.getWidth(), height: page.getHeight(), images };
}

for (const scenario of [
  { name: "gallery shorter than a full page uses the current remainder", query: "size=small", count: 12, firstPageImages: true, spansPages: true },
  { name: "gallery taller than a full page starts mid-page and continues", query: "size=large", count: 30, firstPageImages: true, spansPages: true },
  { name: "weighted column gallery continues without blank pages", query: "size=large&columns", count: 30, firstPageImages: true, spansPages: true },
  { name: "authored page break still moves the gallery to the next page", query: "size=small&pageBreak", count: 12, firstPageImages: false, spansPages: true },
  { name: "six-column gallery preserves all small image frames", query: "size=small&columns=6", count: 12, firstPageImages: true, spansPages: false },
]) {
  test(scenario.name, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(`/e2e/fixtures/pdf-gallery-pagination.html?${scenario.query}`);
    await expect(page.locator(".bn-editor")).toBeVisible();
    await expect(page.locator('[data-image-id^="pagination-image-"]')).toHaveCount(scenario.count);
    await expect(page.locator('[data-image-id="pagination-image-01"] img').first()).toBeVisible();
    await page.screenshot({ path: info.outputPath("editor.png") });
    const externalRequests: string[] = [];
    page.on("request", request => {
      const url = request.url();
      if (url.startsWith("http") && new URL(url).origin !== new URL(page.url()).origin) externalRequests.push(url);
    });
    await page.getByRole("button", { name: "导出", exact: true }).click();
    const pendingDownload = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "导出 PDF", exact: true }).click();
    const download = await pendingDownload;
    const pdfPath = info.outputPath("gallery.pdf");
    await download.saveAs(pdfPath);
    const pdf = await PDFDocument.load(await readFile(pdfPath));
    const pages = pdf.getPages().map((_, index) => inspectPage(pdf, index));
    const summaryPath = info.outputPath("pagination.json");
    await writeFile(summaryPath, JSON.stringify({ scenario, pages, externalRequests }, null, 2));
    await info.attach("production PDF pagination", { path: pdfPath, contentType: "application/pdf" });
    await info.attach("page geometry and image identities", { path: summaryPath, contentType: "application/json" });
    // Optional local visual evidence; the committed assertions need only pdf-lib.
    for (let index = 0; index < pages.length; index += 1) {
      const pngBase = info.outputPath(`page-${index + 1}`);
      const rendered = spawnSync("pdftoppm", ["-png", "-r", "90", "-f", String(index + 1), "-singlefile", pdfPath, pngBase], { timeout: 30_000 });
      if (rendered.status === 0) await info.attach(`PDF page ${index + 1}`, { path: `${pngBase}.png`, contentType: "image/png" });
    }
    expect(download.suggestedFilename()).toBe("output.pdf");
    expect(externalRequests).toEqual([]);
    const allImages = pages.flatMap(entry => entry.images);
    expect(allImages).toHaveLength(scenario.count);
    expect(new Set(allImages.map(image => image.resource)).size).toBe(scenario.count);
    if (scenario.spansPages) expect(pages.length).toBeGreaterThan(1);
    else expect(pages.length).toBe(1);
    expect(pages[0].images.length > 0).toBe(scenario.firstPageImages);
    if (scenario.firstPageImages) {
      expect(pages[0].images[0].y).toBeGreaterThan(200);
      if (scenario.spansPages) expect(pages[0].images.length).toBeLessThan(scenario.count);
      else expect(pages[0].images.length).toBe(scenario.count);
    }
    for (const [index, entry] of pages.entries()) {
      if (index > 0) expect(entry.images.length, `page ${index + 1} should continue image rows`).toBeGreaterThan(0);
      expect(entry.images.length % 3, `page ${index + 1} should preserve complete rows`).toBe(0);
      for (const image of entry.images) {
        expect(image.x).toBeGreaterThanOrEqual(23);
        expect(image.y).toBeGreaterThanOrEqual(23);
        expect(image.x + image.width).toBeLessThanOrEqual(entry.width - 23);
        expect(image.y + image.height).toBeLessThanOrEqual(entry.height - 23);
        expect(image.width / image.height).toBeCloseTo(1, 2);
      }
    }
  });
}
