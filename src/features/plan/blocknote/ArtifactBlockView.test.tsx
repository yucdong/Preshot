// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  ArtifactRecord,
  ClothingArtifact,
  ModelCardArtifact,
  PropArtifact,
  ShootingLocationArtifact,
} from "../../../domain/plan/canvas/blockDocument";
import {
  ArtifactBlockContext,
  type ArtifactBlockController,
} from "./ArtifactBlockContext";
import { ArtifactBlockView } from "./ArtifactBlockView";

vi.mock("./ImageGroupBlockRenderer", () => ({
  ImageGroupBlockRenderer: ({
    groupId,
    label,
  }: {
    groupId: string;
    label: string;
  }) => <div data-testid={`gallery-${groupId}`}>{label}</div>,
}));

function controllerFor(initial: ArtifactRecord) {
  let artifact = initial;
  const listeners = new Set<() => void>();
  const updateArtifact = vi.fn((
    artifactId: string,
    update: (value: ArtifactRecord) => ArtifactRecord,
  ) => {
    expect(artifactId).toBe(initial.id);
    artifact = update(artifact);
    listeners.forEach((listener) => listener());
  });
  const controller: ArtifactBlockController = {
    createArtifact: vi.fn(),
    cloneArtifact: vi.fn(),
    getArtifact: () => artifact,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    updateArtifact,
    removeArtifactBlock: vi.fn(),
    duplicateArtifactBlock: vi.fn(),
  };
  return { controller, updateArtifact };
}

