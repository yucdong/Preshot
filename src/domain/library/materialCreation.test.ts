import { describe, expect, it } from "vitest";
import { createEmptyMaterialPayload } from "./materialCreation";
import { MATERIAL_KINDS } from "./models";
import { materialPayloadTitle } from "./material";
import { componentImages } from "./materialStructure";

describe("empty material creation", () => {
  it.each(MATERIAL_KINDS)("creates an independent editable %s without project assets", (kind) => {
    const first = createEmptyMaterialPayload(kind, "New component");
    const second = createEmptyMaterialPayload(kind, "Another component");
    expect(first.kind).toBe(kind);
    expect(first.component.kind).toBe(kind);
    expect(componentImages(first.component)).toEqual([]);
    expect(materialPayloadTitle(first)).toBe("New component");
    componentImages(first.component).push({
      localImageId: "draft-image", caption: "", aspectRatio: 1, frameWidth: 200, frameHeight: 200,
    });
    expect(componentImages(second.component)).toEqual([]);
  });

  it("rejects an invalid component title before native staging", () => {
    expect(() => createEmptyMaterialPayload("prop", "")).toThrow();
  });
});
