import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { workspaceLogger, planLogger } from "./logger";

function parseLoggedEntry(spy: ReturnType<typeof vi.spyOn>) {
  expect(spy).toHaveBeenCalledTimes(1);
  const [entry] = spy.mock.calls[0] ?? [];
  expect(typeof entry).toBe("string");
  return JSON.parse(String(entry)) as {
    timestamp: string;
    level: string;
    service: string;
    message: string;
    data: Record<string, unknown>;
  };
}

describe("workspaceLogger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T10:00:00.000Z"));
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    ["debug", "DEBUG", "console.debug"],
    ["info", "INFO", "console.info"],
    ["warn", "WARN", "console.warn"],
    ["error", "ERROR", "console.error"],
  ] as const)(
    "writes %s entries to the matching console sink",
    (method, level, sinkName) => {
      workspaceLogger[method]("Workspace event", { projectId: "project-1" });

      const sink =
        sinkName === "console.debug"
          ? console.debug
          : sinkName === "console.info"
            ? console.info
            : sinkName === "console.warn"
              ? console.warn
              : console.error;
      const entry = parseLoggedEntry(sink as ReturnType<typeof vi.spyOn>);

      expect(entry).toEqual({
        timestamp: "2026-07-27T10:00:00.000Z",
        level,
        service: "workspace-service",
        message: "Workspace event",
        data: {
          projectId: "project-1",
        },
      });
    },
  );

  it("redacts sensitive fields and error stacks recursively", () => {
    workspaceLogger.error("Workspace failure", {
      rollbackToken: "secret-token",
      coverDataUrl: "data:image/png;base64,secret",
      nested: {
        rollbackToken: "nested-secret-token",
        coverDataUrl: "data:image/png;base64,nested",
        failure: new Error("boom"),
      },
      failures: [
        {
          rollbackToken: "array-secret-token",
          coverDataUrl: "data:image/png;base64,array",
          failure: new Error("array-boom"),
        },
      ],
    });

    const entry = parseLoggedEntry(console.error as ReturnType<typeof vi.spyOn>);

    expect(entry.data).not.toHaveProperty("rollbackToken");
    expect(entry.data).not.toHaveProperty("coverDataUrl");
    expect(entry.data).toMatchObject({
      nested: {
        failure: {
          name: "Error",
          message: "boom",
        },
      },
      failures: [
        {
          failure: {
            name: "Error",
            message: "array-boom",
          },
        },
      ],
    });
    expect(
      JSON.stringify(entry),
    ).not.toContain("data:image/png;base64");
    expect(JSON.stringify(entry)).not.toContain("secret-token");
    expect(JSON.stringify(entry)).not.toContain("stack");
  });
});

describe("planLogger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T10:00:00.000Z"));
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("tags entries with the plan-service name", () => {
    planLogger.info("Plan event", { groupId: "g1" });
    const [entry] = (console.info as ReturnType<typeof vi.spyOn>).mock.calls[0] ?? [];
    expect(JSON.parse(String(entry))).toMatchObject({
      service: "plan-service",
      message: "Plan event",
      data: { groupId: "g1" },
    });
  });
});
