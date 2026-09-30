import { expect, test } from "@playwright/test";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { unzipDocx } from "./docxTestArchive";

test("the independently copied native sample works in all three production exporters", async ({ page }) => {
  const root = process.env.PRESHOT_COPY_ACCEPTANCE_OUTPUT;
  test.skip(!root, "Run the native copy test with PRESHOT_COPY_ACCEPTANCE_OUTPUT first");
  test.setTimeout(240_000);
  const manifest = JSON.parse(await readFile(join(root!, ".preshotproj"), "utf8"));
  const assets: Record<string, string> = {};
  for (const folder of ["media", "references"]) for (const file of await readdir(join(root!, folder))) {
    const mime = file.endsWith("png") ? "image/png" : file.endsWith("jpg") ? "image/jpeg" : file.endsWith("mp4") ? "video/mp4" : file.endsWith("wav") ? "audio/wav" : "text/plain";
    assets[`${folder}/${file}`] = `data:${mime};base64,${(await readFile(join(root!, folder, file))).toString("base64")}`;
  }
  await page.goto("/e2e/fixtures/long-image-native-media.html");
  const result = await page.evaluate(async ({ source, assets }) => {
    const load = (name: string) => import(/* @vite-ignore */ `/src/${name}`);
    const { migrateProjectPlanV16ToV17 } = await load("domain/plan/canvas/blockDocument.ts");
    const { createReactPdfBlockNoteExporter } = await load("infrastructure/pdf/reactPdfBlockNoteExporter.ts");
    const { createBlockNoteDocxExporter } = await load("infrastructure/docx/blockNoteDocxExporter.ts");
    const { BlockNoteLongImageExporter } = await load("infrastructure/longImage/BlockNoteLongImageExporter.ts");
    const plan = migrateProjectPlanV16ToV17(source);
    const pdf = await createReactPdfBlockNoteExporter().export(plan, assets);
    const docx = await createBlockNoteDocxExporter().export(plan, assets);
    const png = await new BlockNoteLongImageExporter().export({ plan, resolvedAssets: assets, preset: "lossless-png", options: { allowSplit: true } });
    return { pdf: Array.from(pdf) as number[], docx: Array.from(docx) as number[], parts: png.parts.map((part: { bytes: Uint8Array }) => Array.from(part.bytes)) };
  }, { source: manifest.plan, assets });
  expect(new TextDecoder().decode(Uint8Array.from(result.pdf).slice(0, 5))).toBe("%PDF-");
  const archive = await unzipDocx(Uint8Array.from(result.docx));
  expect(new TextDecoder().decode(archive.get("word/document.xml"))).toContain("南京长江大桥");
  expect([...archive.keys()].filter(file => file.startsWith("word/media/")).length).toBeGreaterThan(5);
  expect(result.parts.length).toBeGreaterThan(0);
  for (const type of ["pdf", "docx"] as const) await writeFile(test.info().outputPath(`copied-sample.${type}`), Buffer.from(result[type]));
  for (const [index, part] of result.parts.entries()) await writeFile(test.info().outputPath(`copied-sample-${index + 1}.png`), Buffer.from(part));
});
