import { describe, expect, it } from "vitest";
import {
  canRedo,
  canUndo,
  COALESCE_WINDOW_MS,
  createHistory,
  mergeStructural,
  record,
  redo,
  undo,
} from "./history";
import type { PlanComponent, ProjectPlan } from "./models";

function planWith(id: string, html: string): ProjectPlan {
  return {
    schemaVersion: 8,
    title: "Demo",
    components: [{
      id,
      name: "文案1",
      type: "plan",
      x: 0,
      width: 300,
      height: 120,
      html,
    }],
  };
}

const A = planWith("p", "A");
const B = planWith("p", "B");

describe("plan history stack", () => {
  it("records, undoes, and redoes v7 card plans", () => {
    const recorded = record(createHistory(), A);
    expect(canUndo(recorded)).toBe(true);
    const undone = undo(recorded, B)!;
    expect(undone.next).toEqual(A);
    expect(canRedo(undone.history)).toBe(true);
    expect(redo(undone.history, A)?.next).toEqual(B);
  });

  it("coalesces card resize records inside the documented window", () => {
    let history = createHistory();
    history = record(history, A, { coalesceKey: "resize:p", now: 1000 });
    history = record(history, B, {
      coalesceKey: "resize:p",
      now: 1000 + COALESCE_WINDOW_MS - 1,
    });
    expect(history.past).toEqual([A]);
  });

  it("does not mutate recorded v7 snapshots", () => {
    const mutable = planWith("p", "original");
    const history = record(createHistory(), mutable);
    (mutable.components[0] as { html: string }).html = "changed";
    expect((undo(history, B)!.next.components[0] as { html: string }).html).toBe("original");
  });
});

function plan(components: PlanComponent[]): ProjectPlan {
  return { schemaVersion: 8, title: "Demo", components };
}

function reference(
  id: string,
  description: string,
  aspectRatio: number,
): PlanComponent {
  return {
    id,
    name: "Reference",
    type: "reference",
    x: 0,
    width: 300,
    height: 200,
    description,
    images: [{
      id: "i1",
      file: "references/one.png",
      aspectRatio,
      frameWidth: 120,
      frameHeight: 120,
    }],
  };
}

describe("mergeStructural", () => {
  it("keeps current text, description, and hydrated image ratio while retaining target cards", () => {
    const target = plan([
      { ...planWith("a", "old").components[0], width: 400 },
      reference("r", "old description", 1),
    ]);
    const current = plan([
      { ...planWith("a", "new").components[0], width: 120 },
      reference("r", "new description", 2),
    ]);

    const merged = mergeStructural(target, current);

    expect(merged.components[0]).toMatchObject({ width: 400, html: "new" });
    expect(merged.components[1]).toMatchObject({
      width: 300,
      description: "new description",
      images: [expect.objectContaining({ aspectRatio: 2, frameWidth: 120 })],
    });
  });
});
