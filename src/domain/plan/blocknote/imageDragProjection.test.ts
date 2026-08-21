import { describe, expect, it } from "vitest";
import type { ReferenceImage } from "../canvas/models";
import {
  createImageDragSnapshot,
  deriveImageDragPreviewGroups,
  EMPTY_IMAGE_DROP_TARGET_HYSTERESIS_STATE,
  finalizeImageDrag,
  peekImageDropTargetHysteresis,
  projectImageDrag,
  resolveImageDragGroupOrder,
  resolveImageDragKeyboardTarget,
  resolveRowMajorImageDropTarget,
  startImageDragTransaction,
  updateImageDropTargetHysteresis,
  type ImageDragSnapshot,
  type MeasuredImageGroup,
  type ResolvedImageDropTarget,
} from "./imageDragProjection";

function image(
  id: string,
  frameWidth = 100,
  frameHeight = 80,
): ReferenceImage {
  return {
    id,
    file: `references/${id}.png`,
    aspectRatio: frameWidth / frameHeight,
    sourceWidth: frameWidth * 4,
    sourceHeight: frameHeight * 4,
    frameWidth,
    frameHeight,
    crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
  };
}

function snapshot(
  groups: Array<{
    id: string;
    width?: number;
    height?: number;
    images: ReferenceImage[];
  }>,
  revision: number | string = 7,
): ImageDragSnapshot {
  return createImageDragSnapshot(
    revision,
    groups.map((group) => ({
      id: group.id,
      width: group.width ?? 260,
      height: group.height ?? 80,
      images: group.images,
    })),
  );
}

function transaction(
  source: ImageDragSnapshot,
  groupId: string,
  index: number,
) {
  return startImageDragTransaction(source, {
    activeImageId: source.groups[groupId]!.images[index]!.id,
    sourceGroupId: groupId,
    sourceIndex: index,
  });
}

function ids(
  groups: ImageDragSnapshot["groups"],
  groupId: string,
): string[] {
  return groups[groupId]!.images.map((entry) => entry.id);
}

function measuredGroups(): MeasuredImageGroup[] {
  return [
    {
      groupId: "first",
      rect: { left: 0, right: 300, top: 0, bottom: 240 },
      rows: [
        {
          rect: { left: 10, right: 290, top: 10, bottom: 90 },
          tiles: [
            {
              imageId: "a",
              index: 0,
              row: 0,
              rect: { left: 10, right: 110, top: 10, bottom: 90 },
            },
            {
              imageId: "b",
              index: 1,
              row: 0,
              rect: { left: 120, right: 290, top: 10, bottom: 90 },
            },
          ],
        },
        {
          rect: { left: 10, right: 100, top: 120, bottom: 220 },
          tiles: [{
            imageId: "c",
            index: 2,
            row: 1,
            rect: { left: 10, right: 100, top: 120, bottom: 220 },
          }],
        },
      ],
    },
    {
      groupId: "empty",
      rect: { left: 320, right: 500, top: 0, bottom: 160 },
      rows: [],
    },
  ];
}

