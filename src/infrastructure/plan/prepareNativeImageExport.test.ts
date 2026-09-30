import { expect, it } from "vitest";
import { createEmptyProjectPlanV15 } from "../../domain/plan/canvas/blockDocument";
import { prepareNativeImageExport } from "./prepareNativeImageExport";

it("gives raw and EXIF native images independent export-only assets", async () => {
  const plan = createEmptyProjectPlanV15("Photo", { makeId: () => "text" });
  plan.schemaVersion = 18;
  plan.document.blocks = [undefined, "exif" as const].map((axes, index) => ({
    id: `n${index}`, type: "image", props: { url: "media/photo.jpg", ...(axes ? { presentationAxes: axes } : {}) }, children: [], content: undefined,
  }));
  const exportPlan = structuredClone(plan);
  const assets: Record<string, string> = { "media/photo.jpg": "raw-data", "media/photo.jpg#preshot-exif": "oriented-data" };
  await prepareNativeImageExport(exportPlan, assets);
  expect(exportPlan.document.blocks[0].props.url).toBe("media/photo.jpg");
  expect(exportPlan.document.blocks[1].props.url).not.toBe("media/photo.jpg");
  expect(assets[String(exportPlan.document.blocks[1].props.url)]).toBe("oriented-data");
  expect(plan.document.blocks.map(block => block.props.url)).toEqual(["media/photo.jpg", "media/photo.jpg"]);
  expect(plan.document.blocks[1].props.presentationAxes).toBe("exif");
  await expect(prepareNativeImageExport(structuredClone(plan), { "media/photo.jpg": "raw-data" })).rejects.toThrow("Missing EXIF presentation");
});
