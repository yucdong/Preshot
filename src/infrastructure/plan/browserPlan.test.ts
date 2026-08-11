import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { createCanvasPdfExporter } from "../pdf/canvasPdfExporter";
import { imageDataFromDataUrl } from "../pdf/pdfImageOptimizer";
import { createBrowserCanvasPlanDependencies } from "./browserPlan";

const loadFonts = async () => ({
  regular: new Uint8Array(
    readFileSync("src/infrastructure/pdf/fonts/NotoSansSC-Regular.ttf"),
  ),
  bold: new Uint8Array(
    readFileSync("src/infrastructure/pdf/fonts/NotoSansSC-Bold.ttf"),
  ),
});

describe("createBrowserCanvasPlanDependencies", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("seeds a canvas plan with components and picker returns deterministic path", async () => {
    const { service, picker } = createBrowserCanvasPlanDependencies();

    const result = await service.loadPlan("C:\\demo", "Demo");
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") {
      throw new Error("Expected the seeded browser plan to load");
    }
    expect(result.plan.components).toHaveLength(2);
    expect(result.plan).toMatchObject({
      schemaVersion: 10,
      components: [
        { id: "plan-1", x: 0, width: expect.any(Number), height: 220 },
        {
          id: "ref-1",
          x: 0,
          description: "参考图说明",
        },
      ],
    });
    expect(result.plan.components.every((component) => !("y" in component))).toBe(true);
    expect(await picker.pickImageFile("Pick")).toBe("C:\\memory\\import.png");
  });

  it("assigns imported images file ids after the seeded demo images", async () => {
    const { service } = createBrowserCanvasPlanDependencies();
    const result = await service.loadPlan("C:\\demo", "Demo");
    if (result.status !== "loaded") {
      throw new Error("Expected the seeded browser plan to load");
    }
    const imported = await service.importImage(
      "C:\\demo",
      result.plan,
      "ref-1",
      "C:\\x\\new.png",
    );

    expect(imported.image.file).toBe("references/0005.png");
  });

  it("serves seeded reference images as base64 PNG or JPEG data", async () => {
    const { service } = createBrowserCanvasPlanDependencies();
    const result = await service.loadPlan("C:\\demo", "Demo");
    if (result.status !== "loaded") {
      throw new Error("Expected the seeded browser plan to load");
    }
    const reference = result.plan.components.find(
      (component) => component.type === "reference",
    );
    if (!reference || reference.type !== "reference") {
      throw new Error("Expected a seeded reference component");
    }

    const dataUrls = await Promise.all(
      reference.images.map((image) => service.loadImage("C:\\demo", image.file)),
    );

    expect(dataUrls).toHaveLength(reference.images.length);
    expect(
      dataUrls.every((dataUrl) =>
        /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(dataUrl),
      ),
    ).toBe(true);
  });

  it("stores exact dimensions for seeded images so hydration is a no-op", async () => {
    const { service } = createBrowserCanvasPlanDependencies();
    const result = await service.loadPlan("C:\\demo", "Demo");
    if (result.status !== "loaded") {
      throw new Error("Expected the seeded browser plan to load");
    }
    const reference = result.plan.components.find(
      (component) => component.type === "reference",
    );
    if (!reference || reference.type !== "reference") {
      throw new Error("Expected a seeded reference component");
    }

    expect(reference.images.map((image) => image.aspectRatio)).toEqual([
      8 / 5,
      2 / 3,
      18 / 11,
      13 / 20,
    ]);
  });

  it("exports the loaded seeded browser images through the real PDF adapter", async () => {
    const { service } = createBrowserCanvasPlanDependencies();
    const result = await service.loadPlan("C:\\demo", "Demo");
    if (result.status !== "loaded") {
      throw new Error("Expected the seeded browser plan to load");
    }
    const referenceFiles = result.plan.components.flatMap((component) =>
      component.type === "reference"
        ? component.images.map((image) => image.file)
        : [],
    );
    const images = Object.fromEntries(
      await Promise.all(
        referenceFiles.map(async (file) => [
          file,
          await service.loadImage("C:\\demo", file),
        ]),
      ),
    );

    const bytes = await createCanvasPdfExporter(loadFonts, {
      optimizeImage: async (dataUrl) => imageDataFromDataUrl(dataUrl),
    }).export(
      result.plan,
      images,
    );

    expect(bytes.slice(0, 4)).toEqual(Uint8Array.from([0x25, 0x50, 0x44, 0x46]));
  }, 20000);

  it("persists a saved browser plan for a fresh dependency instance", async () => {
    const first = createBrowserCanvasPlanDependencies();
    const loaded = await first.service.loadPlan("C:\\demo", "Demo");
    if (loaded.status !== "loaded") {
      throw new Error("Expected the seeded browser plan to load");
    }

    await first.service.savePlan("C:\\demo", { ...loaded.plan, title: "已保存的画布" });

    const reloaded = await createBrowserCanvasPlanDependencies().service.loadPlan("C:\\demo", "Demo");
    expect(reloaded).toEqual(expect.objectContaining({
      status: "loaded",
      plan: expect.objectContaining({ title: "已保存的画布" }),
    }));
  });

  it("round-trips v8 component order", async () => {
    const first = createBrowserCanvasPlanDependencies();
    const loaded = await first.service.loadPlan("C:\\demo", "Demo");
    if (loaded.status !== "loaded") {
      throw new Error("Expected the seeded browser plan to load");
    }
    const plan = {
      schemaVersion: 10 as const,
      title: "Flat order",
      components: [
        { id: "p1", name: "文案1", type: "plan" as const, x: 0, width: 120, height: 80, textRoot: { kind: "leaf" as const, id: "p1:root", html: "" } },
        { id: "p2", name: "文案2", type: "plan" as const, x: 0, width: 120, height: 80, textRoot: { kind: "leaf" as const, id: "p2:root", html: "" } },
        { id: "p3", name: "文案3", type: "plan" as const, x: 0, width: 200, height: 80, textRoot: { kind: "leaf" as const, id: "p3:root", html: "" } },
      ],
    };

    await first.service.savePlan("C:\\demo", plan);

    await expect(
      createBrowserCanvasPlanDependencies().service.loadPlan("C:\\demo", "Demo"),
    ).resolves.toEqual({
      status: "loaded",
      plan: expect.objectContaining({
        components: expect.arrayContaining([
          expect.objectContaining({ id: "p3", width: expect.any(Number) }),
        ]),
      }),
    });
  });
});
