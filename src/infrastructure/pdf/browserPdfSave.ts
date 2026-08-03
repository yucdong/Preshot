import type { PdfSaveTarget } from "../../domain/plan/canvas/ports";

export const browserPdfSaveTarget: PdfSaveTarget = {
  save() {
    return Promise.resolve(true);
  },
};
