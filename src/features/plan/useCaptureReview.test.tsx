// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { ScreenCaptureReviewer } from "../../domain/plan/ports";
import { useCaptureReview } from "./useCaptureReview";

it("cancels pending reviews when their project becomes inactive and rejects later inactive requests", async () => {
  let review!: ScreenCaptureReviewer;
  function Fixture({ active }: { active: boolean }) {
    const result = useCaptureReview(active);
    review = result.reviewCapture;
    return result.captureReviewDialog;
  }
  const mounted = render(<Fixture active />);
  const image = { reason: "uniformDark" as const, previewUrl: "data:image/png;base64,AA" };
  const cancellation = new Promise<void>(() => {});
  let decision!: ReturnType<ScreenCaptureReviewer>;
  act(() => { decision = review(image, cancellation); });
  expect(screen.getByRole("dialog", { name: "检查截图" })).toBeVisible();
  mounted.rerender(<Fixture active={false} />);
  await expect(decision).resolves.toBe("cancel");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await expect(review(image, cancellation)).resolves.toBe("cancel");
});
