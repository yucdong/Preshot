import { describe, expect, it } from "vitest";
import { logicalComponentIdFromDnd } from "./componentDragIdentity";

describe("logicalComponentIdFromDnd", () => {
  it("prefers logical component metadata over fragment ids", () => {
    expect(logicalComponentIdFromDnd({ componentId: "ref1" }, "ref1::1")).toBe("ref1");
  });

  it("falls back to the raw id for whole-component frames", () => {
    expect(logicalComponentIdFromDnd(undefined, "plan1")).toBe("plan1");
  });
});
