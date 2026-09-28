import type { MaterialLibraryRepository } from "../../src/domain/library/ports";

/** Browser-only recording boundary; never imported by the production entry. */
export function installWalkthroughBoundary(repository: MaterialLibraryRepository) {
  if (import.meta.env.MODE !== "e2e") throw new Error("Recording boundary requires E2E mode");
  const editor = repository.contentEditor;
  if (!editor?.importEditImageData) throw new Error("Recording requires image staging");
  editor.importEditImages = async (sessionId) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg";
    input.multiple = true;
    const files = await new Promise<File[]>((resolve) => {
      input.onchange = () => resolve(Array.from(input.files ?? []));
      input.oncancel = () => resolve([]);
      input.click();
    });
    return Promise.all(files.map(async (file) => editor.importEditImageData!(sessionId, {
      name: file.name,
      mimeType: file.type,
      bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
    })));
  };
}