describe("ArtifactBlockView", () => {
  it("uses the shared compact balanced row for model information and samples", () => {
    const model: ModelCardArtifact = {
      id: "model-1",
      kind: "modelCard",
      revision: 0,
      modelId: "林夏",
      heightCm: 168,
      weightKg: 48,
      shoeSize: "38",
      notes: "擅长暗黑风格，需提前确认美瞳",
      samples: { id: "model-samples", images: [] },
    };
    const { controller } = controllerFor(model);
    const { container } = render(
      <ArtifactBlockContext.Provider value={controller}>
        <ArtifactBlockView
          artifactId={model.id}
          blockId="model-block"
          expectedKind="modelCard"
        />
      </ArtifactBlockContext.Provider>,
    );

    expect(
      container.querySelector(
        '[data-artifact-kind="modelCard"] .preshot-artifact-balanced-layout',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "模特信息" }))
      .toHaveClass("preshot-balanced-model-info");
    expect(screen.queryByRole("button", {
      name: "拖动模特信息组件",
    })).not.toBeInTheDocument();
    expect(
      container.querySelectorAll("[data-artifact-resize-edge]"),
    ).toHaveLength(0);
    const notes = screen.getByRole("textbox", { name: "其他信息" });
    expect(notes).toHaveValue("擅长暗黑风格，需提前确认美瞳");
    fireEvent.change(notes, { target: { value: "可自备黑色长靴" } });
    fireEvent.blur(notes);
    expect(controller.getArtifact(model.id)).toMatchObject({
      notes: "可自备黑色长靴",
    });
    expect(screen.getByTestId("gallery-model-samples").closest("section"))
      .toHaveClass("preshot-balanced-gallery");
  });

  it("renders clothing name, information, and main images without try-on", () => {
    const clothing: ClothingArtifact = {
      id: "clothing-1",
      kind: "clothing",
      revision: 0,
      title: "黑金洛丽塔",
      mainGallery: { id: "main", images: [] },
      tryOn: {
        expanded: false,
        gallery: { id: "try-on", images: [] },
      },
      source: "",
    };
    const { controller, updateArtifact } = controllerFor(clothing);
    render(
      <ArtifactBlockContext.Provider value={controller}>
        <ArtifactBlockView
          artifactId={clothing.id}
          blockId="block-1"
          expectedKind="clothing"
        />
      </ArtifactBlockContext.Provider>,
    );

    expect(screen.getByRole("textbox", { name: "服装名称" }))
      .toHaveValue("黑金洛丽塔");
    expect(screen.getByRole("textbox", { name: "服装信息" }))
      .toHaveValue("");
    expect(screen.queryByTestId("gallery-try-on")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /试穿参考/ }))
      .not.toBeInTheDocument();

    const source = screen.getByLabelText("服装信息");
    fireEvent.change(source, { target: { value: "Morrow Studio 借样" } });
    fireEvent.blur(source);
    expect(updateArtifact).toHaveBeenCalledOnce();
  });

  it("omits an empty prop source note from the readonly render", () => {
    const prop: PropArtifact = {
      id: "prop-1",
      kind: "prop",
      revision: 0,
      title: "磨砂铝反光板",
      gallery: { id: "prop-gallery", images: [] },
      source: "",
    };
    const reader = {
      getArtifact: () => prop,
      subscribe: () => () => undefined,
    };
    render(
      <ArtifactBlockContext.Provider value={reader}>
        <ArtifactBlockView
          artifactId={prop.id}
          blockId="block-2"
          expectedKind="prop"
        />
      </ArtifactBlockContext.Provider>,
    );

    expect(screen.queryByText("来源说明")).not.toBeInTheDocument();
    expect(screen.getAllByText("磨砂铝反光板")).toHaveLength(1);
  });

  it("edits location and prop metadata through one combined information field", () => {
    const location: ShootingLocationArtifact = {
      id: "location-1",
      kind: "shootingLocation",
      revision: 0,
      venueName: "摄影棚 A",
      address: "徐汇区",
      description: "朝北窗，下午两点进场",
      gallery: { id: "location-gallery", images: [] },
    };
    const locationStore = controllerFor(location);
    const { unmount } = render(
      <ArtifactBlockContext.Provider value={locationStore.controller}>
        <ArtifactBlockView
          artifactId={location.id}
          blockId="location-block"
          expectedKind="shootingLocation"
        />
      </ArtifactBlockContext.Provider>,
    );
    const locationTitle = screen.getByRole("textbox", { name: "场地名称" });
    expect(locationTitle).toHaveValue("摄影棚 A");
    const locationInfo = screen.getByRole("textbox", { name: /场地信息/ });
    expect(locationInfo).toHaveValue("徐汇区\n朝北窗，下午两点进场");
    expect(screen.queryByLabelText("地址")).not.toBeInTheDocument();
    fireEvent.change(locationInfo, {
      target: { value: "静安区\n可提前布光" },
    });
    fireEvent.blur(locationInfo);
    expect(locationStore.updateArtifact).toHaveBeenCalledOnce();
    expect(locationStore.controller.getArtifact(location.id)).toMatchObject({
      venueName: "摄影棚 A",
      address: "静安区",
      description: "可提前布光",
    });
    fireEvent.change(locationTitle, { target: { value: "摄影棚 B" } });
    fireEvent.blur(locationTitle);
    expect(locationStore.controller.getArtifact(location.id)).toMatchObject({
      venueName: "摄影棚 B",
    });
    unmount();

    const prop: PropArtifact = {
      id: "prop-2",
      kind: "prop",
      revision: 0,
      title: "反光板",
      source: "租赁 180 cm\n需要沙袋固定",
      gallery: { id: "prop-gallery-2", images: [] },
    };
    const propStore = controllerFor(prop);
    render(
      <ArtifactBlockContext.Provider value={propStore.controller}>
        <ArtifactBlockView
          artifactId={prop.id}
          blockId="prop-block"
          expectedKind="prop"
        />
      </ArtifactBlockContext.Provider>,
    );
    expect(screen.getByRole("textbox", { name: "道具名称" }))
      .toHaveValue("反光板");
    expect(screen.getByRole("textbox", { name: /道具信息/ }))
      .toHaveValue("租赁 180 cm\n需要沙袋固定");
    expect(screen.queryByRole("button", { name: "添加来源说明" }))
      .not.toBeInTheDocument();
  });
});
