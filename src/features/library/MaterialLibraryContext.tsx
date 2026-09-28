import { createContext, useContext } from "react";
import type { MaterialDetail, MaterialImageSelection, MaterialMetadata, MaterialSnapshot, MaterialSummary } from "../../domain/library/models";
import type { MaterialLibraryRepository } from "../../domain/library/ports";

export interface MaterialBrowserInput {
  targetLabel: string;
  imagesOnly?: boolean;
  onInsert(material: MaterialSummary, selection?: MaterialImageSelection): Promise<void>;
}

export interface MaterialSaveInput {
  snapshot: MaterialSnapshot;
  projectName: string;
  onSave(metadata: MaterialMetadata): Promise<MaterialDetail>;
}

export interface MaterialLibraryController {
  repository: MaterialLibraryRepository;
  openBrowser(input?: MaterialBrowserInput): void;
  registerDocumentBrowser(open: () => void): () => void;
  openSave(input: MaterialSaveInput): void;
  close(): void;
}

// Keep the context independent of UI modules so provider/dialog hot updates
// cannot replace the context used by already mounted workspace consumers.
export const MaterialLibraryContext = createContext<MaterialLibraryController | null>(null);

export function useOptionalMaterialLibrary(): MaterialLibraryController | null {
  return useContext(MaterialLibraryContext);
}
