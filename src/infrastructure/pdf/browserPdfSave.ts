import type { PdfSaveTarget } from "../../domain/plan/pdf/ports";

export const browserPdfSaveTarget: PdfSaveTarget = {
  save() {
    return Promise.resolve(true);
  },
};
