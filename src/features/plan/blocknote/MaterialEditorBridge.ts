import type { PreshotBlockDocument } from "../../../domain/plan/canvas/blockDocument";

export interface MaterialEditorBridge {
  getAnchor(): string | null;
  applyDocument(document: PreshotBlockDocument): void;
  focusBlock(blockId: string): void;
}
