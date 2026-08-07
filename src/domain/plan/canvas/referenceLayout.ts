import type { ReferenceImage } from "./models";
import type { Rect } from "./geometry";
import { calculateCaptionTextSizing } from "./captionTextSizing";

export const COMPONENT_INSET = 12;
export const REFERENCE_HEADER_GAP = 6;
export const REFERENCE_TITLE_ROW_HEIGHT = 24;
export const REFERENCE_CONTROL_ROW_HEIGHT = 18;
export const REFERENCE_HEADER_HEIGHT =
  REFERENCE_TITLE_ROW_HEIGHT +
  REFERENCE_HEADER_GAP +
  REFERENCE_CONTROL_ROW_HEIGHT +
  REFERENCE_HEADER_GAP;
export const REFERENCE_CONTINUATION_HEADER_HEIGHT = 0;
export const REFERENCE_DESCRIPTION_HEIGHT = 44;
export const REFERENCE_DESCRIPTION_GAP = 6;
export const IMAGE_GAP = 12;

export interface ReferenceFlowItem {
  kind: "image" | "add";
  id: string;
  aspectRatio: number;
  caption?: string;
  displayHeight?: number;
}

export interface ReferenceFlowSlot extends Rect {
  kind: "image" | "add";
  id: string;
  imageHeight: number;
  captionHeight: number;
  captionFontSize?: number;
  captionLineHeight?: number;
  captionLines?: readonly string[];
}

export interface ReferenceRow {
  y: number;
  height: number;
  slots: ReferenceFlowSlot[];
}

export interface ReferenceFragmentLayout {
  fragmentIndex: number;
  kind: "first" | "continuation";
  height: number;
  rows: ReferenceRow[];
}

const EPS = 0.0001;

