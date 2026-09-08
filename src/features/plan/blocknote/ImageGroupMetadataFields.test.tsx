// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArtifactDraftContext, createArtifactDraftRegistry } from "./ArtifactDraftContext";
import { ImageGroupMetadataFields } from "./ImageGroupMetadataFields";

describe("image-group metadata drafts", () => {
  it("preserves native input when the editor stops bubbling, then commits blur and focused fields", () => {
    const registry = createArtifactDraftRegistry();
    const onCommit = vi.fn();
    const surface = (name: string) => <ArtifactDraftContext.Provider value={registry}>
      <div data-testid="editor-event-boundary">
        <ImageGroupMetadataFields name={name} description="原说明" onCommit={onCommit} />
      </div>
    </ArtifactDraftContext.Provider>;
    const view = render(surface("原组名"));
    const boundary = screen.getByTestId("editor-event-boundary");
    const stopInput = (event: Event) => event.stopPropagation();
    boundary.addEventListener("input", stopInput);
    try {
      fireEvent.input(screen.getByRole("textbox", { name: "图片组名称" }), { target: { value: "新组名" } });
      fireEvent.input(screen.getByRole("textbox", { name: "图片组说明" }), { target: { value: "新的拍摄说明" } });
      fireEvent.blur(screen.getByRole("textbox", { name: "图片组名称" }));
      expect(onCommit).toHaveBeenCalledExactlyOnceWith({ name: "新组名" });
      view.rerender(surface("新组名"));
      act(() => registry.flush());
      expect(onCommit).toHaveBeenLastCalledWith({ description: "新的拍摄说明" });
      expect(onCommit).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("textbox", { name: "图片组名称" })).toHaveValue("新组名");
      expect(screen.getByRole("textbox", { name: "图片组说明" })).toHaveValue("新的拍摄说明");
    } finally {
      boundary.removeEventListener("input", stopInput);
    }
  });
});
