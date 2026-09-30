import { describe, expect, it } from "vitest";
import { createEmptyProjectPlanV17, migrateProjectPlanV16ToV17, validateProjectPlanV17 } from "./blockDocument";
import { nativeImagePresentation } from "./nativeImagePresentation";
import { createMaterialSnapshot, instantiateMaterial } from "../../library/material";

describe("buglist1 presentation compatibility", () => {
  it("migrates v16/doc4 without changing identities, column widths or original paths", () => {
    const plan = createEmptyProjectPlanV17("Bridge", { makeId: () => "row" });
    const legacy = { ...plan, schemaVersion: 16, document: { ...plan.document, version: 4 } };
    const before = structuredClone(legacy);
    expect(migrateProjectPlanV16ToV17(legacy)).toEqual(plan);
    expect(legacy).toEqual(before);
  });
  it("preserves card regions through material v2 and rejects corrupt geometry", () => {
    const plan = createEmptyProjectPlanV17("Bridge", { makeId: () => "row" });
    plan.document.blocks = [{ id: "row", type: "prop", props: { artifactId: "prop" }, content: undefined, children: [] }];
    plan.artifacts = [{ id: "prop", kind: "prop", revision: 0, title: "伞", source: "长说明",
      gallery: { id: "gallery", images: [] }, contentLayout: { orientation: "horizontal", textFirst: false, textShare: .3, minHeight: 280 } }];
    const snapshot = createMaterialSnapshot(plan, "row");
    expect(snapshot.payload.version).toBe(2);
    let id = 0;
    expect(instantiateMaterial(snapshot.payload, [], () => `fresh-${++id}`).artifact?.contentLayout).toEqual(plan.artifacts[0].contentLayout);
    plan.artifacts[0].contentLayout!.textShare = 1;
    expect(() => validateProjectPlanV17(plan)).toThrow();
  });
  it("cover crops a changed frame and stretch keeps the explicit mode", () => {
    const props = { previewWidth: 400, previewHeight: 400, cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1 };
    const image = nativeImagePresentation(props, 1200, 800);
    expect(image.crop?.width).toBeCloseTo(2 / 3);
    expect(image.crop?.height).toBe(1);
    expect(nativeImagePresentation({ ...props, fitMode: "stretch" }, 1200, 800).fitMode).toBe("stretch");
  });
});
