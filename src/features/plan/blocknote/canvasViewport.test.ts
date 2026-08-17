import { describe, expect, it } from "vitest";
import {
  BLOCKNOTE_DOCUMENT_WIDTH,
  BLOCKNOTE_WORKSPACE_GUTTER,
  BLOCKNOTE_ZOOM_STEP,
  fitBlockNoteDocumentZoom,
  isLegacyDefaultImageGroup,
} from "./canvasViewport";

describe("BlockNote canvas viewport", () => {
  it("fits the fixed-width document inside the viewport gutters", () => {
    expect(BLOCKNOTE_DOCUMENT_WIDTH).toBe(1080);
    expect(BLOCKNOTE_WORKSPACE_GUTTER).toBe(20);
    expect(fitBlockNoteDocumentZoom(1440)).toBe(1.29);
    expect(fitBlockNoteDocumentZoom(1120)).toBe(1);
  });

  it("uses faster fifteen-percent zoom steps", () => {
    expect(BLOCKNOTE_ZOOM_STEP).toBe(0.15);
  });

  it("expands only untouched legacy default image groups", () => {
    expect(isLegacyDefaultImageGroup({ x: 0, width: 674 })).toBe(true);
    expect(isLegacyDefaultImageGroup({ x: 12, width: 674 })).toBe(false);
    expect(isLegacyDefaultImageGroup({ x: 0, width: 620 })).toBe(false);
  });
});
