import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectLoadingScreen } from "./ProjectLoadingScreen";

function displayedProgress() {
  return Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));
}

function advance(milliseconds: number) {
  act(() => {
    vi.advanceTimersByTime(milliseconds);
  });
}

function finishInterpolation() {
  for (let frame = 0; frame < 45 && displayedProgress() < 100; frame += 1) {
    act(() => {
      vi.advanceTimersToNextFrame();
    });
  }
  expect(displayedProgress()).toBe(100);
}

describe("ProjectLoadingScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts at zero, focuses the project heading and exposes the approved stages", () => {
    render(
      <ProjectLoadingScreen projectName="夜景摆设" progress={68} onComplete={vi.fn()} />,
    );

    expect(screen.getByRole("heading", { name: "夜景摆设" })).toHaveFocus();
    expect(screen.getByRole("heading", { name: "夜景摆设" })).toHaveAttribute("tabindex", "-1");
    const bar = screen.getByRole("progressbar", { name: "项目加载进度" });
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByTestId("project-loading-screen")).toBe(
      screen.getByRole("region", { name: "项目加载" }),
    );
    expect(screen.getByTestId("project-loading-fill")).toHaveStyle({ transform: "scaleX(0)" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("正在准备项目…");
    const stages = within(screen.getByRole("list", { name: "加载阶段" })).getAllByRole("listitem");
    expect(stages.map((stage) => stage.textContent)).toEqual(["准备", "方案", "图片", "画布"]);
    expect(stages[0]).toHaveAttribute("aria-current", "step");
  });

  it("only interpolates toward real targets and never rounds a sub-100 target up to completion", () => {
    const onComplete = vi.fn();
    const { rerender } = render(
      <ProjectLoadingScreen projectName="夜景摆设" progress={40} onComplete={onComplete} />,
    );

    advance(96);
    expect(displayedProgress()).toBeGreaterThan(0);
    expect(displayedProgress()).toBeLessThan(40);
    advance(700);
    expect(displayedProgress()).toBe(40);
    expect(screen.getByTestId("project-loading-fill")).toHaveStyle({ transform: "scaleX(0.4)" });
    advance(20_000);
    expect(displayedProgress()).toBe(40);

    rerender(
      <ProjectLoadingScreen projectName="夜景摆设" progress={99.9} onComplete={onComplete} />,
    );
    let previous = displayedProgress();
    for (let frame = 0; frame < 45; frame += 1) {
      act(() => vi.advanceTimersToNextFrame());
      expect(displayedProgress()).toBeGreaterThanOrEqual(previous);
      expect(displayedProgress()).toBeLessThan(100);
      previous = displayedProgress();
    }
    advance(20_000);
    expect(displayedProgress()).toBe(99);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("uses one animation-frame clock even when the ambient performance clock has another origin", () => {
    vi.spyOn(performance, "now").mockReturnValue(50_000);
    render(
      <ProjectLoadingScreen projectName="夜景摆设" progress={70} onComplete={vi.fn()} />,
    );
    advance(96);
    expect(displayedProgress()).toBeGreaterThanOrEqual(0);
    advance(700);
    expect(displayedProgress()).toBe(70);
  });

  it("announces stage changes without announcing percentage or status detail ticks", () => {
    const onComplete = vi.fn();
    const { rerender } = render(
      <ProjectLoadingScreen projectName="夜景摆设" progress={35} onComplete={onComplete} />,
    );
    advance(700);
    const announcement = screen.getByRole("status");
    expect(announcement).toHaveTextContent("正在加载参考图片…");
    expect(announcement).not.toHaveTextContent("%");
    const stageText = announcement.textContent;

    rerender(
      <ProjectLoadingScreen
        projectName="夜景摆设"
        progress={65}
        statusText="已读取 3 / 5 张参考图片"
        onComplete={onComplete}
      />,
    );
    advance(700);
    expect(announcement.textContent).toBe(stageText);
    expect(screen.getByText("已读取 3 / 5 张参考图片")).toBeVisible();
    expect(screen.getByText("图片").closest("li")).toHaveAttribute("aria-current", "step");

    rerender(
      <ProjectLoadingScreen projectName="夜景摆设" progress={90} onComplete={onComplete} />,
    );
    advance(700);
    expect(announcement).toHaveTextContent("正在整理画布…");
  });

  it("holds displayed 100 for 450ms, fades for 180ms and completes exactly once", () => {
    const onComplete = vi.fn();
    const { rerender } = render(
      <ProjectLoadingScreen projectName="夜景摆设" progress={100} onComplete={onComplete} />,
    );
    const view = screen.getByRole("region", { name: "项目加载" });
    finishInterpolation();
    expect(screen.getByText("项目已就绪")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("已准备就绪");
    expect(view).toHaveAttribute("data-state", "complete");

    advance(449);
    expect(view).toHaveAttribute("data-state", "complete");
    expect(onComplete).not.toHaveBeenCalled();
    advance(1);
    expect(view).toHaveAttribute("data-state", "leaving");
    advance(179);
    expect(onComplete).not.toHaveBeenCalled();
    advance(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(view).toBeInTheDocument();

    rerender(
      <ProjectLoadingScreen
        projectName="夜景摆设"
        progress={100}
        statusText="画布已经准备好"
        onComplete={onComplete}
      />,
    );
    advance(5_000);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("uses replacement completion callbacks without restarting interpolation or the hold", () => {
    const original = vi.fn();
    const replacement = vi.fn();
    const latest = vi.fn();
    const { rerender } = render(
      <ProjectLoadingScreen projectName="夜景摆设" progress={100} onComplete={original} />,
    );
    advance(400);
    const current = displayedProgress();
    rerender(
      <ProjectLoadingScreen projectName="夜景摆设" progress={100} onComplete={replacement} />,
    );
    expect(displayedProgress()).toBe(current);
    advance(300);
    expect(displayedProgress()).toBe(100);
    advance(300);
    rerender(
      <ProjectLoadingScreen projectName="夜景摆设" progress={100} onComplete={latest} />,
    );
    advance(330);
    expect(original).not.toHaveBeenCalled();
    expect(replacement).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it("freezes interpolation on error, including when the parent subsequently reports 100", () => {
    const onComplete = vi.fn();
    const { rerender } = render(
      <ProjectLoadingScreen projectName="夜景摆设" progress={80} onComplete={onComplete} />,
    );
    advance(96);
    const frozen = displayedProgress();
    rerender(
      <ProjectLoadingScreen
        projectName="夜景摆设"
        progress={100}
        error="参考图片读取失败，请检查项目文件后重试。"
        onComplete={onComplete}
      />,
    );
    advance(5_000);
    expect(displayedProgress()).toBe(frozen);
    expect(screen.getByRole("alert")).toHaveTextContent("请检查项目文件后重试");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert").tagName).toBe("P");
    expect(screen.queryByRole("button", { name: "重试加载" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "项目加载" })).toHaveAttribute("data-state", "error");
    expect(onComplete).not.toHaveBeenCalled();
  });

  it.each([200, 500])("cancels completion when an error arrives %ims after displayed 100", (delay) => {
    const onComplete = vi.fn();
    const { rerender } = render(
      <ProjectLoadingScreen projectName="夜景摆设" progress={100} onComplete={onComplete} />,
    );
    finishInterpolation();
    advance(delay);
    rerender(
      <ProjectLoadingScreen
        projectName="夜景摆设"
        progress={100}
        error="画布初始化失败，请重试。"
        onComplete={onComplete}
      />,
    );
    advance(5_000);
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.getByRole("region", { name: "项目加载" })).toHaveAttribute("data-state", "error");
    expect(displayedProgress()).toBe(100);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("exposes retry only on error and invokes the supplied callback without resetting progress itself", () => {
    const onRetry = vi.fn();
    const onComplete = vi.fn();
    const { rerender } = render(
      <ProjectLoadingScreen projectName="夜景摆设" progress={60} onRetry={onRetry} onComplete={onComplete} />,
    );
    advance(700);
    expect(screen.queryByRole("button", { name: "重试加载" })).not.toBeInTheDocument();
    rerender(
      <ProjectLoadingScreen
        projectName="夜景摆设"
        progress={60}
        error="图片读取失败，请重试。"
        onRetry={onRetry}
        onComplete={onComplete}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "重试加载" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(displayedProgress()).toBe(60);
    expect(screen.getByRole("alert")).toBeVisible();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("completes once in StrictMode after the complete hold and fade", () => {
    const onComplete = vi.fn();
    render(
      <StrictMode>
        <ProjectLoadingScreen projectName="棚拍人像" progress={100} onComplete={onComplete} />
      </StrictMode>,
    );
    expect(displayedProgress()).toBe(0);
    finishInterpolation();
    advance(630);
    advance(5_000);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it.each(["interpolation", "hold", "fade"])("cancels pending work on unmount during %s", (phase) => {
    const onComplete = vi.fn();
    const { unmount } = render(
      <ProjectLoadingScreen projectName="夜景摆设" progress={100} onComplete={onComplete} />,
    );
    if (phase === "interpolation") {
      advance(96);
    } else {
      finishInterpolation();
      advance(phase === "hold" ? 200 : 500);
    }
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    advance(5_000);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("preserves truthful progress and the hold while skipping fade for reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    }));
    const onComplete = vi.fn();
    const { rerender } = render(
      <ProjectLoadingScreen projectName="夜景摆设" progress={99} onComplete={onComplete} />,
    );
    advance(5_000);
    expect(displayedProgress()).toBe(99);
    expect(onComplete).not.toHaveBeenCalled();
    rerender(
      <ProjectLoadingScreen projectName="夜景摆设" progress={100} onComplete={onComplete} />,
    );
    finishInterpolation();
    advance(449);
    expect(onComplete).not.toHaveBeenCalled();
    advance(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("region", { name: "项目加载" })).not.toHaveAttribute("data-state", "leaving");
  });
});
