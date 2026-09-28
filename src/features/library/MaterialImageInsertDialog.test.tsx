// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MaterialDetail } from "../../domain/library";
import { unavailableMaterialLibrary } from "../../infrastructure/library/unavailableMaterialLibrary";
import { MaterialImageInsertDialog } from "./MaterialImageInsertDialog";

const material: MaterialDetail = {
  id: "group", kind: "imageGroup", name: "窗边", description: "", tags: [], favorite: false,
  revision: 1, metadataVersion: 1, createdAt: 1, updatedAt: 1, deletedAt: null,
  imageCount: 3, byteLength: 3, previewState: "pending", images: [],
  payload: { format: "preshot-material", version: 1, kind: "imageGroup", component: {
    kind: "imageGroup", name: "窗边", description: "", images: ["a", "b", "c"].map((id) => ({
      localImageId: id, caption: id, aspectRatio: 1, frameWidth: 100, frameHeight: 100,
    })),
  } },
};
function setup(intoCurrentGroup = false) {
  const onInsert = vi.fn();
  const onClose = vi.fn();
  const repository = { ...unavailableMaterialLibrary, loadImage: vi.fn(async () => { throw new Error("preview offline"); }) };
  render(<MaterialImageInsertDialog material={material} repository={repository} busy={false} error=""
    intoCurrentGroup={intoCurrentGroup}
    onInsert={onInsert} onClose={onClose} />);
  return { onInsert, onClose };
}
describe("image-group insertion dialog", () => {
  it("selects images for the current group without offering new-block insertion modes", () => {
    const context = setup(true);
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByText("所选图片追加到当前图片组，保留当前组名和已有图片。")).toBeVisible();
    fireEvent.click(screen.getByRole("checkbox", { name: "选择第 2 张图片：b" }));
    fireEvent.click(screen.getByRole("button", { name: "确认插入" }));
    expect(context.onInsert).toHaveBeenCalledWith({ mode: "imageGroup", imageIds: ["a", "c"] });
  });
  it("defaults to the complete group and allows a subset of independent images in original order", async () => {
    const context = setup();
    expect(screen.getByRole("radio", { name: "图片组" })).toBeChecked();
    expect(screen.getByText("已选 3 / 3 张")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "确认插入" }));
    expect(context.onInsert).toHaveBeenLastCalledWith({ mode: "imageGroup", imageIds: ["a", "b", "c"] });
    fireEvent.click(screen.getByRole("button", { name: "取消全选" }));
    expect(screen.getByRole("button", { name: "确认插入" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "选择第 3 张图片：c" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择第 1 张图片：a" }));
    fireEvent.click(screen.getByRole("radio", { name: "独立图片" }));
    fireEvent.click(screen.getByRole("button", { name: "确认插入" }));
    expect(context.onInsert).toHaveBeenLastCalledWith({ mode: "images", imageIds: ["a", "c"] });
    await waitFor(() => expect(screen.getAllByText("预览不可用")).toHaveLength(3));
  });
  it("supports one selected image as a group and Escape without insertion", () => {
    const context = setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "选择第 1 张图片：a" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择第 3 张图片：c" }));
    fireEvent.click(screen.getByRole("button", { name: "确认插入" }));
    expect(context.onInsert).toHaveBeenCalledWith({ mode: "imageGroup", imageIds: ["b"] });
    context.onInsert.mockClear();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(context.onClose).toHaveBeenCalledOnce();
    expect(context.onInsert).not.toHaveBeenCalled();
  });
});
