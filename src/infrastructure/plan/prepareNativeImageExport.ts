import type { ProjectPlanV15, PreshotBlock } from "../../domain/plan/canvas/blockDocument";
import { nativeImagePresentation } from "../../domain/plan/canvas/nativeImagePresentation";
import { imageCropForView } from "../../domain/plan/canvas/imageView";
import { imageAssetKey } from "../../domain/plan/canvas/imagePresentation";

/** Export-local rasters are keyed by owning block so equal originals may have
 * independent crops. Neither pixels nor export filenames enter the saved plan. */
export async function prepareNativeImageExport(plan: ProjectPlanV15, assets: Record<string, string>, signal?: AbortSignal): Promise<void> {
  const visit = async (blocks: PreshotBlock[]) => {
    for (const block of blocks) {
      signal?.throwIfAborted();
      if (block.type === "image" && block.props.presentationAxes === "exif" && /^media\//i.test(String(block.props.url))) {
        const source = assets[imageAssetKey(String(block.props.url), "exif")];
        if (!source) throw new Error(`Missing EXIF presentation for export: ${block.id}`);
        const file = `media/export-exif-${crypto.randomUUID()}.png`;
        assets[file] = source;
        block.props = { ...block.props, url: file, presentationAxes: "raw" };
      }
      if (block.type === "image" && (Number(block.props.previewHeight) > 0 || block.props.fitMode === "stretch" || Number(block.props.cropWidth ?? 1) < 1 || Number(block.props.cropHeight ?? 1) < 1)) {
        const url = assets[String(block.props.url)];
        if (!url) throw new Error(`Missing local image for export: ${block.id}`);
        {
          const image = new Image();
          let cancel: (() => void) | undefined;
          try {
          image.src = url;
          const cancelled = new Promise<never>((_resolve, reject) => {
            cancel = () => reject(new DOMException("Image export cancelled", "AbortError"));
            signal?.addEventListener("abort", cancel, { once: true });
          });
          await Promise.race([image.decode(), cancelled]);
          signal?.throwIfAborted();
          const presentation = nativeImagePresentation(block.props, image.naturalWidth, image.naturalHeight);
          const crop = presentation.fitMode === "stretch" ? { x: 0, y: 0, width: 1, height: 1 } : imageCropForView(presentation);
          const scale = Math.min(2, 4096 / Math.max(presentation.frameWidth, presentation.frameHeight));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(presentation.frameWidth * scale));
          canvas.height = Math.max(1, Math.round(presentation.frameHeight * scale));
          try {
            const context = canvas.getContext("2d");
            if (!context) throw new Error("Unable to render image presentation for export");
            context.drawImage(image, crop.x * image.naturalWidth, crop.y * image.naturalHeight,
              crop.width * image.naturalWidth, crop.height * image.naturalHeight, 0, 0, canvas.width, canvas.height);
            const file = `media/export-${crypto.randomUUID()}.png`;
            assets[file] = canvas.toDataURL("image/png");
            block.props = { ...block.props, url: file, previewHeight: 0, fitMode: "cover", cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1 };
          } finally { canvas.width = 0; canvas.height = 0; }
          } finally { if (cancel) signal?.removeEventListener("abort", cancel); image.src = ""; }
        }
      }
      await visit(block.children);
    }
  };
  await visit(plan.document.blocks);
}
