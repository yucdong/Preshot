import type { ProjectPlan } from "../models";

export interface PdfImageGrid {
  columns: number;
  files: string[];
}

export interface PdfSection {
  heading?: string;
  html: string;
  imageGrid?: PdfImageGrid;
}

export interface PdfExportDocument {
  title: string;
  sections: PdfSection[];
}

export function buildExportDocument(plan: ProjectPlan, title: string): PdfExportDocument {
  const sections: PdfSection[] = [{ html: plan.photographyPlan }];

  for (const group of plan.referenceGroups) {
    sections.push({
      heading: group.title,
      html: group.description,
      imageGrid: {
        columns: group.columnsPerRow,
        files: group.images.map((image) => image.file),
      },
    });
  }

  return { title, sections };
}
