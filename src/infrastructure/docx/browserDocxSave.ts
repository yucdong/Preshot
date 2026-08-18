import type { DocxSaveTarget } from "../../domain/plan/canvas/ports";

export const browserDocxSaveTarget: DocxSaveTarget = {
  revealProjectDirectoryAfterSave: false,
  save(bytes, { suggestedName }) {
    const blob = new Blob([Uint8Array.from(bytes)], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = suggestedName;
    anchor.click();
    URL.revokeObjectURL(url);
    return Promise.resolve(suggestedName);
  },
};
