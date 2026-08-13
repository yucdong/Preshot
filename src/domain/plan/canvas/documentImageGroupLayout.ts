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
    if (x > 0 && x + DOCUMENT_IMAGE_GROUP_GAP + width > availableWidth) {
      x = 0;
      y += rowHeight + DOCUMENT_IMAGE_GROUP_GAP;
      rowHeight = 0;
    }
    if (x > 0) x += DOCUMENT_IMAGE_GROUP_GAP;
    slots.push({ id: image.id, x, y, width, height });
    x += width;
    rowHeight = Math.max(rowHeight, height);
  }
  return slots;
}

function fits(slots: readonly DocumentImageGroupSlot[], width: number, height: number) {
  return slots.every((slot) =>
    slot.x + slot.width <= width + 0.001 &&
    slot.y + slot.height <= height + 0.001,
  );
}

export function layoutDocumentImageGroup(
  images: readonly ReferenceImage[],
  frameWidth: number,
  frameHeight: number,
): DocumentImageGroupLayout {
  const availableWidth = Math.max(1, frameWidth - DOCUMENT_IMAGE_GROUP_INSET * 2);
  const availableHeight = Math.max(1, frameHeight - DOCUMENT_IMAGE_GROUP_INSET * 2);
  const naturalSlots = slotsAtScale(images, availableWidth, 1);
  if (fits(naturalSlots, availableWidth, availableHeight)) {
    return { scale: 1, slots: naturalSlots };
  }

  let low = 0.01;
  let high = 1;
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const middle = (low + high) / 2;
    const slots = slotsAtScale(images, availableWidth, middle);
    if (fits(slots, availableWidth, availableHeight)) low = middle;
    else high = middle;
  }
  return { scale: low, slots: slotsAtScale(images, availableWidth, low) };
}
