import type { PdfExportDocument } from "./document";

export interface PdfExporter {
  export(document: PdfExportDocument, images: Record<string, string>): Promise<Uint8Array>;
}

export interface PdfSaveTarget {
  save(bytes: Uint8Array, suggestedName: string): Promise<boolean>;
}
