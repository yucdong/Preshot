import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlanDependencies } from "./planDependencies";

afterEach(() => vi.unstubAllEnvs());

describe("createPlanDependencies", () => {
  it("uses the in-memory service outside production", () => {
    vi.stubEnv("VITE_WORKSPACE_ADAPTER", "memory");
    vi.stubEnv("PROD", false);
    const deps = createPlanDependencies();
    expect(deps.service).toBeDefined();
    expect(deps.service.loadPlan).toBeDefined();
    expect(deps.service.savePlan).toBeDefined();
  });

  it("fails closed for the memory adapter in production", () => {
    vi.stubEnv("VITE_WORKSPACE_ADAPTER", "memory");
    vi.stubEnv("PROD", true);
    expect(() => createPlanDependencies()).toThrowError(/in-memory canvas plan adapter/i);
  });

  it("builds production dependencies by default", () => {
    vi.stubEnv("VITE_WORKSPACE_ADAPTER", "");
    const dependencies = createPlanDependencies();
    expect(dependencies.service).toBeDefined();
    expect(dependencies.picker).toBeDefined();
  });
});