describe("image drag snapshots and transactions", () => {
  it("takes a deeply frozen immutable snapshot keyed by group", () => {
    const original = image("a");
    const result = snapshot([{ id: "group", images: [original] }]);

    expect(result.groupOrder).toEqual(["group"]);
    expect(result.groups.group.images[0]).toEqual(original);
    expect(result.groups.group.images[0]).not.toBe(original);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.groups)).toBe(true);
    expect(Object.isFrozen(result.groups.group.images)).toBe(true);
    expect(Object.isFrozen(result.groups.group.images[0]!.crop)).toBe(true);
  });

  it("rejects duplicate group and image ids", () => {
    expect(() =>
      snapshot([
        { id: "same", images: [] },
        { id: "same", images: [] },
      ])
    ).toThrow('Duplicate image-group id "same"');
    expect(() =>
      snapshot([
        { id: "left", images: [image("same")] },
        { id: "right", images: [image("same")] },
      ])
    ).toThrow('Duplicate image id "same"');
  });

  it("uses visible recursive order, excludes invalid markers, and deterministically appends compatibility orphans", () => {
    const groups = [
      { id: "orphan-z", images: [image("z")] },
      { id: "second", images: [image("b")] },
      { id: "first", images: [image("a")] },
      { id: "orphan-a", images: [image("x")] },
    ].map((group) => ({
      ...group,
      width: 260,
      height: 80,
    }));

    expect(resolveImageDragGroupOrder(
      ["missing", "first", "first", "second"],
      groups,
    )).toEqual(["first", "second", "orphan-a", "orphan-z"]);
    expect(createImageDragSnapshot(
      8,
      groups,
      ["missing", "first", "first", "second"],
    ).groupOrder).toEqual(["first", "second", "orphan-a", "orphan-z"]);
  });

  it("validates the source group, index, and active image", () => {
    const source = snapshot([{ id: "group", images: [image("a")] }]);

    expect(() =>
      startImageDragTransaction(source, {
        activeImageId: "a",
        sourceGroupId: "missing",
        sourceIndex: 0,
      })
    ).toThrow('Unknown source image group "missing"');
    expect(() =>
      startImageDragTransaction(source, {
        activeImageId: "a",
        sourceGroupId: "group",
        sourceIndex: -1,
      })
    ).toThrow("Invalid source index -1");
    expect(() =>
      startImageDragTransaction(source, {
        activeImageId: "wrong",
        sourceGroupId: "group",
        sourceIndex: 0,
      })
    ).toThrow('Image "wrong" is not at index 0');
  });
});

