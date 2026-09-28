import "../../../styles.css";
import { insertPastedImage } from "../../../domain/clipboard/projectImagePaste";
import { createEmptyProjectPlanV15 } from "../../../domain/plan/canvas/blockDocument";
import { BlockNoteLongImageExporter } from "../BlockNoteLongImageExporter";
import { mountLongImageExportSurface } from "../longImageExportSurface";

async function exportPastedImages(preset: "wechat" | "lossless-png") {
  // Exercise the real paste document shape without accessing the system clipboard.
  const source = document.createElement("canvas");
  source.width = 600;
  source.height = 300;
  const context = source.getContext("2d")!;
  ["#ef4444", "#22c55e", "#3b82f6"].forEach((color, index) => {
    context.fillStyle = color;
    context.fillRect(index * 200, 0, 200, 300);
  });
  const dataUrl = source.toDataURL("image/png");
  source.width = source.height = 0;
  let plan = createEmptyProjectPlanV15("剪贴板图片长图测试", { makeId: () => "intro" });
  const resolvedAssets: Record<string, string> = {};
  for (let index = 0; index < 2; index++) {
    const file = `media/paste-${index}.png`;
    plan = insertPastedImage(plan, { kind: "document", afterBlockId: plan.document.blocks.at(-1)!.id }, {
      file, name: "剪贴板图片.png", operationId: `paste-${index}`, mimeType: "image/png",
    }, { width: 600, height: 300 }, () => `pasted-image-${index}`, undefined, {
      previewWidth: index === 0 ? 480 : 300,
      textAlignment: index === 0 ? "left" : "right",
      caption: `粘贴图片说明 ${index + 1}`,
    }).plan;
    resolvedAssets[file] = dataUrl;
  }
  plan.document.blocks.push({
    id: "file", type: "file", content: undefined, children: [],
    props: { name: "拍摄清单.txt", url: "media/list.txt", caption: "", showPreview: false },
  });
  resolvedAssets["media/list.txt"] = "data:text/plain;base64,bGlzdA==";
  const before = JSON.stringify(plan);
  let imageRects: { x: number; y: number; width: number; height: number }[] = [];
  let staticLabels: string[] = [];
  let captions: string[] = [];
  const exporter = new BlockNoteLongImageExporter({
    mountSurface: async options => {
      const handle = await mountLongImageExportSurface(options);
      const outer = handle.element.getBoundingClientRect();
      imageRects = [...handle.element.querySelectorAll('[data-content-type="image"] img')].map(image => {
        const rect = image.getBoundingClientRect();
        return { x: rect.x - outer.x, y: rect.y - outer.y, width: rect.width, height: rect.height };
      });
      staticLabels = [...handle.element.querySelectorAll<HTMLElement>("[data-preshot-export-native-media]")]
        .map(element => element.dataset.preshotExportNativeMediaLabel!);
      captions = [...handle.element.querySelectorAll('[data-content-type="image"]')]
        .map(element => element.textContent ?? "");
      return handle;
    },
  });
  const result = await exporter.export({ plan, resolvedAssets, preset });
  const part = result.parts[0];
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(part.bytes)]));
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const pixels = canvas.getContext("2d")!;
  pixels.drawImage(bitmap, 0, 0);
  const samples = imageRects.map(rect => [1 / 6, 1 / 2, 5 / 6].map(fraction =>
    [...pixels.getImageData(Math.round(rect.x + rect.width * fraction),
      Math.round(rect.y + rect.height / 2), 1, 1).data]));
  bitmap.close();
  canvas.width = canvas.height = 0;
  return {
    bytes: Array.from(part.bytes), partCount: result.parts.length,
    imageRects, staticLabels, captions, samples, unchanged: before === JSON.stringify(plan),
    remainingSurfaces: document.querySelectorAll("[data-preshot-long-image-export-host]").length,
  };
}

Object.assign(window, { exportPastedImages });
