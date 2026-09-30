import { describe, expect, it, vi } from "vitest";
import { validateBlockDocument, type PreshotBlockDocument } from "../../../domain/plan/canvas/blockDocument";
import { resolveBlockNoteDocumentAssets, serializeBlockNoteDocumentAssets } from "./blockNoteDocumentAssets";

const renderedUrl = "data:image/png;base64,aWRlbnRpY2FsLWJ5dGVz";

function media(id: string, url: string, type = "image") {
  return { id, type, props: { url, name: id, caption: "", showPreview: true }, children: [] };
}

describe("BlockNote document asset serialization", () => {
  it("resolves raw and EXIF presentations of one native original independently", () => {
    const portable: PreshotBlockDocument = { format: "preshot-blocks", version: 5, blocks: [
      { ...media("raw", "media/photo.jpg"), type: "image", content: undefined },
      { ...media("oriented", "media/photo.jpg"), type: "image", props: { ...media("oriented", "media/photo.jpg").props, presentationAxes: "exif" }, content: undefined },
    ] };
    const sources: Record<string, string> = { "media/photo.jpg": "raw-data", "media/photo.jpg#preshot-exif": "exif-data" };
    const rendered = resolveBlockNoteDocumentAssets(portable, url => sources[url]);
    expect(rendered).toMatchObject([{ props: { url: "raw-data" } }, { props: { url: "exif-data" } }]);
    expect(portable.blocks.map(block => block.props.url)).toEqual(["media/photo.jpg", "media/photo.jpg"]);
  });

  it("keeps independent media paths when two blocks resolve to identical bytes", () => {
    const portable = validateBlockDocument({
      format: "preshot-blocks", version: 4,
      blocks: [media("original-image", "media/original.png"), media("copied-image", "media/copied.png")],
    });
    const rendered = resolveBlockNoteDocumentAssets(portable, () => renderedUrl);
    const before = structuredClone(rendered);
    const persist = vi.fn((url: string, blockId?: string) => {
      expect(url).toBe(renderedUrl);
      return blockId === "copied-image" ? "media/copied.png" : "media/original.png";
    });
    expect(serializeBlockNoteDocumentAssets(rendered, persist)).toEqual(portable);
    expect(persist).toHaveBeenCalledWith(renderedUrl, "original-image");
    expect(persist).toHaveBeenCalledWith(renderedUrl, "copied-image");
    expect(rendered).toEqual(before);
    expect(JSON.stringify(rendered)).toContain(renderedUrl);
  });

  it.each(["image", "video", "audio", "file"])("passes the nested %s block's ID, not its parent ID", (type) => {
    const persist = vi.fn((_url: string, blockId?: string) => `media/${blockId}.png`);
    const blocks = [{
      id: "parent", type: "paragraph", props: {}, content: [],
      children: [media("nested-media", renderedUrl, type)],
    }];
    const result = serializeBlockNoteDocumentAssets(blocks, persist);
    expect(persist).toHaveBeenCalledExactlyOnceWith(renderedUrl, "nested-media");
    expect(result.blocks[0].children[0].props.url).toBe("media/nested-media.png");
    expect(blocks[0].children[0].props.url).toBe(renderedUrl);
  });

  it("keeps one-argument upload persistence callbacks compatible", () => {
    const persist = (url: string) => url === renderedUrl ? "media/upload.png" : url;
    const result = serializeBlockNoteDocumentAssets([media("new-upload", renderedUrl)], persist);
    expect(result.blocks[0].props.url).toBe("media/upload.png");
  });
});
