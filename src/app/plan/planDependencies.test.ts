import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DEPENDENCY_TEST_TIMEOUT = 30_000;

async function getCreatePlanDependencies() {
  const { createPlanDependencies } = await import("./planDependencies");
  return createPlanDependencies;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createPlanDependencies", () => {
  it("uses the in-memory service outside production", async () => {
    vi.stubEnv("VITE_WORKSPACE_ADAPTER", "memory");
    vi.stubEnv("PROD", false);
    const createPlanDependencies = await getCreatePlanDependencies();
    const deps = createPlanDependencies();
    expect(deps.service).toBeDefined();
    expect(deps.service.loadPlan).toBeDefined();
    expect(deps.service.savePlan).toBeDefined();
    expect(deps.screenCapture).toBeDefined();
  }, DEPENDENCY_TEST_TIMEOUT);

  it("fails closed for the memory adapter in production", async () => {
    vi.stubEnv("VITE_WORKSPACE_ADAPTER", "memory");
    vi.stubEnv("PROD", true);
    const createPlanDependencies = await getCreatePlanDependencies();
    expect(() => createPlanDependencies()).toThrowError(/in-memory canvas plan adapter/i);
  }, DEPENDENCY_TEST_TIMEOUT);

  it("builds production dependencies by default", async () => {
    vi.stubEnv("VITE_WORKSPACE_ADAPTER", "");
    const createPlanDependencies = await getCreatePlanDependencies();
    const dependencies = createPlanDependencies();
    expect(dependencies.service).toBeDefined();
    expect(dependencies.picker).toBeDefined();
    expect(dependencies.screenCapture).toBeDefined();
  }, DEPENDENCY_TEST_TIMEOUT);

  it.each([
    ["unavailable", () => {
      Object.defineProperty(window, "sessionStorage", {
        configurable: true,
        get() {
          throw new Error("sessionStorage is unavailable");
        },
      });
    }],
    ["corrupt", () => {
      Object.defineProperty(window, "sessionStorage", {
        configurable: true,
        value: { getItem: () => "{" },
      });
    }],
  ])(
    "does not access %s browser storage while selecting production dependencies",
    async (_storageState, makeSessionStorageUnavailable) => {
      const originalSessionStorage = Object.getOwnPropertyDescriptor(window, "sessionStorage");
      if (!originalSessionStorage) {
        throw new Error("Expected sessionStorage to have a property descriptor");
      }

      makeSessionStorageUnavailable();
      vi.stubEnv("VITE_WORKSPACE_ADAPTER", "");
      vi.stubEnv("PROD", true);

      try {
        const createPlanDependencies = await getCreatePlanDependencies();

        expect(() => createPlanDependencies()).not.toThrow();

        vi.stubEnv("VITE_WORKSPACE_ADAPTER", "memory");
        expect(() => createPlanDependencies()).toThrowError(/in-memory canvas plan adapter/i);
      } finally {
        Object.defineProperty(window, "sessionStorage", originalSessionStorage);
      }
    },
    DEPENDENCY_TEST_TIMEOUT,
  );
});
