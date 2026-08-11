// @vitest-environment jsdom
import { act, fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PlanTextComponent } from "../../../domain/plan/canvas/models";
import type { PlanMeasurement } from "./usePlanContentMeasurement";
import { PlanTextComponentView } from "./PlanTextComponentView";

const viewState = vi.hoisted(() => ({
  blockCallback: null as null | ((sourceHtml: string, blocks: string[]) => void),
  measurementCallback: null as null | ((id: string, measurement: PlanMeasurement) => void),
}));

vi.mock("../RichTextEditor", () => ({
  RichTextEditor: (props: {
    onBlockHtmlChange?(sourceHtml: string, blocks: string[]): void;
  }) => {
    viewState.blockCallback = props.onBlockHtmlChange ?? null;
    return <div />;
  },
}));

vi.mock("./useNaturalHeight", () => ({
  useNaturalHeight: () => ({ current: null }),
}));

vi.mock("./usePlanContentMeasurement", () => ({
  usePlanContentMeasurement: (input: {
    onMeasure(id: string, measurement: PlanMeasurement): void;
  }) => {
    viewState.measurementCallback = input.onMeasure;
    return { rootRef: { current: null } };
  },
}));

function component(html: string): PlanTextComponent {
  return {
    id: "plan",
    name: "Plan",
    type: "plan",
    x: 0,
    width: 300,
    height: 220,
    textRoot: { kind: "leaf", id: "plan:root", html },
  };
}

function measurement(): PlanMeasurement {
  return {
    heightPoints: 120,
    pageBreakBeforeBlockIds: [],
    blockHeightsPoints: [50, 50],
  };
}

describe("PlanTextComponentView", () => {
  it("keeps delete rightmost and removes a leaf only after confirmation", () => {
    const onRemoveLeaf = vi.fn();
    const onUndo = vi.fn();
    const splitComponent: PlanTextComponent = {
      ...component("<p>Left</p>"),
      textRoot: {
        kind: "split",
        id: "split",
        direction: "columns",
        gap: 10,
        children: [
          { kind: "leaf", id: "left", html: "<p>Left</p>" },
          { kind: "leaf", id: "right", html: "<p>Right</p>" },
        ],
      },
    };
    const view = render(
      <PlanTextComponentView
        component={splitComponent}
        onChangeHtml={vi.fn()}
        onRemoveLeaf={onRemoveLeaf}
        onUndo={onUndo}
        scale={1}
      />,
    );
    const leftLeaf = view.container.querySelector('[data-text-leaf-id="left"]');
    expect(leftLeaf).not.toBeNull();
    const controls = within(leftLeaf as HTMLElement).getAllByRole("button");
    expect(controls.map((button) => button.getAttribute("aria-label"))).toEqual([
      "左右拆分当前文案",
      "上下拆分当前文案",
      "删除当前子文案",
    ]);

    fireEvent.click(controls[2]);
    expect(onRemoveLeaf).not.toHaveBeenCalled();
    const dialog = view.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(onRemoveLeaf).not.toHaveBeenCalled();

    fireEvent.click(controls[2]);
    fireEvent.click(within(view.getByRole("dialog")).getByRole("button", { name: "删除" }));
    expect(onRemoveLeaf).toHaveBeenCalledWith("plan", "left");
    expect(view.getByRole("status")).toHaveTextContent("已删除子文案");
    fireEvent.click(view.getByRole("button", { name: "撤销" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("applies persisted content scale while compensating the editor width", () => {
    const scaled = { ...component("<p>Scaled</p>"), contentScale: 0.7 };
    const { getByTestId } = render(
      <PlanTextComponentView
        component={scaled}
        onChangeHtml={vi.fn()}
        scale={1}
      />,
    );

    expect(getByTestId("plan-text-scale")).toHaveStyle({
      zoom: "0.7",
      width: `${100 / 0.7}%`,
    });
  });

  it("does not pair stale block HTML with a newer component generation", () => {
    const onMeasure = vi.fn();
    const oldHtml = "<p>Old one</p><p>Old two</p>";
    const newHtml = "<p>New one</p><p>New two</p>";
    const { rerender } = render(
      <PlanTextComponentView
        component={component(oldHtml)}
        onChangeHtml={vi.fn()}
        onMeasure={onMeasure}
        scale={1}
      />,
    );

    act(() => {
      viewState.blockCallback?.(oldHtml, ["<p>Old one</p>", "<p>Old two</p>"]);
      viewState.measurementCallback?.("plan", measurement());
    });
    expect(onMeasure).toHaveBeenCalledWith(
      "plan",
      expect.objectContaining({ sourceHtml: oldHtml }),
    );

    onMeasure.mockClear();
    rerender(
      <PlanTextComponentView
        component={component(newHtml)}
        onChangeHtml={vi.fn()}
        onMeasure={onMeasure}
        scale={1}
      />,
    );
    act(() => {
      viewState.measurementCallback?.("plan", measurement());
    });

    expect(onMeasure.mock.calls.some(([, value]) => value.sourceHtml === newHtml)).toBe(false);
  });
});