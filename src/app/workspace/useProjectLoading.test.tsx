import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useProjectLoading } from "./useProjectLoading";

describe("project loading ownership", () => {
  it("starts at zero, caps incomplete progress and only finishes after readiness", () => {
    const { result } = renderHook(useProjectLoading);
    let id = 0;
    act(() => { id = result.current.begin("project", "Project"); });
    expect(result.current.attempt?.percent).toBe(0);
    act(() => result.current.report(id, "project", { status: "ready" }));
    expect(result.current.attempt?.percent).toBe(0);
    act(() => { result.current.activate(id, "Project"); });
    act(() => result.current.report(id, "project", { status: "loading", percent: 100 }));
    expect(result.current.attempt?.percent).toBe(97);
    act(() => result.current.finish(id));
    expect(result.current.attempt).not.toBeNull();
    act(() => result.current.report(id, "project", { status: "loading", percent: 30 }));
    expect(result.current.attempt?.percent).toBe(97);
    act(() => result.current.report(id, "project", { status: "ready" }));
    act(() => result.current.finish(id));
    expect(result.current.attempt).toBeNull();
  });

  it("retains failures and rejects late callbacks, completion timers and wrong paths", () => {
    const { result } = renderHook(useProjectLoading);
    let oldId = 0;
    let newId = 0;
    act(() => { oldId = result.current.begin("old", "Old"); });
    act(() => { newId = result.current.begin("new", "New"); });
    act(() => { result.current.activate(newId, "New"); });
    act(() => result.current.report(oldId, "old", { status: "ready" }));
    act(() => result.current.report(newId, "old", { status: "ready" }));
    act(() => result.current.finish(oldId));
    expect(result.current.attempt?.percent).toBe(12);
    act(() => result.current.report(newId, "new", { status: "failed", message: "Cannot read images" }));
    act(() => result.current.report(newId, "new", { status: "ready" }));
    act(() => result.current.finish(newId));
    expect(result.current.attempt?.error).toBe("Cannot read images");
    expect(result.current.isPending()).toBe(false);
    act(() => result.current.cancel());
    expect(result.current.attempt).toBeNull();
  });

  it("adopts the native resolved path and retires callbacks on unmount", () => {
    const { result, unmount } = renderHook(useProjectLoading);
    let id = 0;
    act(() => { id = result.current.begin("selected", "Selected"); });
    act(() => { result.current.activate(id, "Resolved", "canonical"); });
    act(() => result.current.report(id, "selected", { status: "ready" }));
    expect(result.current.attempt?.percent).toBe(12);
    act(() => result.current.report(id, "canonical", { status: "ready" }));
    expect(result.current.attempt?.percent).toBe(100);
    const controller = result.current;
    unmount();
    expect(controller.isPending()).toBe(false);
    controller.report(id, "canonical", { status: "ready" });
    expect(controller.isPending()).toBe(false);
  });
});
