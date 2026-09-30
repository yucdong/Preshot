import {
  MaterialContentSaveError,
  validateMaterialPayload,
  validateMaterialMetadata,
  type MaterialContentUpdate,
  type MaterialDetail,
  type MaterialEditImage,
  type MaterialImage,
} from "../../src/domain/library";
import type { MaterialContentEditorRepository } from "../../src/domain/library/ports";

interface Draft {
  material: MaterialDetail;
  staged: Map<string, MaterialEditImage>;
  isNew?: boolean;
}

export function createMaterialEditingFixture(
  materials: Map<string, MaterialDetail>, previews: Map<string, string>,
) {
  const drafts = new Map<string, Draft>();
  const objects = new Map<string, string>();
  const receipts = new Map<string, { input: string; result: MaterialDetail }>();
  let imageSequence = 0;
  let loseCommitResponse = new URLSearchParams(location.search).has("loseEditResponse");
  const requireDraft = (id: string) => {
    const draft = drafts.get(id);
    if (!draft) throw new MaterialContentSaveError("素材草稿不存在", "rejected");
    return draft;
  };
  const requireMaterial = (id: string) => {
    const material = materials.get(id);
    if (!material) throw new MaterialContentSaveError("素材不存在", "rejected");
    return material;
  };
  const original = (material: MaterialDetail, id: string) => {
    const image = material.images.find((entry) => entry.localImageId === id);
    const src = image && objects.get(image.storageId ?? image.blobId);
    if (!src) throw new Error("此素材原图不存在");
    return src;
  };
  async function stage(canvas: HTMLCanvasElement, draft: Draft): Promise<MaterialEditImage> {
    const dataUrl = canvas.toDataURL("image/png");
    const result: MaterialEditImage = {
      localImageId: crypto.randomUUID(), mimeType: "image/png",
      byteLength: atob(dataUrl.split(",")[1]).length,
      width: canvas.width, height: canvas.height, dataUrl,
    };
    draft.staged.set(result.localImageId, result);
    return result;
  }
  const contentEditor: MaterialContentEditorRepository = {
    async beginCreate(input) {
      const payload = validateMaterialPayload(input);
      const component = payload.component;
      const images = (component.kind === "image" || component.kind === "imageGroup") ? component.images :
        component.kind === "modelCard" ? component.samples.images :
          component.kind === "clothing" ? component.mainGallery.images : component.gallery.images;
      if (images.length) throw new Error("New material seeds cannot own images");
      const material: MaterialDetail = {
        id: crypto.randomUUID(), kind: payload.kind, revision: 0, metadataVersion: 0,
        name: "", description: "", tags: [], favorite: false,
        createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null, imageCount: 0, byteLength: 0,
        previewState: "pending", images: [], payload,
      };
      const sessionId = crypto.randomUUID();
      drafts.set(sessionId, { material, staged: new Map(), isNew: true });
      return { sessionId, material: structuredClone(material), isNew: true };
    },
    async beginEdit(id, revision) {
      const material = requireMaterial(id);
      if (material.revision !== revision || material.deletedAt !== null) {
        throw new MaterialContentSaveError("素材已变化", "rejected");
      }
      const sessionId = crypto.randomUUID();
      drafts.set(sessionId, { material: structuredClone(material), staged: new Map() });
      return { sessionId, material: structuredClone(material) };
    },
    async loadEditImage(id, imageId) {
      const draft = requireDraft(id);
      return draft.staged.get(imageId)?.dataUrl ?? original(draft.material, imageId);
    },
    async importEditImages(id) {
      const draft = requireDraft(id);
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 96;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Synthetic fixture canvas unavailable");
      context.fillStyle = ++imageSequence % 2 ? "#a14331" : "#2c6f88";
      context.fillRect(0, 0, 128, 96);
      context.fillStyle = "#f1dcc3";
      context.fillRect(20, 15, 65, 45);
      return [await stage(canvas, draft)];
    },
    async importEditImageData(id, input) {
      const draft = requireDraft(id);
      if (!["image/png", "image/jpeg"].includes(input.mimeType) || input.bytes.length > 16 * 1024 * 1024) {
        throw new Error("Clipboard fixture requires a bounded static image");
      }
      const bytes = new Uint8Array(input.bytes);
      const bitmap = await createImageBitmap(new Blob([bytes], { type: input.mimeType }));
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(reader.error);
          reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Invalid fixture image"));
          reader.readAsDataURL(new Blob([bytes], { type: input.mimeType }));
        });
        const mimeType = input.mimeType === "image/jpeg" ? "image/jpeg" : "image/png";
        const image: MaterialEditImage = {
          localImageId: crypto.randomUUID(), mimeType, byteLength: bytes.length,
          width: bitmap.width, height: bitmap.height, dataUrl,
        };
        draft.staged.set(image.localImageId, image);
        return image;
      } finally { bitmap.close(); }
    },
    async captureEditImage(id, cancellation, review) {
      requireDraft(id);
      const options = new URLSearchParams(location.search);
      let cancelled = false;
      void cancellation.then(() => { cancelled = true; });
      for (;;) {
      const host = document.querySelector(".ml-content-editor-dialog");
      if (!host) throw new Error("Synthetic capture requires the material editor");
      const dialog = document.createElement("dialog");
      dialog.setAttribute("aria-label", "模拟 Windows 截图");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      Object.assign(dialog.style, {
        padding: "24px", borderRadius: "8px", border: "1px solid var(--app-border)",
        background: "var(--app-panel-strong)", color: "var(--app-ink)",
      });
      const label = document.createElement("p");
      label.textContent = "仅生成测试图片，不读取桌面或剪贴板。";
      const complete = document.createElement("button");
      complete.textContent = "完成测试截图";
      const cancel = document.createElement("button");
      cancel.textContent = "取消测试截图";
      dialog.append(label, complete, cancel);
      host.append(dialog);
      const accepted = await new Promise<boolean>((resolve) => {
        let finished = false;
        const finish = (result: boolean) => {
          if (finished) return;
          finished = true;
          dialog.close();
          dialog.remove();
          resolve(result);
        };
        complete.onclick = () => finish(true);
        cancel.onclick = () => finish(false);
        dialog.oncancel = (event) => { event.preventDefault(); finish(false); };
        void cancellation.then(() => finish(false));
        dialog.showModal();
      });
      if (!accepted || cancelled) return null;
      if (!options.has("wideCapture") && !options.has("suspectCapture")) {
        return (await contentEditor.importEditImages(id))[0];
      }
      const canvas = document.createElement("canvas");
      canvas.width = 3000;
      canvas.height = 500;
      const context = canvas.getContext("2d")!;
      context.fillStyle = options.has("suspectCapture") ? "#000" : "#2c6f88";
      context.fillRect(0, 0, canvas.width, canvas.height);
      if (options.has("suspectCapture")) {
        if (!review) throw new Error("Screenshot review unavailable");
        const preview = document.createElement("canvas");
        preview.width = 300; preview.height = 50;
        preview.getContext("2d")!.drawImage(canvas, 0, 0, 300, 50);
        const decision = await review({ reason: "uniformDark", previewUrl: preview.toDataURL("image/png") }, cancellation);
        if (decision === "cancel" || cancelled) return null;
        if (decision === "retry") continue;
      } else {
        context.fillStyle = "#f1dcc3";
        context.font = "120px sans-serif";
        context.fillText("3000 × 500 — Screenshot fixture", 100, 300);
      }
      return stage(canvas, requireDraft(id));
      }
    },
    async cropEditImage(id, imageId, bounds) {
      const draft = requireDraft(id);
      const src = await contentEditor.loadEditImage(id, imageId);
      const bitmap = await createImageBitmap(await (await fetch(src)).blob());
      try {
        if (!Object.values(bounds).every(Number.isInteger) ||
            bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0 ||
            bounds.x + bounds.width > bitmap.width || bounds.y + bounds.height > bitmap.height) {
          throw new Error("裁切范围无效");
        }
        const canvas = document.createElement("canvas");
        canvas.width = bounds.width;
        canvas.height = bounds.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Synthetic crop canvas unavailable");
        context.drawImage(bitmap, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
        return await stage(canvas, draft);
      } finally {
        bitmap.close();
      }
    },
    async commitEdit(input: MaterialContentUpdate) {
      const intent = JSON.stringify(input);
      const receipt = receipts.get(input.operationId);
      if (receipt) {
        if (receipt.input !== intent) throw new MaterialContentSaveError("保存标识被复用", "rejected");
        return structuredClone(receipt.result);
      }
      const draft = requireDraft(input.sessionId);
      if (draft.isNew && (materials.has(draft.material.id) || !input.metadataUpdate ||
          input.metadataUpdate.expectedVersion !== 0)) {
        throw new MaterialContentSaveError("创建草稿已保存或缺少素材信息", "rejected");
      }
      const current = draft.isNew ? draft.material : requireMaterial(draft.material.id);
      if (current.revision !== draft.material.revision || current.deletedAt !== null) {
        throw new MaterialContentSaveError("素材已变化", "rejected");
      }
      const payload = validateMaterialPayload(input.payload);
      if (input.metadataUpdate && current.metadataVersion !== input.metadataUpdate.expectedVersion) {
        throw new MaterialContentSaveError("素材信息已变化，请重新打开编辑窗口", "rejected");
      }
      const metadata = input.metadataUpdate ? validateMaterialMetadata(input.metadataUpdate.metadata) : undefined;
      if (payload.kind !== current.kind) throw new MaterialContentSaveError("不能更换素材类型", "rejected");
      const component = payload.component;
      const entries = (component.kind === "image" || component.kind === "imageGroup") ? component.images :
        component.kind === "modelCard" ? component.samples.images :
          component.kind === "clothing" ? component.mainGallery.images : component.gallery.images;
      const images: MaterialImage[] = [];
      for (const entry of entries) {
        const existing = draft.material.images.find((image) => image.localImageId === entry.localImageId);
        if (existing) { images.push(existing); continue; }
        const staged = draft.staged.get(entry.localImageId);
        if (!staged) throw new MaterialContentSaveError("素材图片不属于当前草稿", "rejected");
        const bytes = Uint8Array.from(atob(staged.dataUrl.split(",")[1]), (character) => character.charCodeAt(0));
        const hash = await crypto.subtle.digest("SHA-256", bytes);
        const blobId = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
        const { dataUrl, ...image } = staged;
        const storageId = crypto.randomUUID();
        objects.set(storageId, dataUrl);
        images.push({ ...image, blobId, storageId });
      }
      const result: MaterialDetail = {
        ...current, payload, images, revision: current.revision + 1, updatedAt: Date.now(),
        ...(metadata ? { ...metadata, metadataVersion: current.metadataVersion + 1 } : {}),
        imageCount: images.length, byteLength: images.reduce((sum, image) => sum + image.byteLength, 0),
        previewState: "pending", previewPartial: false,
      };
      materials.set(result.id, result);
      previews.delete(result.id);
      receipts.set(input.operationId, { input: intent, result: structuredClone(result) });
      if (loseCommitResponse) {
        loseCommitResponse = false;
        throw new Error("模拟保存已完成但响应中断");
      }
      return structuredClone(result);
    },
    async discardEdit(id) { drafts.delete(id); },
  };
  return {
    contentEditor,
    async loadImage(id: string, revision: number, imageId: string) {
      const material = requireMaterial(id);
      if (material.revision !== revision) throw new Error("素材版本已变化");
      return original(material, imageId);
    },
  };
}
