// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImageGroupExportContext } from "./export/ImageGroupExportContext";
import { ImageGroupBlockRenderer } from "./ImageGroupBlockRenderer";

vi.mock("./ImageGroupBlockView", () => ({
  ImageGroupBlockView: ({
    blockId,
    groupId,
  }: {
    blockId: string;
    groupId: string;
  }) => <div data-testid="interactive-group">{blockId}:{groupId}</div>,
}));

vi.mock("./export/ExportImageGroupBlockView", () => ({
  ExportImageGroupBlockView: ({
    blockId,
    groupId,
  }: {
    blockId: string;
    groupId: string;
  }) => <div data-testid="export-group">{blockId}:{groupId}</div>,
}));

describe("ImageGroupBlockRenderer", () => {
  it("selects the interactive renderer outside export composition", () => {
    render(<ImageGroupBlockRenderer blockId="block-1" groupId="group-1" />);

    expect(screen.getByTestId("interactive-group")).toHaveTextContent(
      "block-1:group-1",
    );
    expect(screen.queryByTestId("export-group")).not.toBeInTheDocument();
  });

  it("selects the export renderer only inside the export context", () => {
    const controller = {
      getGroup: () => undefined,
      getImageSrc: () => undefined,
    };
    render(
      <ImageGroupExportContext.Provider value={controller}>
        <ImageGroupBlockRenderer blockId="block-2" groupId="group-2" />
      </ImageGroupExportContext.Provider>,
    );

    expect(screen.getByTestId("export-group")).toHaveTextContent(
      "block-2:group-2",
    );
    expect(screen.queryByTestId("interactive-group")).not.toBeInTheDocument();
  });
});