describe("image drag projection", () => {
  it.each([
    { source: 0, boundary: 3, expected: ["b", "c", "a"], normalized: 2 },
    { source: 2, boundary: 0, expected: ["c", "a", "b"], normalized: 0 },
    { source: 1, boundary: 0, expected: ["b", "a", "c"], normalized: 0 },
    { source: 1, boundary: 3, expected: ["a", "c", "b"], normalized: 2 },
  ])(
    "moves within a group from $source to boundary $boundary",
    ({ source, boundary, expected, normalized }) => {
      const base = snapshot([{
        id: "group",
        images: [image("a"), image("b"), image("c")],
      }]);
      const result = projectImageDrag(
        transaction(base, "group", source),
        { groupId: "group", index: boundary },
      );

      expect(result.kind).toBe("projected");
      expect(ids(result.groups, "group")).toEqual(expected);
      if (result.kind === "projected") {
        expect(result.normalizedIndex).toBe(normalized);
      }
      expect(ids(base.groups, "group")).toEqual(["a", "b", "c"]);
    },
  );

  it.each([
    { source: 0, boundary: 0, expected: ["a", "x", "y"] },
    { source: 1, boundary: 1, expected: ["x", "b", "y"] },
    { source: 2, boundary: 2, expected: ["x", "y", "c"] },
  ])(
    "moves across groups from source index $source to target index $boundary",
    ({ source, boundary, expected }) => {
      const base = snapshot([
        { id: "source", images: [image("a"), image("b"), image("c")] },
        { id: "target", images: [image("x"), image("y")] },
      ]);
      const activeId = base.groups.source.images[source]!.id;
      const result = projectImageDrag(
        transaction(base, "source", source),
        { groupId: "target", index: boundary },
      );

      expect(result.kind).toBe("projected");
      expect(ids(result.groups, "source")).toEqual(
        ["a", "b", "c"].filter((id) => id !== activeId),
      );
      expect(ids(result.groups, "target")).toEqual(expected);
      expect(ids(base.groups, "source")).toEqual(["a", "b", "c"]);
      expect(ids(base.groups, "target")).toEqual(["x", "y"]);
    },
  );

  it("normalizes source-before-target boundaries after removal", () => {
    const base = snapshot([{
      id: "group",
      images: [image("a"), image("b"), image("c"), image("d")],
    }]);

    const after = projectImageDrag(
      transaction(base, "group", 1),
      { groupId: "group", index: 4 },
    );
    const before = projectImageDrag(
      transaction(base, "group", 3),
      { groupId: "group", index: 1 },
    );

    expect(ids(after.groups, "group")).toEqual(["a", "c", "d", "b"]);
    expect(ids(before.groups, "group")).toEqual(["a", "d", "b", "c"]);
    expect(after.kind === "projected" && after.normalizedIndex).toBe(3);
    expect(before.kind === "projected" && before.normalizedIndex).toBe(1);
  });

  describe("keyboard image drag projection", () => {
    it("moves through normalized row-major positions without same-group off-by-one errors", () => {
      const base = snapshot([{
        id: "group",
        images: [image("a"), image("b"), image("c"), image("d")],
      }]);
      const drag = transaction(base, "group", 1);
      const initial = projectImageDrag(drag, null);
      const next = resolveImageDragKeyboardTarget(drag, initial, "next");
      const previous = resolveImageDragKeyboardTarget(drag, initial, "previous");

      expect(next).toEqual({
        kind: "target",
        target: { groupId: "group", index: 3 },
        position: 2,
      });
      expect(previous).toEqual({
        kind: "target",
        target: { groupId: "group", index: 0 },
        position: 0,
      });
      if (next.kind === "target") {
        expect(ids(projectImageDrag(drag, next.target).groups, "group")).toEqual([
          "a",
          "c",
          "b",
          "d",
        ]);
      }
    });

    it("supports Home, End, and previous/next group while clamping the human position", () => {
      const base = snapshot([
        { id: "first", images: [image("a"), image("b"), image("c")] },
        { id: "empty", images: [] },
        { id: "last", images: [image("x")] },
      ]);
      const drag = transaction(base, "first", 2);
      const initial = projectImageDrag(drag, null);

      expect(resolveImageDragKeyboardTarget(drag, initial, "start")).toEqual({
        kind: "target",
        target: { groupId: "first", index: 0 },
        position: 0,
      });
      expect(resolveImageDragKeyboardTarget(drag, initial, "end")).toEqual({
        kind: "invalid",
        reason: "item-boundary",
      });
      const empty = resolveImageDragKeyboardTarget(
        drag,
        initial,
        "next-group",
      );
      expect(empty).toEqual({
        kind: "target",
        target: { groupId: "empty", index: 0 },
        position: 0,
      });
      if (empty.kind === "target") {
        expect(resolveImageDragKeyboardTarget(
          drag,
          projectImageDrag(drag, empty.target),
          "next-group",
        )).toEqual({
          kind: "target",
          target: { groupId: "last", index: 0 },
          position: 0,
        });
      }
    });

    it("returns invalid boundaries instead of manufacturing a stale target", () => {
      const base = snapshot([{ id: "only", images: [image("a")] }]);
      const drag = transaction(base, "only", 0);
      const initial = projectImageDrag(drag, null);

      expect(resolveImageDragKeyboardTarget(drag, initial, "previous")).toEqual({
        kind: "invalid",
        reason: "item-boundary",
      });
      expect(resolveImageDragKeyboardTarget(
        drag,
        initial,
        "next-group",
      )).toEqual({
        kind: "invalid",
        reason: "group-boundary",
      });
    });

    it("follows visible left-to-right order across recursive groups regardless of metadata order", () => {
      const base = createImageDragSnapshot(
        9,
        [
          {
            id: "right",
            width: 260,
            height: 80,
            images: [image("moving-a"), image("moving-b")],
          },
          {
            id: "left",
            width: 260,
            height: 80,
            images: [image("left-a")],
          },
          {
            id: "middle-empty",
            width: 260,
            height: 80,
            images: [],
          },
        ],
        ["left", "middle-empty", "right"],
      );
      const drag = transaction(base, "right", 1);
      let projection = projectImageDrag(drag, null);

      const move = (command: "previous-group" | "next-group") => {
        const result = resolveImageDragKeyboardTarget(
          drag,
          projection,
          command,
        );
        expect(result.kind).toBe("target");
        if (result.kind === "target") {
          projection = projectImageDrag(drag, result.target);
        }
        return result;
      };

      expect(move("previous-group")).toEqual({
        kind: "target",
        target: { groupId: "middle-empty", index: 0 },
        position: 0,
      });
      expect(move("previous-group")).toEqual({
        kind: "target",
        target: { groupId: "left", index: 0 },
        position: 0,
      });
      expect(resolveImageDragKeyboardTarget(
        drag,
        projection,
        "previous-group",
      )).toEqual({
        kind: "invalid",
        reason: "group-boundary",
      });
      expect(move("next-group")).toMatchObject({
        kind: "target",
        target: { groupId: "middle-empty", index: 0 },
      });
      expect(move("next-group")).toMatchObject({
        kind: "target",
        target: { groupId: "right", index: 0 },
      });
    });
  });

  it("moves into an empty group at index zero", () => {
    const base = snapshot([
      { id: "source", images: [image("a")] },
      { id: "empty", images: [] },
    ]);
    const result = projectImageDrag(
      transaction(base, "source", 0),
      { groupId: "empty", index: 0 },
    );

    expect(ids(result.groups, "source")).toEqual([]);
    expect(ids(result.groups, "empty")).toEqual(["a"]);
  });

  it("returns exact snapshot identity for no-op, outside, and invalid targets", () => {
    const base = snapshot([{
      id: "group",
      images: [image("a"), image("b"), image("c")],
    }]);
    const active = transaction(base, "group", 1);
    const before = projectImageDrag(active, { groupId: "group", index: 1 });
    const after = projectImageDrag(active, { groupId: "group", index: 2 });
    const outside = projectImageDrag(active, null);
    const missing = projectImageDrag(active, { groupId: "missing", index: 0 });
    const invalidIndex = projectImageDrag(active, {
      groupId: "group",
      index: 4,
    });

    expect(before.kind).toBe("noop");
    expect(after.kind).toBe("noop");
    expect(outside.kind).toBe("outside");
    expect(missing.kind).toBe("invalid-target");
    expect(invalidIndex.kind).toBe("invalid-target");
    expect(before.groups).toBe(base.groups);
    expect(after.groups).toBe(base.groups);
    expect(outside.groups).toBe(base.groups);
    expect(missing.groups).toBe(base.groups);
    expect(invalidIndex.groups).toBe(base.groups);
  });
});

