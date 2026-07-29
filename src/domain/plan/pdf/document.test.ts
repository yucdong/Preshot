import { describe, expect, it } from "vitest";
import type { ProjectPlan } from "../models";
import { buildExportDocument } from "./document";

const plan: ProjectPlan = {
  photographyPlan: "<p>Notes</p>",
  referenceGroups: [
    {
      id: "g1",
      title: "Lookbook",
      description: "<p>Warm</p>",
      columnsPerRow: 3,
      images: [{ id: "i1", file: "references/0001.png" }],
    },
  ],
};

describe("buildExportDocument", () => {
  it("puts the photography plan first, then one section per group", () => {
    const doc = buildExportDocument(plan, "Sunset Shoot");
    expect(doc.title).toBe("Sunset Shoot");
    expect(doc.sections[0]).toEqual({ html: "<p>Notes</p>" });
    expect(doc.sections[1]).toEqual({
      heading: "Lookbook",
      html: "<p>Warm</p>",
      imageGrid: { columns: 3, files: ["references/0001.png"] },
    });
  });
});
