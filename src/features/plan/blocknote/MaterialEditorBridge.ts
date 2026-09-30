import type { PreshotBlockDocument } from "../../../domain/plan/canvas/blockDocument";

export interface ExternalImageHistoryEntry {
  undo(): void;
  redo(): void;
}

export interface MaterialEditorBridge {
  setEditable?(editable: boolean): void;
  flushDocument?(): void;
  getAnchor(): string | null;
  applyDocument(document: PreshotBlockDocument): void;
  focusBlock(blockId: string): void;
  recordExternalHistory?(entry: ExternalImageHistoryEntry): void;
  undo?(): void;
}