describe("image drag preview layout", () => {
  it("uses the real image as a typed placeholder without losing metadata", () => {
    const active = image("active", 135, 90);
    const base = snapshot([
      { id: "source", images: [image("before"), active] },
      { id: "target", images: [image("after")] },
    ]);
    const drag = transaction(base, "source", 1);
    const projection = projectImageDrag(drag, {
      groupId: "target",
      index: 0,
    });
    const preview = deriveImageDragPreviewGroups(drag, projection);
    const source = preview.find((group) => group.groupId === "source")!;
    const target = preview.find((group) => group.groupId === "target")!;
    const placeholder = target.items[0]!;

    expect(source.items.map((item) => item.image.id)).toEqual(["before"]);
    expect(placeholder.kind).toBe("placeholder");
    expect(placeholder.image).toBe(drag.activeImage);
    expect(placeholder.image).toMatchObject({
      id: "active",
      file: "references/active.png",
      sourceWidth: 540,
      sourceHeight: 360,
      frameWidth: 135,
      frameHeight: 90,
      crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
    });
    expect(target.items.map((item) => item.image.id)).toEqual([
      "active",
      "after",
    ]);
    expect(target.layout.slots[0]).toMatchObject({
      id: "active",
      width: 135,
      height: 90,
    });
  });

  it("matches wrap-first layout and reports source/target height changes", () => {
    const base = snapshot([
      {
        id: "source",
        width: 265,
        height: 185,
        images: [image("a", 120, 80), image("b", 120, 80), image("c", 120, 80)],
      },
      {
        id: "target",
        width: 265,
        height: 80,
        images: [image("x", 120, 80)],
      },
      {
        id: "unchanged",
        width: 260,
        height: 123,
        images: [],
      },
    ]);
    const drag = transaction(base, "source", 2);
    const projection = projectImageDrag(drag, {
      groupId: "target",
      index: 1,
    });
    const preview = deriveImageDragPreviewGroups(drag, projection);

    expect(preview.map((group) => group.role)).toEqual([
      "source",
      "target",
      "unchanged",
    ]);
    expect(preview[0]!.layout.slots.map((slot) => [slot.id, slot.y])).toEqual([
      ["a", 0],
      ["b", 0],
    ]);
    expect(preview[0]).toMatchObject({
      previousHeight: 185,
      height: 185,
      heightChanged: false,
    });
    expect(preview[1]!.layout.slots.map((slot) => [slot.id, slot.y])).toEqual([
      ["x", 0],
      ["c", 0],
    ]);
    expect(preview[1]).toMatchObject({
      previousHeight: 80,
      height: 98,
      heightChanged: true,
    });
    expect(preview[2]).toMatchObject({
      previousHeight: 123,
      height: 123,
      heightChanged: false,
    });
  });

  it("keeps authoritative heterogeneous sizes through a same-group wrap", () => {
    const base = snapshot([{
      id: "group",
      width: 300,
      height: 200,
      images: [
        image("wide", 160, 60),
        image("tall", 90, 140),
        image("small", 70, 50),
      ],
    }]);
    const drag = transaction(base, "group", 2);
    const projection = projectImageDrag(drag, {
      groupId: "group",
      index: 0,
    });
    const [preview] = deriveImageDragPreviewGroups(drag, projection);

    expect(preview.role).toBe("source-target");
    expect(preview.items.map((item) => item.image.id)).toEqual([
      "small",
      "wide",
      "tall",
    ]);
    expect(preview.layout.slots).toMatchObject([
      { id: "small", width: 70, height: 50, y: 0 },
      { id: "wide", width: 160, height: 60, y: 0 },
      { id: "tall", width: 90, height: 140, y: 67 },
    ]);
  });
});

