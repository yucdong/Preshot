// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PropArtifact } from "../../../domain/plan/canvas/blockDocument";
import { ArtifactContentRegions } from "./ArtifactContentRegions";

const artifact: PropArtifact = { id: "prop", kind: "prop", revision: 0, title: "透明伞", source: "拍摄道具", gallery: { id: "images", images: [] } };
const children = [<p key="text">拍摄说明</p>, <div key="images">道具图片</div>];

afterEach(cleanup);
describe("card height transactions", () => {
  it("commits the final divider position instead of the previous move event", () => {
    const update = vi.fn();
    const view = render(<ArtifactContentRegions artifact={artifact} update={update}>{children}</ArtifactContentRegions>);
    const regions = view.container.querySelector<HTMLElement>("[data-card-orientation]")!;
    vi.spyOn(regions, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 400));
    const divider = screen.getByRole("separator", { name: "调整图文比例" });
    fireEvent.pointerDown(divider, { button: 0, pointerId: 1, clientY: 160 });
    fireEvent.pointerMove(document, { pointerId: 1, clientY: 200 });
    expect(update).not.toHaveBeenCalled();
    fireEvent.pointerUp(document, { pointerId: 1, clientY: 300 });
    expect(update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      contentLayout: expect.objectContaining({ textShare: 0.75 }),
    }));
  });

  it.each(["blur", "inactive"] as const)("cancels divider movement on %s", reason => {
    const update = vi.fn();
    const view = render(<ArtifactContentRegions artifact={artifact} update={update}>{children}</ArtifactContentRegions>);
    const regions = view.container.querySelector<HTMLElement>("[data-card-orientation]")!;
    vi.spyOn(regions, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 400));
    fireEvent.pointerDown(screen.getByRole("separator"), { button: 0, pointerId: 1, clientY: 160 });
    fireEvent.pointerMove(document, { pointerId: 1, clientY: 200 });
    if (reason === "blur") fireEvent(window, new Event("blur"));
    else view.container.setAttribute("inert", "");
    fireEvent.pointerUp(document, { pointerId: 1, clientY: 300 });
    expect(update).not.toHaveBeenCalled();
  });

  it("moves the divider in the requested keyboard direction after swapping image and text", () => {
    const update = vi.fn();
    render(<ArtifactContentRegions artifact={{ ...artifact, contentLayout: {
      orientation: "horizontal", textFirst: false, textShare: 0.4, minHeight: 160,
    } }} update={update}>{children}</ArtifactContentRegions>);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowLeft" });
    expect(update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      contentLayout: expect.objectContaining({ textShare: 0.45 }),
    }));
  });

  it.each(["escape", "pointercancel", "blur"])("discards a height preview on %s", reason => {
    const update = vi.fn();
    render(<ArtifactContentRegions artifact={artifact} update={update}>{children}</ArtifactContentRegions>);
    const slider = screen.getByRole("slider", { name: "区域高度" });
    const before = (slider as HTMLInputElement).value;
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: "600" } });
    if (reason === "escape") {
      fireEvent.keyDown(slider, { key: "Escape" });
      fireEvent.keyUp(slider, { key: "Escape" });
    } else if (reason === "pointercancel") fireEvent.pointerCancel(slider);
    else fireEvent.blur(slider);
    fireEvent.pointerUp(slider);
    expect(update).not.toHaveBeenCalled();
    expect(slider).toHaveValue(before);
  });

  it("commits one final height and preserves concurrent artifact updates", () => {
    const update = vi.fn();
    const view = render(<ArtifactContentRegions artifact={artifact} update={update}>{children}</ArtifactContentRegions>);
    const slider = screen.getByRole("slider", { name: "区域高度" });
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: "600" } });
    fireEvent.change(slider, { target: { value: "700" } });
    fireEvent.pointerUp(slider);
    fireEvent.blur(slider);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].contentLayout.minHeight).toBe(700);
    update.mockClear();
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: "800" } });
    view.rerender(<ArtifactContentRegions artifact={{ ...artifact, source: "另一次已提交的修改" }} update={update}>{children}</ArtifactContentRegions>);
    fireEvent.pointerUp(slider);
    expect(update).not.toHaveBeenCalled();
  });
});
