import type { ReferenceImage } from "./models";

export const DOCUMENT_IMAGE_GROUP_GAP = 7;
export const DOCUMENT_IMAGE_GROUP_INSET = 9;

export interface DocumentImageGroupSlot {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DocumentImageGroupLayout {
  scale: number;
  slots: DocumentImageGroupSlot[];
  height: number;
}

function slotsAtScale(
  images: readonly ReferenceImage[],
  availableWidth: number,
  scale: number,
): DocumentImageGroupSlot[] {
  const slots: DocumentImageGroupSlot[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const image of images) {
    const width = Math.max(1, image.frameWidth * scale);
    const height = Math.max(1, image.frameHeight * scale);
    const offsetX = (image.frameOffsetX ?? 0) * scale;
    const offsetY = (image.frameOffsetY ?? 0) * scale;
    const minimumX = Math.min(0, offsetX);
    const minimumY = Math.min(0, offsetY);
    const footprintWidth = Math.max(0, offsetX + width) - minimumX;
    const footprintHeight = Math.max(0, offsetY + height) - minimumY;
    if (
      x > 0 &&
      x + DOCUMENT_IMAGE_GROUP_GAP + footprintWidth > availableWidth
    ) {
      x = 0;
      y += rowHeight + DOCUMENT_IMAGE_GROUP_GAP;
      rowHeight = 0;
    }
    if (x > 0) x += DOCUMENT_IMAGE_GROUP_GAP;
    slots.push({
      id: image.id,
      x: x + offsetX - minimumX,
      y: y + offsetY - minimumY,
      width,
      height,
    });
    x += footprintWidth;
    rowHeight = Math.max(rowHeight, footprintHeight);
  }
  return slots;
}

function contentHeight(slots: readonly DocumentImageGroupSlot[]): number {
  return slots.reduce(
    (maximum, slot) => Math.max(maximum, slot.y + slot.height),
    0,
  );
}

function maximumFootprintWidth(images: readonly ReferenceImage[]): number {
  return images.reduce((maximum, image) => {
    const offsetX = image.frameOffsetX ?? 0;
    const minimumX = Math.min(0, offsetX);
    const footprintWidth =
      Math.max(0, offsetX + Math.max(1, image.frameWidth)) - minimumX;
    return Math.max(maximum, footprintWidth);
  }, 0);
}

function layoutAtScale(
  images: readonly ReferenceImage[],
  availableWidth: number,
  scale: number,
): DocumentImageGroupLayout {
  const slots = slotsAtScale(images, availableWidth, scale);
  return {
    scale,
    slots,
    height: contentHeight(slots) + DOCUMENT_IMAGE_GROUP_INSET * 2,
  };
}

function fits(slots: readonly DocumentImageGroupSlot[], width: number, height: number) {
  return slots.every((slot) =>
    slot.x + slot.width <= width + 0.001 &&
    slot.y + slot.height <= height + 0.001,
  );
}

export function layoutDocumentImageGroupForWidth(
  images: readonly ReferenceImage[],
  frameWidth: number,
): DocumentImageGroupLayout {
  const availableWidth = Math.max(1, frameWidth - DOCUMENT_IMAGE_GROUP_INSET * 2);
  const widestFootprint = maximumFootprintWidth(images);
  const scale = widestFootprint > availableWidth
    ? availableWidth / widestFootprint
    : 1;
  return layoutAtScale(images, availableWidth, scale);
}

export function layoutDocumentImageGroup(
  images: readonly ReferenceImage[],
  frameWidth: number,
  frameHeight: number,
): DocumentImageGroupLayout {
  const availableWidth = Math.max(1, frameWidth - DOCUMENT_IMAGE_GROUP_INSET * 2);
  const availableHeight = Math.max(1, frameHeight - DOCUMENT_IMAGE_GROUP_INSET * 2);
  const widthLayout = layoutDocumentImageGroupForWidth(images, frameWidth);
  if (fits(widthLayout.slots, availableWidth, availableHeight)) {
    return widthLayout;
  }

  let low = 0.01;
  let high = widthLayout.scale;
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const middle = (low + high) / 2;
    const slots = slotsAtScale(images, availableWidth, middle);
    if (fits(slots, availableWidth, availableHeight)) low = middle;
    else high = middle;
  }
  return layoutAtScale(images, availableWidth, low);
}