describe("row-major target resolution", () => {
  it("selects the group first and resolves heterogeneous row midpoints", () => {
    const groups = measuredGroups();

    expect(resolveRowMajorImageDropTarget(groups, { x: 59, y: 50 })).toMatchObject({
      groupId: "first",
      index: 0,
      boundaryDistance: 1,
    });
    expect(resolveRowMajorImageDropTarget(groups, { x: 61, y: 50 })).toMatchObject({
      groupId: "first",
      index: 1,
      boundaryDistance: 1,
    });
    expect(resolveRowMajorImageDropTarget(groups, { x: 250, y: 50 })).toMatchObject({
      groupId: "first",
      index: 2,
    });
    expect(resolveRowMajorImageDropTarget(groups, { x: 20, y: 170 })).toMatchObject({
      groupId: "first",
      index: 2,
    });
    expect(resolveRowMajorImageDropTarget(groups, { x: 90, y: 170 })).toMatchObject({
      groupId: "first",
      index: 3,
    });
  });

  it("uses row containment then the nearest row center in wrapped gaps", () => {
    const groups = measuredGroups();

    expect(resolveRowMajorImageDropTarget(groups, { x: 20, y: 100 })).toMatchObject({
      groupId: "first",
      index: 0,
    });
    expect(resolveRowMajorImageDropTarget(groups, { x: 20, y: 115 })).toMatchObject({
      groupId: "first",
      index: 2,
    });
  });

  it("returns index zero for empty groups and null outside every group", () => {
    expect(
      resolveRowMajorImageDropTarget(measuredGroups(), { x: 400, y: 80 }),
    ).toEqual({
      groupId: "empty",
      index: 0,
      boundaryDistance: Number.POSITIVE_INFINITY,
    });
    expect(
      resolveRowMajorImageDropTarget(measuredGroups(), { x: 600, y: 80 }),
    ).toBeNull();
  });
});

