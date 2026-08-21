import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("production image drag source contract", () => {
  it("uses the dnd-kit transaction boundary without the legacy pointer implementation", () => {
    const groupView = read(
      "src/features/plan/blocknote/ImageGroupBlockView.tsx",
    );
    const previewContext = read(
      "src/features/plan/blocknote/ImageDragPreviewContext.tsx",
    );

    expect(previewContext).toContain('from "@dnd-kit/core"');
    expect(previewContext).toContain("<DndContext");
    expect(previewContext).toContain("<DragOverlay");
    expect(previewContext).toContain("PreshotPointerSensor");
    expect(previewContext).toContain("KeyboardSensor");
    expect(groupView).toContain("useImageDragActivator");
    expect(groupView).not.toContain("startImageDrag");
    expect(groupView).not.toContain("data-image-drop-target");
    expect(previewContext).not.toContain("data-image-drop-target");
  });
});
