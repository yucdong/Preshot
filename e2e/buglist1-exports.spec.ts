import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { unzipDocx } from "./docxTestArchive";

test("card regions and native crop/stretch survive all three production exporters", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/e2e/fixtures/long-image-native-media.html");
  const result = await page.evaluate(async () => {
    const load = (name: string) => import(/* @vite-ignore */ `/src/${name}`);
    const { createEmptyProjectPlanV17 } = await load("domain/plan/canvas/blockDocument.ts");
    const { prepareNativeImageExport } = await load("infrastructure/plan/prepareNativeImageExport.ts");
    const { createReactPdfBlockNoteExporter } = await load("infrastructure/pdf/reactPdfBlockNoteExporter.ts");
    const { createBlockNoteDocxExporter } = await load("infrastructure/docx/blockNoteDocxExporter.ts");
    const { BlockNoteLongImageExporter } = await load("infrastructure/longImage/BlockNoteLongImageExporter.ts");
    const canvas = document.createElement("canvas"); canvas.width = 600; canvas.height = 200;
    const ctx = canvas.getContext("2d")!;
    ["#ef4444", "#22c55e", "#3b82f6"].forEach((color, index) => { ctx.fillStyle = color; ctx.fillRect(index * 200, 0, 200, 200); });
    const url = canvas.toDataURL("image/png");
    const plan = createEmptyProjectPlanV17("布局与原图导出验收", { makeId: () => "intro" });
    plan.document.blocks = [
      { id: "card", type: "prop", props: { artifactId: "prop" }, content: undefined, children: [] },
      ...["cover", "stretch"].map(fitMode => ({ id: fitMode, type: "image", props: {
        url: "media/stripes.png", name: fitMode, caption: fitMode === "cover" ? "裁切适配：绿色正方形" : "自由变形：三色正方形",
        showPreview: true, previewWidth: 180, previewHeight: 180, fitMode,
      }, content: undefined, children: [] })),
    ];
    plan.artifacts = [{ id: "prop", kind: "prop", revision: 0, title: "透明伞和泡泡机",
      source: "南京长江大桥拍摄。先确认安全步道，逆光拍摄模特 A。".repeat(4),
      contentLayout: { orientation: "horizontal", textFirst: false, textShare: .35, minHeight: 200 },
      gallery: { id: "gallery", images: [{ id: "sample", file: "references/0001.png", aspectRatio: 3,
        sourceWidth: 600, sourceHeight: 200, frameWidth: 360, frameHeight: 120 }] },
    }];
    const assets = { "media/stripes.png": url, "references/0001.png": url };
    const before = JSON.stringify({ plan, assets });
    const display = structuredClone(plan), displayAssets = { ...assets };
    await prepareNativeImageExport(display, displayAssets);
    const pixels: number[][][] = [];
    for (const block of display.document.blocks.slice(1)) {
      const image = new Image(); image.src = displayAssets[block.props.url as keyof typeof displayAssets]; await image.decode();
      ctx.clearRect(0, 0, 600, 200); ctx.drawImage(image, 0, 0, 180, 180);
      pixels.push([30, 90, 150].map(x => [...ctx.getImageData(x, 90, 1, 1).data]));
    }
    const pdf = await createReactPdfBlockNoteExporter().export(plan, assets);
    const docx = await createBlockNoteDocxExporter().export(plan, assets);
    const png = await new BlockNoteLongImageExporter().export({ plan, resolvedAssets: assets, preset: "lossless-png" });
    return { pdf: Array.from(pdf) as number[], docx: Array.from(docx) as number[], png: Array.from(png.parts[0].bytes) as number[],
      pixels, parts: png.parts.length, unchanged: before === JSON.stringify({ plan, assets }) };
  });
  expect(result.unchanged).toBe(true);
  expect(result.parts).toBe(1);
  expect(result.pixels[0]).toEqual(Array(3).fill([34, 197, 94, 255]));
  expect(result.pixels[1]).toEqual([[239, 68, 68, 255], [34, 197, 94, 255], [59, 130, 246, 255]]);
  const archive = await unzipDocx(Uint8Array.from(result.docx));
  expect([...archive.keys()].filter(name => name.startsWith("word/media/")).length).toBeGreaterThanOrEqual(3);
  const xml = new TextDecoder().decode(archive.get("word/document.xml"));
  expect(xml).toContain("透明伞和泡泡机"); expect(xml).toContain("<w:tbl");
  const rels = new TextDecoder().decode(archive.get("word/_rels/document.xml.rels"));
  const galleryId = [...xml.matchAll(/<a:blip[^>]*r:embed="([^"]+)"/g)][0][1];
  const galleryTarget = rels.match(new RegExp(`Id="${galleryId}"[^>]*Target="([^"]+)"`))![1];
  const extents = [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)].map(match => Number(match[1]));
  const span = await page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)]));
    const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!; ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width, right = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 50) { left = Math.min(left, x); right = Math.max(right, x); }
    }
    bitmap.close(); return (right - left + 1) / canvas.width;
  }, Array.from(archive.get(`word/${galleryTarget}`)!));
  // The 360px gallery image should remain twice the 180px native frame.
  // Internal region width must not apply the column scale a second time.
  expect(span * extents[0] / extents[1]).toBeCloseTo(2, 1);
  for (const type of ["pdf", "docx", "png"] as const) await writeFile(test.info().outputPath(`presentation.${type}`), Buffer.from(result[type]));
});
