import { describe, expect, it, vi } from "vitest";
import type { ProjectPlan } from "../models";
import { exportPlanToPdf } from "./export";
import type { PdfExporter } from "./ports";

const plan: ProjectPlan = { photographyPlan: "<p>x</p>", referenceGroups: [] };

describe("exportPlanToPdf", () => {
  it("builds the document and delegates to the exporter", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const exporter: PdfExporter = { export: vi.fn().mockResolvedValue(bytes) };

    const result = await exportPlanToPdf(exporter, plan, "Shoot", {
      "references/0001.png": "data:image/png;base64,AA",
    });

    expect(result).toBe(bytes);
    expect(exporter.export).toHaveBeenCalledWith(
      { title: "Shoot", sections: [{ html: "<p>x</p>" }] },
      { "references/0001.png": "data:image/png;base64,AA" },
    );
  });

  it("wraps exporter failures with context", async () => {
    const exporter: PdfExporter = { export: vi.fn().mockRejectedValue(new Error("boom")) };
    await expect(exportPlanToPdf(exporter, plan, "Shoot", {})).rejects.toThrow(
      /Unable to build the plan PDF: boom/,
    );
  });
});
