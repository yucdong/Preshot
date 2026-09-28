// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { clipboardPayloadKind, imagePasteTarget, registerImageClipboardDocument } from "./imageClipboardDom";

afterEach(() => { document.body.replaceChildren(); });

describe("selected component image destinations", () => {
  function fixture() {
    const root = document.createElement("div");
    root.dataset.clipboardDocument = "";
    root.innerHTML = `<section tabindex="0" data-clipboard-component="samples">
      <header>Model</header><input aria-label="Name">
      <div data-clipboard-gallery="samples"><button data-image-clipboard-id="photo">Photo</button></div>
    </section><p tabindex="0">Body</p>`;
    document.body.append(root);
    return { root, component: root.querySelector("section")!, header: root.querySelector("header")! };
  }

  it("routes a component header to its gallery, never an outer native image", () => {
    const { header } = fixture();
    expect(imagePasteTarget(header)).toEqual({ kind: "gallery", groupId: "samples", afterImageId: null });
  });

  it("uses a single selected component when the clipboard event originates at ProseMirror", () => {
    const { root, component } = fixture();
    const bridge = {
      getNativeSelection: () => null, getAnchor: () => "old-paragraph",
      resolveNativeImage: () => null, getSelectedComponent: () => component,
    };
    const unregister = registerImageClipboardDocument(root, bridge);
    expect(imagePasteTarget(root)).toEqual({ kind: "gallery", groupId: "samples", afterImageId: null });
    expect(imagePasteTarget(root.querySelector("p")!)).toEqual({
      kind: "document", afterBlockId: "old-paragraph",
    });
    unregister();
  });

  it("does not silently use the document when the component's intended gallery is missing", () => {
    const { header, component } = fixture();
    component.querySelector("[data-clipboard-gallery]")!.remove();
    expect(imagePasteTarget(header)).toBeNull();
  });

  it("keeps fields out of image routing and retains after-image and genuine document targets", () => {
    const { root } = fixture();
    expect(imagePasteTarget(root.querySelector("input")!)).toBeNull();
    expect(imagePasteTarget(root.querySelector("button")!)).toEqual({
      kind: "gallery", groupId: "samples", afterImageId: "photo",
    });
    expect(imagePasteTarget(root.querySelector("p")!, () => "paragraph")).toEqual({
      kind: "document", afterBlockId: "paragraph",
    });
  });
});

function data(values: Record<string, string>, files: File[] = []) {
  return {
    types: [...Object.keys(values), ...(files.length ? ["Files"] : [])],
    getData: (format: string) => values[format] ?? "", files,
  } as unknown as DataTransfer;
}
const raster = new File(["image"], "one.png", { type: "image/png" });

describe("clipboard event payload routing", () => {
  it("accepts exactly one raster, including image-only OS HTML, without reading image URLs", () => {
    expect(clipboardPayloadKind(data({}, [raster]))).toBe("image");
    expect(clipboardPayloadKind(data({ "text/html": "<html><body><img src='file:///ignored.png'></body></html>" }, [raster]))).toBe("image");
    expect(clipboardPayloadKind(data({ "text/html": "<img src='data:image/png;base64,aW1hZ2U='>" }))).toBe("image");
    expect(clipboardPayloadKind(data({ "text/html": "<img src='https://example.invalid/image.png'>" }))).toBe("ordinary");
    expect(clipboardPayloadKind(data({}, [raster, raster]))).toBe("ordinary");
    expect(clipboardPayloadKind(data({}, [new File(["file"], "test.txt", { type: "text/plain" })]))).toBe("ordinary");
  });

  it("leaves text, rich documents and multiblock packets to the original pipeline", () => {
    for (const html of [
      "<p>文本</p><img src='file:///one.png'>",
      "<p></p><img src='file:///one.png'>",
      "<img src='one.png'><img src='two.png'>",
      "<div data-node-type='blockContainer'><img src='one.png'></div><div data-node-type='blockContainer'></div>",
    ]) {
      expect(clipboardPayloadKind(data({ "text/html": html }, [raster]))).toBe("ordinary");
    }
    expect(clipboardPayloadKind(data({ "text/plain": "文字" }, [raster]))).toBe("ordinary");
    expect(clipboardPayloadKind(data({ "application/x-blocknote": "{}" }))).toBe("ordinary");
    expect(clipboardPayloadKind(data({ "blocknote/html": "<div><img></div>" }, [raster]))).toBe("ordinary");
  });

  it("delegates registered packet validation to the port, never parsing packet paths", () => {
    expect(clipboardPayloadKind(data({ "Preshot.Image.v1": "untrusted" }))).toBe("image");
    expect(clipboardPayloadKind(data({}))).toBe("unknown");
    expect(clipboardPayloadKind(null)).toBe("unknown");
  });
});
