// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReferenceImage } from "../../../domain/plan/canvas/models";
import { ImageDragOverlay } from "./ImageDragOverlay";

const image: ReferenceImage = {
  id: "image-1",
  file: "references/0001.png",
  aspectRatio: 2,
  sourceWidth: 1200,
  sourceHeight: 600,
  frameWidth: 200,
  frameHeight: 100,
  crop: {
    x: 0.25,
    y: 0.1,
    width: 0.5,
    height: 0.5,
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ImageDragOverlay", () => {
  it("renders real frame geometry and crop with decoded/local fallback", () => {
    render(
      <ImageDragOverlay
        decodedSource=""
        image={image}
        localSource="data:image/png;base64,local"
        source="runtime://fallback"
      />,
    );

    const overlay = document.querySelector<HTMLElement>(
      "[data-image-drag-overlay]",
    )!;
    expect(overlay).toHaveAttribute("aria-hidden", "true");
    expect(overlay).toHaveClass("preshot-image-drag-overlay");
    expect(overlay).toHaveStyle({
      height: "88px",
      pointerEvents: "none",
      width: "176px",
    });
    const renderedImage = document.querySelector<HTMLImageElement>(
      ".preshot-image-drag-overlay-image",
    )!;
    expect(renderedImage).toHaveAttribute(
      "src",
      "data:image/png;base64,local",
    );
    expect(renderedImage).toHaveStyle({
      height: "200%",
      left: "-50%",
      top: "-20%",
      width: "200%",
    });
  });

  it("can portal to the body without intercepting pointers", () => {
    const host = document.createElement("div");
    const result = render(
      <div data-testid="local-host">
        <ImageDragOverlay
          image={image}
          portalToBody
          source="runtime://image"
        />
      </div>,
      { container: host },
    );

    const overlay = document.body.querySelector<HTMLElement>(
      "[data-image-drag-overlay]",
    );
    expect(overlay).not.toBeNull();
    expect(overlay).toHaveStyle({ pointerEvents: "none" });
    expect(result.container.querySelector("[data-image-drag-overlay]")).toBeNull();
  });

  it("sets transition duration to zero through the reduced-motion hook", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    render(<ImageDragOverlay image={image} source="runtime://image" />);

    expect(
      document.querySelector("[data-image-drag-overlay]"),
    ).toHaveStyle({ transition: "none" });
  });
});
