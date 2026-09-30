import { useCallback, useEffect, useRef, useState } from "react";
import type { ScreenCaptureReviewer } from "../../domain/plan/ports";
import { CaptureReviewDialog, type CaptureReviewRequest as Request } from "./CaptureReviewDialog";

type Decision = "keep" | "retry" | "cancel";

export function useCaptureReview(enabled = true) {
  const [request, setRequest] = useState<Request | null>(null);
  const pending = useRef<Request | null>(null);
  const mounted = useRef(true);
  const available = useRef(enabled);
  useEffect(() => {
    available.current = enabled;
    if (!enabled) pending.current?.finish("cancel");
  }, [enabled]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.finish("cancel"); }; }, []);
  const reviewCapture = useCallback<ScreenCaptureReviewer>((image, cancellation) => {
    if (!mounted.current || !available.current) return Promise.resolve("cancel");
    pending.current?.finish("cancel");
    return new Promise<Decision>(resolve => {
      const next: Request = { image, finish(value) {
        if (pending.current !== next) return;
        pending.current = null;
        if (mounted.current) setRequest(null);
        resolve(value);
      } };
      pending.current = next;
      setRequest(next);
      void cancellation.then(() => next.finish("cancel"), () => next.finish("cancel"));
    });
  }, []);
  return { reviewCapture, captureReviewDialog: request ? <CaptureReviewDialog request={request} /> : null };
}