describe("drop target hysteresis", () => {
  function target(
    index: number,
    boundaryDistance: number,
    groupId = "group",
  ): ResolvedImageDropTarget {
    return { groupId, index, boundaryDistance };
  }

  it("suppresses midpoint chatter and keeps the last valid target in the dead zone", () => {
    const initial = updateImageDropTargetHysteresis(
      EMPTY_IMAGE_DROP_TARGET_HYSTERESIS_STATE,
      target(0, 20),
    );
    const firstCrossing = updateImageDropTargetHysteresis(
      initial.state,
      target(1, 1),
    );
    const chatterBack = updateImageDropTargetHysteresis(
      firstCrossing.state,
      target(0, 1),
    );

    expect(firstCrossing.target?.index).toBe(0);
    expect(firstCrossing.inDeadZone).toBe(true);
    expect(chatterBack.target?.index).toBe(0);
    expect(chatterBack.state.pending).toBeNull();
  });

  it("switches after crossing by 8 CSS pixels", () => {
    const initial = updateImageDropTargetHysteresis(
      EMPTY_IMAGE_DROP_TARGET_HYSTERESIS_STATE,
      target(0, 20),
    );
    const switched = updateImageDropTargetHysteresis(
      initial.state,
      target(1, 8),
    );

    expect(switched.target?.index).toBe(1);
    expect(switched.inDeadZone).toBe(false);
  });

  it("switches after two consecutive samples inside the 8px band", () => {
    const initial = updateImageDropTargetHysteresis(
      EMPTY_IMAGE_DROP_TARGET_HYSTERESIS_STATE,
      target(0, 20),
    );
    const first = updateImageDropTargetHysteresis(initial.state, target(1, 2));
    const second = updateImageDropTargetHysteresis(first.state, target(1, 3));

    expect(first.target?.index).toBe(0);
    expect(second.target?.index).toBe(1);
  });

  it("clears the target outside all groups so release cancels", () => {
    const initial = updateImageDropTargetHysteresis(
      EMPTY_IMAGE_DROP_TARGET_HYSTERESIS_STATE,
      target(0, 20),
    );
    const outside = updateImageDropTargetHysteresis(initial.state, null);

    expect(outside.target).toBeNull();
    expect(outside.state).toBe(EMPTY_IMAGE_DROP_TARGET_HYSTERESIS_STATE);
  });

  it.each([
    { stableGroup: "group", pendingGroup: "group", label: "same-group" },
    { stableGroup: "source", pendingGroup: "target", label: "cross-group" },
  ])(
    "peeks the old stable $label preview on release without promoting one pending sample",
    ({ stableGroup, pendingGroup }) => {
      const initial = updateImageDropTargetHysteresis(
        EMPTY_IMAGE_DROP_TARGET_HYSTERESIS_STATE,
        target(0, 20, stableGroup),
      );
      const pending = updateImageDropTargetHysteresis(
        initial.state,
        target(1, 1, pendingGroup),
      );
      const released = peekImageDropTargetHysteresis(
        pending.state,
        target(1, 1, pendingGroup),
      );

      expect(released).toEqual(initial.target);
      expect(pending.state.pendingSamples).toBe(1);
      expect(pending.state.stable).toBe(initial.state.stable);
    },
  );

  it.each([
    { stableGroup: "group", nextGroup: "group", label: "same-group" },
    { stableGroup: "source", nextGroup: "target", label: "cross-group" },
  ])(
    "peeks the new stable $label preview after two movement samples",
    ({ stableGroup, nextGroup }) => {
      const initial = updateImageDropTargetHysteresis(
        EMPTY_IMAGE_DROP_TARGET_HYSTERESIS_STATE,
        target(0, 20, stableGroup),
      );
      const first = updateImageDropTargetHysteresis(
        initial.state,
        target(1, 1, nextGroup),
      );
      const second = updateImageDropTargetHysteresis(
        first.state,
        target(1, 2, nextGroup),
      );

      expect(peekImageDropTargetHysteresis(
        second.state,
        target(1, 2, nextGroup),
      )).toEqual(second.target);
      expect(second.target).toMatchObject({ groupId: nextGroup, index: 1 });
    },
  );

  it("returns outside on release without changing or advancing hysteresis", () => {
    const initial = updateImageDropTargetHysteresis(
      EMPTY_IMAGE_DROP_TARGET_HYSTERESIS_STATE,
      target(0, 20),
    );
    const pending = updateImageDropTargetHysteresis(
      initial.state,
      target(1, 1),
    );

    expect(peekImageDropTargetHysteresis(pending.state, null)).toBeNull();
    expect(pending.state).toMatchObject({
      stable: { groupId: "group", index: 0 },
      pending: { groupId: "group", index: 1 },
      pendingSamples: 1,
    });
  });
});

