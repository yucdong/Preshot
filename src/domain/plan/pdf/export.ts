import type { ProjectPlan } from "../models";
import { buildExportDocument } from "./document";
import type { PdfExporter } from "./ports";

export async function exportPlanToPdf(
  exporter: PdfExporter,
  plan: ProjectPlan,
  title: string,
  images: Record<string, string>,
): Promise<Uint8Array> {
  try {
    const document = buildExportDocument(plan, title);
    return await exporter.export(document, images);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to build the plan PDF: ${message}`, { cause: error });
  }
}
