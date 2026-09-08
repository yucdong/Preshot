import type { MaterialEditImage } from "../../domain/library/models";
import type { ScreenCapture } from "../../domain/plan/ports";

const POLL_INTERVAL_MS = 250;
const CAPTURE_TIMEOUT_MS = 90_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function perform<T>(operation: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (cause) {
    throw new Error(`${operation}：${errorMessage(cause)}`, { cause });
  }
}

export async function captureMaterialEditImage(
  screenCapture: ScreenCapture,
  cancellation: Promise<void>,
  importImage: (path: string) => Promise<MaterialEditImage>,
): Promise<MaterialEditImage | null> {
  const failures: unknown[] = [];
  let cancelled = false;
  let active = true;
  let token: string | undefined;
  let capturedPath: string | undefined;
  let image: MaterialEditImage | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  const stopDeadline = () => {
    clearTimeout(deadline);
    deadline = undefined;
  };
  const stopped = () => cancelled || failures.length > 0;

  void cancellation.then(
    () => {
      if (!active) return;
      cancelled = true;
      stopDeadline();
      wake?.();
    },
    (cause: unknown) => {
      if (!active) return;
      failures.push(new Error(`无法确认截图取消状态：${errorMessage(cause)}`, { cause }));
      stopDeadline();
      wake?.();
    },
  );

  try {
    // Observe an already settled cancellation before opening the native overlay.
    await Promise.resolve();
    if (!stopped()) {
      deadline = setTimeout(() => {
        failures.push(new Error("截图等待超时（90 秒），请取消系统截图后重试"));
        wake?.();
      }, CAPTURE_TIMEOUT_MS);
      token = await perform("无法启动素材截图", () => screenCapture.start());
      while (!stopped()) {
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            wake = undefined;
            resolve();
          };
          const timer = setTimeout(finish, POLL_INTERVAL_MS);
          wake = finish;
        });
        if (stopped()) break;
        const currentToken = token;
        // Drain native operations even after cancellation/timeout: a late poll can own a PNG.
        const capture = await perform("无法读取素材截图", () => screenCapture.poll(currentToken));
        if (capture.status === "captured") {
          capturedPath = capture.path;
          stopDeadline();
          if (!stopped()) image = await importImage(capturedPath);
          break;
        }
      }
    }
  } catch (error) {
    failures.push(error);
  } finally {
    stopDeadline();
    try {
      if (capturedPath !== undefined) {
        const path = capturedPath;
        await perform("无法清理素材截图临时文件，请重试清理", () => screenCapture.discard(path));
      } else if (token !== undefined) {
        const currentToken = token;
        await perform("无法取消素材截图，请取消系统截图后重试", () => screenCapture.cancel(currentToken));
      }
    } catch (error) {
      failures.push(error);
    }
    active = false;
    wake = undefined;
  }

  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, failures.map(errorMessage).join("；"));
  }
  if (cancelled) return null;
  if (!image) throw new Error("素材截图未返回有效图片，请重试");
  return image;
}
