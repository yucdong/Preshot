// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../../app/theme/ThemeProvider";
import type { BlockNotePlanService } from "../../../domain/plan/blocknote/service";
import type { ProjectPlanV14 } from "../../../domain/plan/canvas/blockDocument";
import type { SettingsRepository } from "../../../domain/settings/ports";
import type { ImageGroupBlockController } from "./ImageGroupBlockContext";
import type { ArtifactBlockController } from "./ArtifactBlockContext";
import { BlockNoteProjectCanvasProvider } from "./BlockNoteProjectCanvasProvider";

vi.mock("./imageHydration", () => ({
  applyMeasuredImages: (plan: ProjectPlanV14) => Promise.resolve(plan),
}));

vi.mock("./BlockNoteDocumentEditor", () => ({
  BlockNoteDocumentEditor: ({
    artifactController,
    imageGroupController,
  }: {
    artifactController: ArtifactBlockController;
    imageGroupController: ImageGroupBlockController;
  }) => {
    const group = imageGroupController.getGroup("group-1");
    const image = group?.images[0];
    return (
      <div aria-label="方案正文" role="group">
        {image ? (
          <button
            aria-label="选择参考图 1"
            onDoubleClick={() =>
              imageGroupController.openImage(group.id, image.id, image.file)}
            type="button"
          >
            <img
              alt="图组参考图"
              data-aspect-ratio={image.aspectRatio}
              data-frame-width={image.frameWidth}
              src={imageGroupController.getImageSrc(image.file)}
            />
          </button>
        ) : null}
        {artifactController.getArtifact("prop-1") ? (
          <button
            onClick={() =>
              artifactController.updateArtifact("prop-1", (artifact) => ({
                ...artifact,
                source: "updated while cropping",
              }))}
            type="button"
          >
            修改素材元数据
          </button>
        ) : null}
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
    schemaVersion: 15,
    artifacts: [],
    title: "Editorial",
    document: {
      format: "preshot-blocks",
      version: 3,
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

function croppedPlan(plan: ProjectPlanV14): ProjectPlanV14 {
  return {
    ...plan,
    imageGroups: plan.imageGroups.map((group) => ({
      ...group,
      images: group.images.map((image) => ({
        ...image,
        aspectRatio: 1,
        sourceWidth: 600,
        sourceHeight: 600,
        frameWidth: 120,
        frameHeight: 120,
        frameOffsetX: 0,
        frameOffsetY: 0,
        crop: { x: 0, y: 0, width: 1, height: 1 },
      })),
    })),
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

describe("BlockNoteProjectCanvasProvider crop wiring", () => {
  it("rebases a copied crop over concurrent artifact metadata edits", async () => {
    const user = userEvent.setup();
    const plan = artifactPlanWithImage();
    const prop = plan.artifacts[0];
    if (prop.kind !== "prop") throw new Error("Expected prop fixture");
    const copiedImage = {
      ...prop.gallery.images[0],
      file: "references/0002.png",
      aspectRatio: 1,
      sourceWidth: 600,
      sourceHeight: 600,
      frameWidth: 120,
      frameHeight: 120,
    };
    const cropResultPlan: ProjectPlanV14 = {
      ...plan,
      artifacts: [{
        ...prop,
        gallery: { ...prop.gallery, images: [copiedImage] },
      }],
    };
    let finishCrop!: () => void;
    const commitImageCrop = vi.fn(() =>
      new Promise<{
        plan: ProjectPlanV14;
        image: typeof copiedImage;
        dataUrl: string;
      }>((resolve) => {
        finishCrop = () => resolve({
          plan: cropResultPlan,
          image: copiedImage,
          dataUrl: "data:image/png;base64,copied",
        });
      })
    );
    const savePlan = vi.fn().mockResolvedValue(undefined);
    renderProvider(serviceWith({
      loadPlan: vi.fn().mockResolvedValue({ status: "loaded", plan }),
      loadImage: vi.fn().mockResolvedValue("data:image/png;base64,original"),
      commitImageCrop,
      savePlan,
    }));

    fireEvent.doubleClick(
      await screen.findByRole("button", { name: "选择参考图 1" }),
    );
    await user.click(await screen.findByRole("button", { name: "裁剪" }));
    await user.click(screen.getByRole("button", { name: "1:1" }));
    await user.click(screen.getByRole("button", { name: "确认裁剪" }));
    await waitFor(() => expect(commitImageCrop).toHaveBeenCalledOnce());
    await user.click(screen.getByRole("button", { name: "修改素材元数据" }));
    finishCrop();

    await waitFor(() =>
      expect(screen.getByRole("img", { name: "图组参考图" }))
        .toHaveAttribute("src", "data:image/png;base64,copied")
    );
    fireEvent.keyDown(window, { ctrlKey: true, key: "s" });
    await waitFor(() => expect(savePlan).toHaveBeenCalled());
    const saved = savePlan.mock.calls.at(-1)?.[1] as ProjectPlanV14;
    const savedProp = saved.artifacts[0];
    expect(savedProp.kind === "prop" ? savedProp.source : "")
      .toBe("updated while cropping");
    expect(
      savedProp.kind === "prop"
        ? savedProp.gallery.images[0].file
        : "",
    ).toBe("references/0002.png");
  });

  it("uses the copied artifact asset and restores the original placement on undo", async () => {
    const user = userEvent.setup();
    const plan = artifactPlanWithImage();
    const prop = plan.artifacts[0];
    if (prop.kind !== "prop") throw new Error("Expected prop fixture");
    const copiedImage = {
      ...prop.gallery.images[0],
      file: "references/0002.png",
      aspectRatio: 1,
      sourceWidth: 600,
      sourceHeight: 600,
      frameWidth: 120,
      frameHeight: 120,
    };
    const nextPlan: ProjectPlanV14 = {
      ...plan,
      artifacts: plan.artifacts.map((artifact) =>
        artifact.kind === "prop"
          ? {
              ...artifact,
              gallery: { ...artifact.gallery, images: [copiedImage] },
            }
          : artifact
      ),
    };
    renderProvider(serviceWith({
      loadPlan: vi.fn().mockResolvedValue({ status: "loaded", plan }),
      loadImage: vi.fn().mockResolvedValue("data:image/png;base64,original"),
      commitImageCrop: vi.fn().mockResolvedValue({
        plan: nextPlan,
        image: copiedImage,
        dataUrl: "data:image/png;base64,copied",
      }),
    }));

    fireEvent.doubleClick(
      await screen.findByRole("button", { name: "选择参考图 1" }),
    );
    await user.click(await screen.findByRole("button", { name: "裁剪" }));
    await user.click(screen.getByRole("button", { name: "1:1" }));
    await user.click(screen.getByRole("button", { name: "确认裁剪" }));
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "图组参考图" }))
        .toHaveAttribute("src", "data:image/png;base64,copied")
    );

    fireEvent.keyDown(window, { ctrlKey: true, key: "z" });
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "图组参考图" }))
        .toHaveAttribute("src", "data:image/png;base64,original")
    );
  });

  it("commits through the service and refreshes bitmap, ratio, layout metadata, and save state", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({
        advanceTimers: vi.advanceTimersByTime,
      });
      const plan = planWithImage();
      const nextPlan = croppedPlan(plan);
      const savePlan = vi.fn().mockResolvedValue(undefined);
      const commitImageCrop = vi.fn().mockResolvedValue({
        plan: nextPlan,
        image: nextPlan.imageGroups[0].images[0],
        dataUrl: "data:image/png;base64,cropped",
      });
      renderProvider(serviceWith({
        loadPlan: vi.fn().mockResolvedValue({ status: "loaded", plan }),
        loadImage: vi.fn().mockResolvedValue("data:image/png;base64,original"),
        commitImageCrop,
        savePlan,
      }));

      const tile = await screen.findByRole("button", { name: "选择参考图 1" });
      expect(screen.getByTestId("save-status")).toHaveTextContent("已保存");
      fireEvent.doubleClick(tile);
      await user.click(await screen.findByRole("button", { name: "裁剪" }));
      await user.click(screen.getByRole("button", { name: "1:1" }));
      await user.click(screen.getByRole("button", { name: "确认裁剪" }));

      await waitFor(() => {
        expect(commitImageCrop).toHaveBeenCalledWith(
          "C:\\Editorial",
          expect.any(Function),
          "group-1",
          "image-1",
          { x: 0.166667, y: 0, width: 0.666667, height: 1 },
        );
      });
      expect(await screen.findByRole("img", { name: "参考图" })).toHaveAttribute(
        "src",
        "data:image/png;base64,cropped",
      );
      expect(screen.getByRole("img", { name: "图组参考图" })).toHaveAttribute(
        "src",
        "data:image/png;base64,cropped",
      );
      expect(screen.getByRole("img", { name: "图组参考图" })).toHaveAttribute(
        "data-aspect-ratio",
        "1",
      );
      expect(screen.getByRole("img", { name: "图组参考图" })).toHaveAttribute(
        "data-frame-width",
        "120",
      );
      expect(screen.getByTestId("save-status")).toHaveTextContent("未保存");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(savePlan).toHaveBeenCalledWith("C:\\Editorial", nextPlan);
      expect(screen.getByTestId("save-status")).toHaveTextContent("已保存");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the crop editor open and surfaces service failures", async () => {
    const user = userEvent.setup();
    const plan = planWithImage();
    const savePlan = vi.fn().mockResolvedValue(undefined);
    renderProvider(serviceWith({
      loadPlan: vi.fn().mockResolvedValue({ status: "loaded", plan }),
      loadImage: vi.fn().mockResolvedValue("data:image/png;base64,original"),
      commitImageCrop: vi.fn().mockRejectedValue(new Error("Project copy is locked")),
      savePlan,
    }));

    fireEvent.doubleClick(
      await screen.findByRole("button", { name: "选择参考图 1" }),
    );
    await user.click(await screen.findByRole("button", { name: "裁剪" }));
    await user.click(screen.getByRole("button", { name: "确认裁剪" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Project copy is locked",
    );
    expect(screen.getByRole("heading", { name: "裁剪参考图" })).toBeVisible();
    expect(screen.getByRole("button", { name: "确认裁剪" })).toBeEnabled();
    expect(screen.getByRole("img", { name: "图组参考图" })).toHaveAttribute(
      "src",
      "data:image/png;base64,original",
    );
    expect(screen.getByRole("img", { name: "图组参考图" })).toHaveAttribute(
      "data-aspect-ratio",
      "1.5",
    );
    expect(screen.getByTestId("save-status")).toHaveTextContent("已保存");
    expect(savePlan).not.toHaveBeenCalled();
  });
});
