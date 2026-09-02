import type { ReferenceImage } from "./models";

export const DOCUMENT_IMAGE_GROUP_GAP = 7;
export const DOCUMENT_IMAGE_GROUP_INSET = 9;

export interface DocumentImageGroupSlot {
  id: string;
  rowIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DocumentImageGroupRow {
  index: number;
  y: number;
  height: number;
  imageIds: string[];
}

export interface DocumentImageGroupLayout {
  scale: number;
  slots: DocumentImageGroupSlot[];
  rows: DocumentImageGroupRow[];
  height: number;
}

function positiveFinite(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function finiteOffset(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function availableFrameExtent(frameExtent: number): number {
  const extent = positiveFinite(frameExtent);
  return Math.max(1, extent - DOCUMENT_IMAGE_GROUP_INSET * 2);
}

function slotsAtScale(
  images: readonly ReferenceImage[],
  availableWidth: number,
  scale: number,
): Pick<DocumentImageGroupLayout, "rows" | "slots"> {
  const slots: DocumentImageGroupSlot[] = [];
  const rows: DocumentImageGroupRow[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let rowIndex = 0;
  for (const image of images) {
    const width = positiveFinite(image.frameWidth) * scale;
    const height = positiveFinite(image.frameHeight) * scale;
    const offsetX = finiteOffset(image.frameOffsetX) * scale;
    const offsetY = finiteOffset(image.frameOffsetY) * scale;
    const minimumX = Math.min(0, offsetX);
    const minimumY = Math.min(0, offsetY);
    const footprintWidth = Math.max(0, offsetX + width) - minimumX;
    const footprintHeight = Math.max(0, offsetY + height) - minimumY;
    if (
      x > 0 &&
      x + DOCUMENT_IMAGE_GROUP_GAP + footprintWidth > availableWidth + 0.001
    ) {
      x = 0;
      y += rowHeight + DOCUMENT_IMAGE_GROUP_GAP;
      rowHeight = 0;
      rowIndex += 1;
    }
    if (x > 0) x += DOCUMENT_IMAGE_GROUP_GAP;
    slots.push({
      id: image.id,
      rowIndex,
      x: x + offsetX - minimumX,
      y: y + offsetY - minimumY,
      width,
      height,
    });
    x += footprintWidth;
    rowHeight = Math.max(rowHeight, footprintHeight);
    const row = rows[rowIndex];
    if (row) {
      row.height = Math.max(row.height, footprintHeight);
      row.imageIds.push(image.id);
    } else {
      rows.push({
        index: rowIndex,
        y,
        height: footprintHeight,
        imageIds: [image.id],
      });
    }
  }
  return { rows, slots };
}

function contentHeight(slots: readonly DocumentImageGroupSlot[]): number {
  return slots.reduce(
    (maximum, slot) => Math.max(maximum, slot.y + slot.height),
    0,
  );
}

function layoutAtScale(
  images: readonly ReferenceImage[],
  availableWidth: number,
  scale: number,
): DocumentImageGroupLayout {
  const { rows, slots } = slotsAtScale(images, availableWidth, scale);
  return {
    scale,
    slots,
    rows,
    height: contentHeight(slots) + DOCUMENT_IMAGE_GROUP_INSET * 2,
  };
}

export function layoutDocumentImageGroupForWidth(
  images: readonly ReferenceImage[],
  frameWidth: number,
): DocumentImageGroupLayout {
  return layoutAtScale(images, availableFrameExtent(frameWidth), 1);
}
