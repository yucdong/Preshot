import type { ScreenCapture } from "../../domain/plan/ports";

export function createBrowserScreenCapture(): ScreenCapture {
  const active = new Set<string>();
  let sequence = 0;

  return {
    async start() {
      const token = `browser-capture-${(sequence += 1)}`;
      active.add(token);
      return token;
    },
    async poll(token) {
      if (!active.delete(token)) {
        throw new Error("Unknown screen capture session");
      }
      return {
        status: "captured",
        path: String.raw`C:\memory\capture.png`,
      };
    },
    async cancel(token) {
      active.delete(token);
    },
  };
}
