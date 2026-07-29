import { afterEach, describe, expect, it, vi } from "vitest";
import { browserPlanDependencies } from "../../infrastructure/plan/browserPlan";
import { createPlanDependencies } from "./planDependencies";

afterEach(() => vi.unstubAllEnvs());

describe("createPlanDependencies", () => {
  it("uses the in-memory service outside production", () => {
    vi.stubEnv("VITE_WORKSPACE_ADAPTER", "memory");
    vi.stubEnv("PROD", false);
    expect(createPlanDependencies().service).toBe(browserPlanDependencies.service);
  });

  it("fails closed for the memory adapter in production", () => {
    vi.stubEnv("VITE_WORKSPACE_ADAPTER", "memory");
    vi.stubEnv("PROD", true);
    expect(() => createPlanDependencies()).toThrowError(/in-memory plan adapter/i);
  });

  it("builds production dependencies by default", () => {
    vi.stubEnv("VITE_WORKSPACE_ADAPTER", "");
    const dependencies = createPlanDependencies();
    expect(dependencies.service).not.toBe(browserPlanDependencies.service);
    expect(dependencies.picker).toBeDefined();
  });
});
