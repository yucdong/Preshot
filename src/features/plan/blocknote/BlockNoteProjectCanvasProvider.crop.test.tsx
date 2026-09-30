// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../../app/theme/ThemeProvider";
import type { BlockNotePlanService } from "../../../domain/plan/blocknote/service";
import type { ProjectPlanV14 } from "../../../domain/plan/canvas/blockDocument";
import type { SettingsRepository } from "../../../domain/settings/ports";
import type { ImageGroupBlockController } from "./ImageGroupBlockContext";
import { BlockNoteProjectCanvasProvider } from "./BlockNoteProjectCanvasProvider";

vi.mock("./imageHydration", () => ({
  applyMeasuredImages: (plan: ProjectPlanV14) => Promise.resolve(plan),
}));

vi.mock("./BlockNoteDocumentEditor", () => ({
  BlockNoteDocumentEditor: ({
    imageGroupController,
  }: {
    imageGroupController: ImageGroupBlockController;
  }) => {
    const group = imageGroupController.getGroup("group-1");
    return (
      <div aria-label="方案正文" role="group">
        {group?.images.map((image, index) => (
          <button
            key={image.id}
            aria-label={`选择参考图 ${index + 1}`}
            onDoubleClick={() =>
              imageGroupController.openImage(group.id, image.id, image.file)}
            type="button"
          >
            <img
              alt="图组参考图"
              data-aspect-ratio={image.aspectRatio}
              data-frame-width={image.frameWidth}
              src={imageGroupController.getImageSrc(image.file, image.presentationAxes)}
            />
          </button>
        ))}
      </div>
    );
  },
}));

const settings: SettingsRepository = {
  read: vi.fn().mockResolvedValue({ theme: "light" }),
  write: vi.fn().mockResolvedValue(undefined),
};

function planWithImage(): ProjectPlanV14 {
  return {
    schemaVersion: 17,
    artifacts: [],
    title: "Editorial",
    document: {
      format: "preshot-blocks",
      version: 5,
      blocks: [{
        id: "block-1",
        type: "imageGroup",
        props: { groupId: "group-1" },
        content: undefined,
        children: [],
      }],
    },
    imageGroups: [{
      id: "group-1",
      name: "References",
      type: "reference",
      x: 0,
      width: 600,
      height: 320,
      description: "",
      images: [{
        id: "image-1",
        file: "references/look.png",
        aspectRatio: 1.5,
        sourceWidth: 1200,
        sourceHeight: 800,
        frameWidth: 180,
        frameHeight: 120,
        crop: { x: 0, y: 0, width: 1, height: 1 },
      }],
    }],
  };
}

function artifactPlanWithImage(): ProjectPlanV14 {
  const base = planWithImage();
  const image = base.imageGroups[0].images[0];
  return {
    ...base,
    document: {
      ...base.document,
      blocks: [{
        id: "prop-block",
        type: "prop",
        props: { artifactId: "prop-1" },
        content: undefined,
        children: [],
      }],
    },
    imageGroups: [],
    artifacts: [{
      id: "prop-1",
      kind: "prop",
      revision: 0,
      title: "Reflector",
      source: "",
      gallery: {
        id: "group-1",
        images: [image],
      },
    }],
  };
}

function serviceWith(
  overrides: Partial<BlockNotePlanService>,
): BlockNotePlanService {
  return {
    loadPlan: vi.fn(),
    savePlan: vi.fn().mockResolvedValue(undefined),
    loadImage: vi.fn(),
    importMedia: vi.fn(),
    loadMedia: vi.fn(),
    importImages: vi.fn(),
    commitImageCrop: vi.fn(),
    removeImage: vi.fn(),
    removeGroup: vi.fn(),
    purgeDetachedGroups: vi.fn(),
    purgeDetachedMedia: vi.fn(),
    ...overrides,
  };
}

function renderProvider(service: BlockNotePlanService) {
  return render(
    <ThemeProvider repository={settings}>
      <BlockNoteProjectCanvasProvider
        docxExporter={{ implementation: "blocknote-docx", export: vi.fn() }}
        docxSaver={{ save: vi.fn() }}
        exporter={{ implementation: "react-pdf", export: vi.fn() }}
        picker={{
          pickImageFile: vi.fn().mockResolvedValue(null),
          pickImageFiles: vi.fn().mockResolvedValue(null),
        }}
        projectName="Editorial"
        projectPath={"C:\\Editorial"}
        logger={{
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        }}
        longImageExporter={{ export: vi.fn() }}
        longImageSaver={{ save: vi.fn() }}
        projectDirectoryRevealer={{
          revealProjectDirectory: vi.fn().mockResolvedValue(undefined),
        }}
        saver={{ save: vi.fn() }}
        service={service}
      />
    </ThemeProvider>,
  );
}

describe("BlockNoteProjectCanvasProvider read-only lightbox", () => {
  it("keeps old raw and new EXIF previews independent for the same original path", async () => {
    const plan = planWithImage();
    plan.schemaVersion = 18;
    plan.imageGroups[0].images.push({ ...plan.imageGroups[0].images[0], id: "oriented", presentationAxes: "exif" });
    const loadImage = vi.fn(async (_path: string, _file: string, axes?: string) => `data:image/png;base64,${axes === "exif" ? "oriented" : "raw"}`);
    renderProvider(serviceWith({ loadPlan: vi.fn().mockResolvedValue({ status: "loaded", plan }), loadImage }));
    const raw = await screen.findByRole("button", { name: "选择参考图 1" });
    const oriented = await screen.findByRole("button", { name: "选择参考图 2" });
    expect(raw.querySelector("img")).toHaveAttribute("src", "data:image/png;base64,raw");
    expect(oriented.querySelector("img")).toHaveAttribute("src", "data:image/png;base64,oriented");
    expect(loadImage).toHaveBeenCalledTimes(2);
    fireEvent.doubleClick(oriented);
    expect(await screen.findByRole("img", { name: "参考图" })).toHaveAttribute("src", "data:image/png;base64,oriented");
  });

  it.each([
    ["image group", planWithImage],
    ["artifact gallery", artifactPlanWithImage],
  ] as const)("opens %s images without crop controls or image mutations", async (_, makePlan) => {
    const plan = makePlan();
    const original = structuredClone(plan);
    const service = serviceWith({
      loadPlan: vi.fn().mockResolvedValue({ status: "loaded", plan }),
      loadImage: vi.fn().mockResolvedValue("data:image/png;base64,original"),
    });
    renderProvider(service);

    const tile = await screen.findByRole("button", { name: "选择参考图 1" });
    fireEvent.doubleClick(tile);
    expect(await screen.findByRole("img", { name: "参考图" })).toHaveAttribute(
      "src", "data:image/png;base64,original",
    );
    expect(screen.queryByRole("button", { name: /裁剪|裁切/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: /裁剪/ })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button", { name: "关闭图片" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.doubleClick(tile);
    fireEvent.click(screen.getByRole("button", { name: "关闭图片" }));
    expect(service.commitImageCrop).not.toHaveBeenCalled();
    expect(service.savePlan).not.toHaveBeenCalled();
    expect(screen.getByTestId("save-status")).toHaveTextContent("已保存");
    expect(plan).toEqual(original);
  });
});
