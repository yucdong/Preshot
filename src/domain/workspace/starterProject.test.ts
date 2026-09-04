import { describe, expect, it } from "vitest";
import { validateProjectPlanV15 } from "../plan/canvas/blockDocument";
import {
  createStarterProjectPlan,
  STARTER_PROJECT_NAME,
} from "./starterProject";

describe("starter project plan", () => {
  it("creates a valid schema-15 document-v3 plan with editable Chinese blocks", () => {
    const plan = createStarterProjectPlan();

    expect(validateProjectPlanV15(plan)).toEqual(plan);
    expect(plan.title).toBe(STARTER_PROJECT_NAME);
    expect(plan.document.blocks).toHaveLength(3);
    expect(plan.document.blocks.every((block) =>
      block.type === "paragraph" &&
      Array.isArray(block.content) &&
      block.content.some((content) =>
        content.type === "text" && /[\u3400-\u9fff]/u.test(content.text)
      )
    )).toBe(true);
    expect(plan.imageGroups).toEqual([]);
    expect(plan.artifacts).toEqual([]);
    expect(JSON.stringify(plan)).not.toMatch(/references\/|media\//);
  });
});
