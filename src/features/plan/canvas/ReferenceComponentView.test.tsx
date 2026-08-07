// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../../app/theme/ThemeProvider";
import type { SettingsRepository } from "../../../domain/settings/ports";
import type { ReferenceComponent } from "../../../domain/plan/canvas/models";
import { packReferenceFrames } from "../../../domain/plan/canvas/referenceLayout";
import { ReferenceComponentView } from "./ReferenceComponentView";

vi.mock("@dnd-kit/core", () => ({
  useDroppable: () => ({ setNodeRef: () => undefined }),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => children,
  rectSortingStrategy: () => null,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => undefined,
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));

const component: ReferenceComponent = {
  id: "ref",
  name: "Reference",
  type: "reference",
  x: 0,
  y: 60,
  width: 320,
  height: 240,
  description: "",
  images: [{
    id: "image",
    file: "references/image.png",
    caption: "legacy caption",
    aspectRatio: 1,
    frameWidth: 100,
    frameHeight: 100,
  }],
};

const settings: SettingsRepository = {
  read: vi.fn().mockResolvedValue({ theme: "light" }),
  write: vi.fn().mockResolvedValue(undefined),
};

function renderView() {
  return render(
    <ThemeProvider repository={settings}>
      <ReferenceComponentView
        component={component}
        enableReorder
        imageSrc={() => undefined}
        onAddImage={vi.fn()}
        onOpenImage={vi.fn()}
        onRemoveImage={vi.fn()}
        onSetDescription={vi.fn()}
        scale={1}
        slots={packReferenceFrames({ images: component.images, innerWidth: 296 })}
      />
    </ThemeProvider>,
  );
}

describe("ReferenceComponentView", () => {
  it("renders a group introduction even when the description is empty", () => {
    renderView();
    expect(screen.getByRole("group", { name: "分组描述" })).toBeInTheDocument();
  });

  it("renders image frames without rendering legacy captions", () => {
    renderView();
    expect(screen.getByRole("button", { name: "选择参考图 1" })).toBeInTheDocument();
    expect(screen.queryByDisplayValue("legacy caption")).not.toBeInTheDocument();
  });
});
