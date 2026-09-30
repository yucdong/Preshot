import { describe, expect, it } from "vitest";
import { resolveArtifactContentLayout, validateArtifactContentLayout } from "./artifactContentLayout";

describe("artifact content layout", () => {
  it("defaults to compact text above images", () => {
    expect(resolveArtifactContentLayout(undefined, 900)).toMatchObject({ orientation: "vertical", textFirst: true, textShare: 0.25 });
  });
  it("stacks narrow columns without changing the stored preference", () => {
    const layout = { orientation: "horizontal" as const, textFirst: false, textShare: 0.35, minHeight: 320 };
    expect(resolveArtifactContentLayout(layout, 280).orientation).toBe("vertical");
    expect(resolveArtifactContentLayout(layout, 900).orientation).toBe("horizontal");
    expect(layout.orientation).toBe("horizontal");
  });
  it("rejects invalid or ambiguous persistent geometry", () => {
    for (const textShare of [0, 1, NaN, Infinity]) {
      expect(() => validateArtifactContentLayout({ orientation: "vertical", textFirst: true, textShare, minHeight: 320 })).toThrow();
    }
  });
});
