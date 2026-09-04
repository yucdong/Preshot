// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  ArtifactRecord,
  ClothingArtifact,
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
  it("renders separate clothing name and information with retained try-on disclosure", () => {
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
    fireEvent.click(screen.getByRole("button", { name: /试穿参考/ }));
    expect(updateArtifact).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("gallery-try-on")).toBeVisible();

    const source = screen.getByLabelText("服装信息");
    fireEvent.change(source, { target: { value: "Morrow Studio 借样" } });
    fireEvent.blur(source);
    expect(updateArtifact).toHaveBeenCalledTimes(2);
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
