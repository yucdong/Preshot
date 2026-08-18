import type { PdfSaveTarget } from "../../domain/plan/canvas/ports";

export const browserPdfSaveTarget: PdfSaveTarget = {
  save(bytes, defaultFileName) {
    const blob = new Blob([Uint8Array.from(bytes)], {
      type: "application/pdf",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = defaultFileName;
    anchor.click();
    URL.revokeObjectURL(url);
    return Promise.resolve(defaultFileName);
  },
};
