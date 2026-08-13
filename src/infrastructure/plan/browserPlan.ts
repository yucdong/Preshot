import type { ImportedImage, PlanImagePicker, ReferenceImageStore } from "../../domain/plan/ports";
import { planLogger } from "../../shared/logging/logger";
import { createCanvasPlanService, type CanvasPlanService } from "../../domain/plan/canvas/service";
import type { CanvasPlanRepository } from "../../domain/plan/canvas/ports";
import type { ProjectPlan as CanvasPlan } from "../../domain/plan/canvas/models";
import { DEFAULT_IMAGE_HEIGHT } from "../../domain/plan/canvas/models";
import { contentSize, DEFAULT_PAGE_GEOMETRY } from "../../domain/plan/canvas/geometry";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const LANDSCAPE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAFCAYAAAB4ka1VAAAAE0lEQVR4nGO4dvnif3yYYRAoAAC9iYrpFnTwwwAAAABJRU5ErkJggg==";
const PORTRAIT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR4nGN4/vTJfxBmwGAAACm0FhtaKTEiAAAAAElFTkSuQmCC";
const LANDSCAPE_ALT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAALCAYAAAByF90EAAAAGElEQVR4nGM4ffXhf2pghlGDRg0algYBAOFNtR/DIAz8AAAAAElFTkSuQmCC";
const PORTRAIT_ALT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA0AAAAUCAYAAABWMrcvAAAAGUlEQVR4nGP4euHff1Ixw6imUU2jmkaKJgAWpdE2a5HTWQAAAABJRU5ErkJggg==";
const SEEDED_IMAGE_DATA: Record<string, string> = {
  "references/0001.png": LANDSCAPE_PNG,
  "references/0002.png": PORTRAIT_PNG,
  "references/0003.png": LANDSCAPE_ALT_PNG,
  "references/0004.png": PORTRAIT_ALT_PNG,
};
const BROWSER_PLAN_STORAGE_KEY = "preshot.browser-canvas-plan";

const CANVAS_WIDTH = contentSize(DEFAULT_PAGE_GEOMETRY).width;

const SEEDED_V7_PLAN: CanvasPlan = {
  schemaVersion: 12,
  title: "日落大片",
  documentHtml:
    '<h2>日落大片</h2><p>海滨的黄金时刻。记得带 85mm 镜头。</p><h2>造型参考</h2><p>参考图说明</p><figure data-preshot-node="image-group" data-preshot-group-id="ref-1"></figure><p></p>',
  components: [
    {
      id: "ref-1",
      name: "造型参考",
      type: "reference",
      x: 0,
      width: CANVAS_WIDTH,
      height: 452,
      description: "",
      images: [
        {
          id: "img-1",
          file: "references/0001.png",
          aspectRatio: 8 / 5,
          frameWidth: DEFAULT_IMAGE_HEIGHT * (8 / 5),
          frameHeight: DEFAULT_IMAGE_HEIGHT,
        },
        {
          id: "img-2",
          file: "references/0002.png",
          aspectRatio: 2 / 3,
          frameWidth: DEFAULT_IMAGE_HEIGHT * (2 / 3),
          frameHeight: DEFAULT_IMAGE_HEIGHT,
        },
        {
          id: "img-3",
          file: "references/0003.png",
          aspectRatio: 18 / 11,
          frameWidth: DEFAULT_IMAGE_HEIGHT * (18 / 11),
          frameHeight: DEFAULT_IMAGE_HEIGHT,
        },
        {
          id: "img-4",
          file: "references/0004.png",
          aspectRatio: 13 / 20,
          frameWidth: DEFAULT_IMAGE_HEIGHT * (13 / 20),
          frameHeight: DEFAULT_IMAGE_HEIGHT,
        },
      ],
    },
  ],
};

function createMemoryCanvasStores(): {
  repository: CanvasPlanRepository;
  imageStore: ReferenceImageStore;
} {
  const storedPlan = window.sessionStorage.getItem(BROWSER_PLAN_STORAGE_KEY);
  let plan: CanvasPlan = storedPlan
    ? JSON.parse(storedPlan) as CanvasPlan
    : structuredClone(SEEDED_V7_PLAN);
  let counter = Object.keys(SEEDED_IMAGE_DATA).length;
  return {
    repository: {
      async loadRawPlan(_projectPath: string) {
        return structuredClone(plan);
      },
      async saveRawPlan(_projectPath, nextPlan) {
        plan = structuredClone(nextPlan);
        window.sessionStorage.setItem(BROWSER_PLAN_STORAGE_KEY, JSON.stringify(plan));
      },
    },
    imageStore: {
      async importImage(_projectPath: string, _sourcePath: string): Promise<ImportedImage> {
        counter += 1;
        return { file: `references/${String(counter).padStart(4, "0")}.png`, dataUrl: TINY_PNG };
      },
      async loadImage(_projectPath: string, _file: string) {
        return SEEDED_IMAGE_DATA[_file] ?? TINY_PNG;
      },
      async removeImage(_projectPath: string, _file: string) {
        return undefined;
      },
    },
  };
}

const memoryPicker: PlanImagePicker = {
  async pickImageFile(_title: string) {
    return "C:\\memory\\import.png";
  },
  async pickImageFiles(_title?: string) {
    return ["C:\\memory\\import1.png", "C:\\memory\\import2.png"];
  },
};

export function createBrowserCanvasPlanDependencies(): {
  service: CanvasPlanService;
  picker: PlanImagePicker;
} {
  const { repository, imageStore } = createMemoryCanvasStores();
  let counter = 0;
  return {
    service: createCanvasPlanService({
      repository,
      imageStore,
      createId: () => `canvas-${(counter += 1)}`,
      logger: planLogger,
    }),
    picker: memoryPicker,
  };
}
