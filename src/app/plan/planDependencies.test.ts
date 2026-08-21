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
    const [{ blockNoteLongImageExporter }, { browserLongImageSaveTarget }] =
      await Promise.all([
        import("../../infrastructure/longImage/BlockNoteLongImageExporter"),
        import("../../infrastructure/longImage/browserLongImageSave"),
      ]);
    const deps = createPlanDependencies();
    expect(deps.service).toBeDefined();
    expect(deps.service.loadPlan).toBeDefined();
    expect(deps.service.savePlan).toBeDefined();
    expect(deps.screenCapture).toBeDefined();
    expect(deps.exporter.implementation).toBe("react-pdf");
    expect(deps.docxExporter.implementation).toBe("blocknote-docx");
    expect(deps.longImageExporter).toBe(blockNoteLongImageExporter);
    expect(deps.longImageSaver).toBe(browserLongImageSaveTarget);
    expect(deps.saver.revealProjectDirectoryAfterSave).toBe(false);
    expect(deps.docxSaver.revealProjectDirectoryAfterSave).toBe(false);
    expect(deps.longImageSaver.revealProjectDirectoryAfterSave).toBe(false);
  }, DEPENDENCY_TEST_TIMEOUT);

  it("uses the React-PDF exporter for the Midscene browser path", async () => {
    vi.stubEnv("VITE_WORKSPACE_ADAPTER", "midscene");
    vi.stubEnv("PROD", false);
    const createPlanDependencies = await getCreatePlanDependencies();

    const dependencies = createPlanDependencies();
    expect(dependencies.exporter.implementation).toBe(
      "react-pdf",
    );
    expect(dependencies.docxExporter.implementation).toBe("blocknote-docx");
    expect(dependencies.longImageExporter).toBeDefined();
    expect(dependencies.saver.revealProjectDirectoryAfterSave).toBe(false);
    expect(dependencies.docxSaver.revealProjectDirectoryAfterSave).toBe(false);
    expect(dependencies.longImageSaver.revealProjectDirectoryAfterSave).toBe(
      false,
    );
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
    const [{ blockNoteLongImageExporter }, { tauriLongImageSaveTarget }] =
      await Promise.all([
        import("../../infrastructure/longImage/BlockNoteLongImageExporter"),
        import("../../infrastructure/longImage/tauriLongImageSave"),
      ]);
    const dependencies = createPlanDependencies();
    expect(dependencies.service).toBeDefined();
    expect(dependencies.picker).toBeDefined();
    expect(dependencies.screenCapture).toBeDefined();
    expect(dependencies.exporter.implementation).toBe("react-pdf");
    expect(dependencies.docxExporter.implementation).toBe("blocknote-docx");
    expect(dependencies.longImageExporter).toBe(blockNoteLongImageExporter);
    expect(dependencies.longImageSaver).toBe(tauriLongImageSaveTarget);
    expect(dependencies.saver.revealProjectDirectoryAfterSave).toBe(true);
    expect(dependencies.docxSaver.revealProjectDirectoryAfterSave).toBe(true);
    expect(dependencies.longImageSaver.revealProjectDirectoryAfterSave).toBe(
      true,
    );
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
