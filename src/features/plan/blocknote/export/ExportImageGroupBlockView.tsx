import {
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  DOCUMENT_IMAGE_GROUP_GAP,
  layoutDocumentImageGroupForWidth,
  type DocumentImageGroupSlot,
} from "../../../../domain/plan/canvas/documentImageGroupLayout";
import {
  imageFrameContentCss,
} from "../../../../domain/plan/canvas/imageView";
import type { ReferenceImage } from "../../../../domain/plan/canvas/models";
import {
  BLOCKNOTE_DOCUMENT_CONTENT_WIDTH,
  isLegacyDefaultImageGroup,
} from "../canvasViewport";
import type { ImageGroupExportController } from "./ImageGroupExportContext";
import { compactArtifactGalleryImages } from "../artifactGallerySizing";

interface ExportImageGroupRow {
  index: number;
  top: number;
  height: number;
  imageIds: string[];
}

function finiteOffset(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function imageGroupRows(
  images: readonly ReferenceImage[],
  slots: readonly DocumentImageGroupSlot[],
): ExportImageGroupRow[] {
  const rows = new Map<number, ExportImageGroupRow>();
  slots.forEach((slot, index) => {
    const image = images[index];
    if (!image) return;
    const offsetY = finiteOffset(image.frameOffsetY);
    const rowTop = slot.y - offsetY + Math.min(0, offsetY);
    const footprintHeight =
      Math.max(0, offsetY + slot.height) - Math.min(0, offsetY);
    const row = rows.get(rowTop);
    if (row) {
      row.height = Math.max(row.height, footprintHeight);
      row.imageIds.push(slot.id);
      return;
    }
    rows.set(rowTop, {
      index: rows.size,
      top: rowTop,
      height: footprintHeight,
      imageIds: [slot.id],
    });
  });
  return [...rows.values()].map((row, index, allRows) => ({
    ...row,
    height: allRows[index + 1]
      ? allRows[index + 1].top - row.top - DOCUMENT_IMAGE_GROUP_GAP
      : row.height,
  }));
}

export function ExportImageGroupBlockView({
  autoCompact = false,
  blockId,
  controller,
  groupId,
  variant = "block",
}: {
  autoCompact?: boolean;
  blockId: string;
  controller: ImageGroupExportController;
  groupId: string;
  variant?: "block" | "embedded";
}) {
  const group = controller.getGroup(groupId);
  const shellRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(
    BLOCKNOTE_DOCUMENT_CONTENT_WIDTH,
  );

  useLayoutEffect(() => {
    const content = variant === "embedded"
      ? shellRef.current?.parentElement
      : shellRef.current?.closest<HTMLElement>(".bn-block-content");
    if (!content || typeof ResizeObserver === "undefined") return;
    const update = () => {
      if (content.clientWidth > 0) setAvailableWidth(content.clientWidth);
    };
    const observer = new ResizeObserver(update);
    observer.observe(content);
    update();
    return () => observer.disconnect();
  }, [groupId, variant]);

  if (!group) {
    throw new Error(`Long-image export cannot resolve image group "${groupId}".`);
  }

  const requestedWidth = isLegacyDefaultImageGroup(group)
    ? availableWidth
    : group.width;
  const width = Math.max(1, Math.min(requestedWidth, availableWidth));
  const x = Math.max(0, Math.min(group.x, Math.max(0, availableWidth - width)));
  const displayImages = compactArtifactGalleryImages(
    group.images,
    width,
    autoCompact,
  );
  const layout = layoutDocumentImageGroupForWidth(displayImages, width);
  const height = autoCompact ? layout.height : Math.max(group.height, layout.height);
  const imagesById = new Map(displayImages.map((image) => [image.id, image]));
  const rows = imageGroupRows(displayImages, layout.slots);

  return (
    <div
      className="preshot-long-image-export-group-shell"
      data-preshot-export-image-group-block={blockId}
      ref={shellRef}
    >
      <div
        className="preshot-long-image-export-group"
        data-preshot-export-image-group={groupId}
        style={{
          height,
          marginLeft: x,
          transform: `translateY(${group.frameOffsetY ?? 0}px)`,
          width,
        }}
      >
        <div className="preshot-long-image-export-group-content">
          {rows.map((row) => (
            <div
              aria-hidden="true"
              data-preshot-export-image-group-block-id={blockId}
              data-preshot-export-image-group-id={groupId}
              data-preshot-export-image-group-row={`${groupId}:${row.index}`}
              data-preshot-export-image-group-row-index={row.index}
              data-preshot-export-image-ids={row.imageIds.join(",")}
              key={row.index}
              style={{
                height: row.height,
                left: 0,
                position: "absolute",
                top: row.top,
                width: "100%",
              }}
            />
          ))}
          {layout.slots.map((slot) => {
            const image = imagesById.get(slot.id);
            if (!image) return null;
            const src = controller.getImageSrc(image.file);
            if (!src) {
              throw new Error(
                `Long-image export is missing local image data for "${image.file}".`,
              );
            }
            return (
              <div
                className="preshot-long-image-export-image-frame"
                data-preshot-export-image={image.id}
                data-preshot-export-source={image.file}
                key={image.id}
                style={{
                  height: slot.height,
                  left: slot.x,
                  top: slot.y,
                  width: slot.width,
                }}
              >
                <img
                  alt=""
                  data-preshot-export-asset="image-group"
                  draggable={false}
                  src={src}
                  style={imageFrameContentCss(image)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
