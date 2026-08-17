import { afterEach, describe, expect, it, vi } from "vitest";
import { browserWorkspaceDependencies } from "../../infrastructure/workspace/browserWorkspace";
import { createWorkspaceDependencies } from "./dependencies";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createWorkspaceDependencies", () => {
  it("uses the in-memory adapter for the end-to-end memory mode outside production", () => {
    vi.stubEnv("VITE_WORKSPACE_ADAPTER", "memory");
    vi.stubEnv("PROD", false);

    expect(createWorkspaceDependencies()).toBe(browserWorkspaceDependencies);
  });

  it("fails closed when the in-memory adapter is requested in a production build", () => {
    vi.stubEnv("VITE_WORKSPACE_ADAPTER", "memory");
    vi.stubEnv("PROD", true);

    expect(() => createWorkspaceDependencies()).toThrowError(
      /in-memory workspace adapter/i,
    );
  });

  it("builds production dependencies when the memory adapter is not requested", () => {
    vi.stubEnv("VITE_WORKSPACE_ADAPTER", "");
    vi.stubEnv("PROD", true);

    const dependencies = createWorkspaceDependencies();

    expect(dependencies).not.toBe(browserWorkspaceDependencies);
    expect(dependencies.service).toBeDefined();
    expect(dependencies.native.onMenuAction).toBeTypeOf("function");
    expect(dependencies.native.maximizeWindow).toBeTypeOf("function");
  });
});
