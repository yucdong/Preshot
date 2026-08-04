import { describe, expect, it } from "vitest";
import type { ProjectPlan } from "./models";
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
import type { PlanComponent } from "./models";

function planWith(id: string, html: string): ProjectPlan {
  return {
    schemaVersion: 3,
    components: [{ id, type: "plan", width: 1, height: 220, html }],
  };
}

const A = planWith("p", "A");
const B = planWith("p", "B");

describe("plan history stack", () => {
  it("starts empty", () => {
    const h = createHistory();
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it("records the previous state and enables undo", () => {
    const h = record(createHistory(), A);
    expect(canUndo(h)).toBe(true);
    expect(h.past).toHaveLength(1);
  });

  it("undo returns the recorded state and pushes current to future", () => {
    const h = record(createHistory(), A); // user moved A -> B; current is B
    const outcome = undo(h, B);
    expect(outcome).not.toBeNull();
    expect(outcome!.next).toEqual(A);
    expect(canRedo(outcome!.history)).toBe(true);
    expect(canUndo(outcome!.history)).toBe(false);
  });

  it("redo restores the future state and pushes current back to past", () => {
    const undone = undo(record(createHistory(), A), B)!;
    const outcome = redo(undone.history, A); // current is A after undo
    expect(outcome).not.toBeNull();
    expect(outcome!.next).toEqual(B);
    expect(canUndo(outcome!.history)).toBe(true);
    expect(canRedo(outcome!.history)).toBe(false);
  });

  it("undo and redo are no-ops (null) on empty stacks", () => {
    expect(undo(createHistory(), A)).toBeNull();
    expect(redo(createHistory(), A)).toBeNull();
  });

  it("recording a new change after undo clears the future (redo)", () => {
    const undone = undo(record(createHistory(), A), B)!;
    const h = record(undone.history, A); // new change A -> C
    expect(canRedo(h)).toBe(false);
  });

  it("caps the past at the configured limit, dropping the oldest", () => {
    let h = createHistory(2);
    h = record(h, planWith("p", "1"));
    h = record(h, planWith("p", "2"));
    h = record(h, planWith("p", "3"));
    expect(h.past).toHaveLength(2);
    expect(h.past[0]).toEqual(planWith("p", "2"));
  });

  it("stores independent snapshots that later mutation cannot corrupt", () => {
    const mutable = planWith("p", "orig");
    const h = record(createHistory(), mutable);
    (mutable.components[0] as { html: string }).html = "changed";
    const outcome = undo(h, B)!;
    expect((outcome.next.components[0] as { html: string }).html).toBe("orig");
  });

  it("coalesces consecutive same-key records within the window into one entry", () => {
    let h = createHistory();
    h = record(h, A, { coalesceKey: "resize:p", now: 1000 });
    h = record(h, B, { coalesceKey: "resize:p", now: 1000 + COALESCE_WINDOW_MS - 1 });
    expect(h.past).toHaveLength(1);
    expect(h.past[0]).toEqual(A); // keeps the pre-burst state
  });

  it("does not coalesce when the key differs or the window elapsed", () => {
    let h = createHistory();
    h = record(h, A, { coalesceKey: "resize:p", now: 1000 });
    h = record(h, B, { coalesceKey: "resize:q", now: 1100 });
    expect(h.past).toHaveLength(2);

    let h2 = createHistory();
    h2 = record(h2, A, { coalesceKey: "resize:p", now: 1000 });
    h2 = record(h2, B, { coalesceKey: "resize:p", now: 1000 + COALESCE_WINDOW_MS + 1 });
    expect(h2.past).toHaveLength(2);
  });

  it("does not coalesce across an undo", () => {
    let h = createHistory();
    h = record(h, A, { coalesceKey: "resize:p", now: 1000 });
    const undone = undo(h, B)!;
    const after = record(undone.history, A, { coalesceKey: "resize:p", now: 1200 });
    expect(after.past).toHaveLength(1); // fresh entry, not coalesced with the pre-undo burst
  });
});

function plan(components: PlanComponent[]): ProjectPlan {
  return { schemaVersion: 3, components };
}

describe("mergeStructural", () => {
  it("keeps current html/description for components surviving by id", () => {
    const target = plan([
      { id: "a", type: "plan", width: 1, height: 220, html: "OLD" },
      {
        id: "b",
        type: "reference",
        width: 1,
        height: 320,
        title: "T",
        description: "OLD DESC",
        showCaptions: false,
        imageHeight: 180,
        images: [],
      },
    ]);
    const current = plan([
      { id: "a", type: "plan", width: 0.5, height: 999, html: "NEW" },
      {
        id: "b",
        type: "reference",
        width: 0.5,
        height: 999,
        title: "T2",
        description: "NEW DESC",
        showCaptions: true,
        imageHeight: 400,
        images: [],
      },
    ]);

    const merged = mergeStructural(target, current);

    expect(merged.components[0]).toMatchObject({ width: 1, height: 220, html: "NEW" });
    expect(merged.components[1]).toMatchObject({
      width: 1,
      height: 320,
      title: "T",
      showCaptions: false,
      imageHeight: 180,
      description: "NEW DESC",
    });
  });

  it("uses target's own text for components not present in current (re-added)", () => {
    const target = plan([
      { id: "a", type: "plan", width: 1, height: 220, html: "TARGET" },
    ]);
    const current = plan([]);
    const merged = mergeStructural(target, current);
    expect(merged.components[0]).toMatchObject({ html: "TARGET" });
  });

  it("ignores id matches whose type differs", () => {
    const target = plan([
      { id: "x", type: "plan", width: 1, height: 220, html: "TARGET" },
    ]);
    const current = plan([
      {
        id: "x",
        type: "reference",
        width: 1,
        height: 320,
        title: "T",
        description: "D",
        showCaptions: false,
        imageHeight: 180,
        images: [],
      },
    ]);
    const merged = mergeStructural(target, current);
    expect(merged.components[0]).toMatchObject({ type: "plan", html: "TARGET" });
  });

  it("does not mutate the inputs", () => {
    const target = plan([
      { id: "a", type: "plan", width: 1, height: 220, html: "OLD" },
    ]);
    const current = plan([
      { id: "a", type: "plan", width: 1, height: 220, html: "NEW" },
    ]);
    mergeStructural(target, current);
    expect((target.components[0] as { html: string }).html).toBe("OLD");
  });
});
