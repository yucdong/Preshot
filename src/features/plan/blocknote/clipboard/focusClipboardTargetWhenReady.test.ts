// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { focusClipboardTargetWhenReady } from "./focusClipboardTargetWhenReady";

const disposers: Array<() => void> = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  document.body.replaceChildren();
});

function setup(locked = true) {
  const outer = document.createElement("div");
  const inner = document.createElement("div");
  const root = document.createElement("div");
  outer.append(inner);
  inner.append(root);
  document.body.append(outer);
  if (locked) inner.setAttribute("inert", "");
  const focus = vi.fn();
  const dispose = focusClipboardTargetWhenReady(root, focus);
  disposers.push(dispose);
  return { outer, inner, root, focus, dispose };
}

describe("focusClipboardTargetWhenReady", () => {
  it("focuses unlocked content synchronously and once", () => {
    const { focus, inner } = setup(false);
    expect(focus).toHaveBeenCalledOnce();
    inner.setAttribute("inert", "");
    inner.removeAttribute("inert");
    expect(focus).toHaveBeenCalledOnce();
  });

  it("waits until every inert ancestor unlocks without polling", async () => {
    const { outer, inner, focus } = setup();
    outer.setAttribute("inert", "");
    inner.removeAttribute("inert");
    await Promise.resolve();
    expect(focus).not.toHaveBeenCalled();
    outer.removeAttribute("inert");
    await Promise.resolve();
    expect(focus).toHaveBeenCalledOnce();
    outer.setAttribute("inert", "");
    outer.removeAttribute("inert");
    await Promise.resolve();
    expect(focus).toHaveBeenCalledOnce();
  });

  it.each(["pointerdown", "keydown", "focusin"])("yields to a newer %s rather than reclaiming focus", async (type) => {
    const { inner, focus } = setup();
    document.body.dispatchEvent(new Event(type, { bubbles: true }));
    inner.removeAttribute("inert");
    await Promise.resolve();
    expect(focus).not.toHaveBeenCalled();
  });

  it("cleans up retired requests and detached targets", async () => {
    const retired = setup();
    retired.dispose();
    retired.inner.removeAttribute("inert");
    const detached = setup();
    detached.root.remove();
    detached.inner.removeAttribute("inert");
    await Promise.resolve();
    expect(retired.focus).not.toHaveBeenCalled();
    expect(detached.focus).not.toHaveBeenCalled();
  });
});