describe("image drag finalization", () => {
  it("rolls back to the exact snapshot identity on explicit cancel and outside", () => {
    const base = snapshot([
      { id: "source", images: [image("a")] },
      { id: "target", images: [] },
    ]);
    const drag = transaction(base, "source", 0);
    const projection = projectImageDrag(drag, {
      groupId: "target",
      index: 0,
    });
    const cancelled = finalizeImageDrag(drag, projection, {
      action: "cancel",
      currentRevision: 7,
    });
    const outside = finalizeImageDrag(drag, projectImageDrag(drag, null), {
      action: "commit",
      currentRevision: 7,
    });

    expect(cancelled).toMatchObject({ kind: "cancelled", reason: "explicit" });
    expect(outside).toMatchObject({ kind: "cancelled", reason: "outside" });
    expect(cancelled.groups).toBe(base.groups);
    expect(outside.groups).toBe(base.groups);
  });

  it("rejects a commit when the snapshot revision is stale", () => {
    const base = snapshot([{ id: "group", images: [image("a"), image("b")] }]);
    const drag = transaction(base, "group", 0);
    const result = finalizeImageDrag(
      drag,
      projectImageDrag(drag, { groupId: "group", index: 2 }),
      { action: "commit", currentRevision: 8 },
    );

    expect(result).toMatchObject({
      kind: "cancelled",
      reason: "stale-snapshot",
    });
    expect(result.groups).toBe(base.groups);
  });

  it("returns normalized commit arguments and projected groups", () => {
    const base = snapshot([{
      id: "group",
      images: [image("a"), image("b"), image("c")],
    }], "revision-1");
    const drag = transaction(base, "group", 0);
    const result = finalizeImageDrag(
      drag,
      projectImageDrag(drag, { groupId: "group", index: 3 }),
      { action: "commit", currentRevision: "revision-1" },
    );

    expect(result).toMatchObject({
      kind: "committed",
      commit: {
        fromGroupId: "group",
        imageId: "a",
        toGroupId: "group",
        toIndex: 2,
      },
    });
    expect(ids(result.groups, "group")).toEqual(["b", "c", "a"]);
  });

  it("commits a no-op without move arguments or new group identity", () => {
    const base = snapshot([{ id: "group", images: [image("a")] }]);
    const drag = transaction(base, "group", 0);
    const result = finalizeImageDrag(
      drag,
      projectImageDrag(drag, { groupId: "group", index: 1 }),
      { action: "commit", currentRevision: 7 },
    );

    expect(result).toMatchObject({ kind: "committed", commit: null });
    expect(result.groups).toBe(base.groups);
  });
});
