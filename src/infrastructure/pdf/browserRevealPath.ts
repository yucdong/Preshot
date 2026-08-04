import type { PdfRevealTarget } from "./revealPath";

export const browserRevealTarget: PdfRevealTarget = {
  async reveal(_path: string): Promise<void> {
    // No-op in browser/memory mode
  },
};
