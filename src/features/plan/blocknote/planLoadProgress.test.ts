import { describe, expect, it } from "vitest";
import { assetLoadPercent } from "./planLoadProgress";

describe("project asset loading progress", () => {
  it("weights actual reads and decodes without completing the document", () => {
    expect([0, 1, 2, 3, 4].map((count) => assetLoadPercent(count, 4)))
      .toEqual([30, 43, 57, 70, 84]);
    expect(assetLoadPercent(0, 0)).toBe(84);
  });
  it("rejects invalid counts instead of inventing progress", () => {
    for (const [completed, total] of [[-1, 2], [3, 2], [0, -1], [0.5, 2]]) {
      expect(() => assetLoadPercent(completed, total)).toThrow("Invalid");
    }
  });
});