function positiveFinite(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function normalizeAspectRatio(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function imageSlot(
  image: Pick<ReferenceImage, "id" | "aspectRatio" | "caption" | "displayHeight">,
  requestedHeight: number,
  innerWidth: number,
): ReferenceFlowSlot {
  const ratio = normalizeAspectRatio(image.aspectRatio);
  const safeHeight = positiveFinite(image.displayHeight ?? requestedHeight);
  const safeWidth = positiveFinite(innerWidth);
  const requestedWidth = safeHeight * ratio;
  const scale = requestedWidth > 0 ? Math.min(1, safeWidth / requestedWidth) : 0;
  const initialImageHeight = safeHeight * scale;
  const initialWidth = initialImageHeight * ratio;
  const sizing = calculateCaptionTextSizing({
    caption: image.caption,
    width: initialWidth,
    imageHeight: initialImageHeight,
  });
  const imageHeight = sizing.imageHeight;
  const width = imageHeight * ratio;

  return {
    kind: "image",
    id: image.id,
    x: 0,
    y: 0,
    width,
    height: sizing.totalHeight,
    imageHeight,
    captionHeight: sizing.captionHeight,
    captionFontSize: sizing.fontSize,
    captionLineHeight: sizing.lineHeight,
    captionLines: sizing.lines,
  };
}

function addSlot(innerWidth: number, requestedImageHeight: number): ReferenceFlowSlot {
  const safeWidth = positiveFinite(innerWidth);
  const requestedHeight = positiveFinite(requestedImageHeight);
  const requestedWidth = requestedHeight / 2;
  const scale = requestedWidth > 0 ? Math.min(1, safeWidth / requestedWidth) : 0;
  const width = requestedWidth * scale;
  const height = requestedHeight * scale;

  return {
    kind: "add",
    id: "__add__",
    x: 0,
    y: 0,
    width,
    height,
    imageHeight: height,
    captionHeight: 0,
  };
}

function flowSlot(item: ReferenceFlowItem, imageHeight: number, innerWidth: number): ReferenceFlowSlot {
  if (item.kind === "add") {
    return addSlot(innerWidth, imageHeight);
  }

  return imageSlot(item, imageHeight, innerWidth);
}

function cloneRow(row: ReferenceRow, yOffset: number, scale = 1): ReferenceRow {
  return {
    y: yOffset,
    height: row.height * scale,
    slots: row.slots.map((slot) => ({
      ...slot,
      x: slot.x * scale,
      y: (slot.y - row.y) * scale + yOffset,
      width: slot.width * scale,
      height: slot.height * scale,
      imageHeight: slot.imageHeight * scale,
      captionHeight: slot.captionHeight * scale,
    })),
  };
}

function scaledRowToHeight(row: ReferenceRow, targetHeight: number): ReferenceRow {
  const safeTarget = positiveFinite(targetHeight);
  const sourceHeight = positiveFinite(row.height);
  const scale = sourceHeight > 0 ? safeTarget / sourceHeight : 0;
  return cloneRow(row, 0, scale);
}

export function packReferenceRows(input: {
  images: ReferenceImage[];
  imageHeight: number;
  innerWidth: number;
  includeAddTile?: boolean;
}): ReferenceRow[] {
  const rows: ReferenceRow[] = [];
  const items: ReferenceFlowItem[] = [
    ...input.images.map((image) => ({
      kind: "image" as const,
      id: image.id,
      aspectRatio: image.aspectRatio,
      caption: image.caption,
      displayHeight: image.displayHeight,
    })),
    ...(input.includeAddTile === false
      ? []
      : [{ kind: "add" as const, id: "__add__", aspectRatio: 0.5 }]),
  ];

  const availableWidth = positiveFinite(input.innerWidth);
  let currentSlots: ReferenceFlowSlot[] = [];
  let currentRowHeight = 0;
  let currentRowWidth = 0;
  let currentRowY = 0;

  const flushRow = (): void => {
    if (currentSlots.length === 0) {
      return;
    }

    rows.push({ y: currentRowY, height: currentRowHeight, slots: currentSlots });
    currentRowY += currentRowHeight + IMAGE_GAP;
    currentSlots = [];
    currentRowHeight = 0;
    currentRowWidth = 0;
  };

  for (const item of items) {
    const slot = flowSlot(item, input.imageHeight, availableWidth);
    const nextWidth = currentSlots.length === 0 ? slot.width : currentRowWidth + IMAGE_GAP + slot.width;
    if (currentSlots.length > 0 && nextWidth > availableWidth + EPS) {
      flushRow();
    }

    const x = currentSlots.length === 0 ? 0 : currentRowWidth + IMAGE_GAP;
    const placedSlot = { ...slot, x, y: currentRowY };
    currentSlots.push(placedSlot);
    currentRowWidth = x + slot.width;
    currentRowHeight = Math.max(currentRowHeight, slot.height);
  }

  flushRow();
  return rows;
}

export function paginateReferenceRows(input: {
  rows: ReferenceRow[];
  firstAvailableHeight: number;
  continuationAvailableHeight: number;
}): ReferenceFragmentLayout[] {
  const rows = input.rows;
  if (rows.length === 0) {
    return [];
  }

  const firstLimit = positiveFinite(input.firstAvailableHeight);
  const continuationLimit = positiveFinite(input.continuationAvailableHeight);
  const fragments: ReferenceFragmentLayout[] = [];
  let fragmentRows: ReferenceRow[] = [];
  let fragmentStartY = 0;

  const currentLimit = (): number => (fragments.length === 0 ? firstLimit : continuationLimit);

  const flushFragment = (): void => {
    if (fragmentRows.length === 0) {
      return;
    }

    const lastRow = fragmentRows[fragmentRows.length - 1];
    fragments.push({
      fragmentIndex: fragments.length,
      kind: fragments.length === 0 ? "first" : "continuation",
      height: lastRow.y + lastRow.height,
      rows: fragmentRows,
    });
    fragmentRows = [];
  };

  for (const row of rows) {
    const limit = currentLimit();
    if (fragmentRows.length === 0) {
      fragmentStartY = row.y;
      fragmentRows = row.height > limit + EPS ? [scaledRowToHeight(row, limit)] : [cloneRow(row, 0)];
      continue;
    }

    const relativeY = row.y - fragmentStartY;
    if (relativeY + row.height > limit + EPS) {
      flushFragment();
      fragmentStartY = row.y;
      const nextLimit = currentLimit();
      fragmentRows = row.height > nextLimit + EPS ? [scaledRowToHeight(row, nextLimit)] : [cloneRow(row, 0)];
      continue;
    }

    fragmentRows.push(cloneRow(row, relativeY));
  }

  flushFragment();
  return fragments;
}
