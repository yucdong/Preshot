export const BLOCKNOTE_DOCUMENT_WIDTH = 1080;
export const BLOCKNOTE_DOCUMENT_HORIZONTAL_PADDING = 36;
export const BLOCKNOTE_DOCUMENT_CONTENT_WIDTH =
  BLOCKNOTE_DOCUMENT_WIDTH - BLOCKNOTE_DOCUMENT_HORIZONTAL_PADDING * 2;
export const BLOCKNOTE_WORKSPACE_GUTTER = 20;
export const BLOCKNOTE_MIN_ZOOM = 0.55;
export const BLOCKNOTE_MAX_ZOOM = 1.8;
export const BLOCKNOTE_ZOOM_STEP = 0.15;
export const LEGACY_BLOCKNOTE_CONTENT_WIDTH = 674;

export function fitBlockNoteDocumentZoom(viewportWidth: number): number {
  const available = Math.max(
    0,
    viewportWidth - BLOCKNOTE_WORKSPACE_GUTTER * 2,
  );
  const fit = Math.floor((available / BLOCKNOTE_DOCUMENT_WIDTH) * 100) / 100;
  return Math.max(BLOCKNOTE_MIN_ZOOM, Math.min(BLOCKNOTE_MAX_ZOOM, fit));
}

export function isLegacyDefaultImageGroup(
  group: { x: number; width: number },
): boolean {
  return group.x === 0 &&
    Math.abs(group.width - LEGACY_BLOCKNOTE_CONTENT_WIDTH) < 1;
}
