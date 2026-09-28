import { describe, expect, it, vi } from "vitest";
import { createTauriMaterialLibrary } from "./tauriMaterialLibrary";
import { unavailableMaterialLibrary } from "./unavailableMaterialLibrary";
import { createEmptyMaterialPayload, MATERIAL_KINDS, validateMaterialPayload } from "../../domain/library";
import { createEmptyProjectPlanV15 } from "../../domain/plan/canvas/blockDocument";

const material = {
  id: "8f88ead0-f300-4666-8515-7bdfaa82c338",
  kind: "prop",
  name: "玻璃道具",
  description: "透明玻璃",
  tags: ["静物"],
  favorite: false,
  revision: 1,
  metadataVersion: 1,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  imageCount: 0,
  byteLength: 0,
  previewState: "pending",
  payload: {
    format: "preshot-material",
    version: 1,
    kind: "prop",
    component: { kind: "prop", title: "玻璃", source: "", gallery: { images: [] } },
  },
  images: [],
};

describe("Tauri material library boundary", () => {
  it("accepts native media copies only for image material insertion", async () => {
    const payload = validateMaterialPayload({ format: "preshot-material", version: 1, kind: "image", component: {
      kind: "image", name: "图片", description: "", images: [{ localImageId: "image-1", aspectRatio: 1, frameWidth: 100, frameHeight: 100 }],
    } });
    const input = { operationId: material.id, materialId: material.id, revision: 1,
      projectId: material.id, projectPath: "C:\\project", expectedPlan: createEmptyProjectPlanV15("test", { makeId: () => "anchor" }) };
    const result = { operationId: input.operationId, materialId: material.id, revision: 1, payload,
      images: [{ localImageId: "image-1", file: "media/0001.png" }] };
    const invokeCommand = vi.fn().mockResolvedValue(result);
    const repository = createTauriMaterialLibrary({ invokeCommand });
    expect(await repository.prepareInsert(input)).toEqual(result);
    for (const file of ["references/0001.png", "media/../0001.png", "C:/media/0001.png"]) {
      invokeCommand.mockResolvedValue({ ...result, images: [{ localImageId: "image-1", file }] });
      await expect(repository.prepareInsert(input)).rejects.toThrow("无法准备插入素材");
    }
    invokeCommand.mockResolvedValue({ ...result, payload: { ...payload, kind: "imageGroup", component: { ...payload.component, kind: "imageGroup" } } });
    await expect(repository.prepareInsert(input)).rejects.toThrow("无法准备插入素材");
  });

  it("imports one encoded clipboard image without selecting a filesystem path", async () => {
    const staged = { localImageId: "pasted", mimeType: "image/png", byteLength: 3, width: 20, height: 30, dataUrl: "data:image/png;base64,YWJj" };
    const invokeCommand = vi.fn().mockResolvedValue(staged);
    const imagePicker = { pickImageFiles: vi.fn() };
    const editor = createTauriMaterialLibrary({ invokeCommand, imagePicker }).contentEditor!;
    const input = { name: "clipboard.png", mimeType: "image/png", bytes: [97, 98, 99] };
    expect(await editor.importEditImageData!("draft", input)).toEqual(staged);
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("library_import_edit_image_data", { sessionId: "draft", input });
    expect(imagePicker.pickImageFiles).not.toHaveBeenCalled();
  });

  it.each([
    { name: "..\\outside.png", mimeType: "image/png", bytes: [1] },
    { name: "clipboard.gif", mimeType: "image/gif", bytes: [1] },
    { name: "clipboard.jpg", mimeType: "image/png", bytes: [1] },
    { name: "clipboard.png", mimeType: "image/png", bytes: [] },
    { name: "clipboard.png", mimeType: "image/png", bytes: [256] },
    { name: "clipboard.png", mimeType: "image/png", bytes: [0.5] },
  ])("rejects invalid encoded import envelopes before native invocation: %j", async (input) => {
    const invokeCommand = vi.fn();
    const editor = createTauriMaterialLibrary({ invokeCommand }).contentEditor!;
    await expect(editor.importEditImageData!("draft", input)).rejects.toThrow("无法粘贴素材图片");
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("preserves explicit instance identity while keeping legacy image JSON unchanged", async () => {
    const image = { localImageId: "image-1", blobId: "a".repeat(64), mimeType: "image/png", byteLength: 3, width: 20, height: 30 };
    const detail = {
      ...material, imageCount: 1, byteLength: 3,
      payload: { ...material.payload, component: { ...material.payload.component, gallery: { images: [
        { localImageId: "image-1", aspectRatio: 1, frameWidth: 100, frameHeight: 100, caption: "" },
      ] } } },
      images: [image],
    };
    const invokeCommand = vi.fn().mockResolvedValue(detail);
    const repository = createTauriMaterialLibrary({ invokeCommand });
    expect((await repository.get(material.id)).images).toEqual([image]);
    expect("storageId" in (await repository.get(material.id)).images[0]).toBe(false);
    const instance = { ...image, storageId: "11111111-1111-4111-8111-111111111111" };
    invokeCommand.mockResolvedValue({ ...detail, images: [instance] });
    expect((await repository.get(material.id)).images).toEqual([instance]);
    for (const storageId of ["invalid", "../objects/a", "", null, 123, "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"]) {
      invokeCommand.mockResolvedValue({ ...detail, images: [{ ...image, storageId }] });
      await expect(repository.get(material.id)).rejects.toThrow();
    }
  });

  it("rejects encoded import replies for another MIME type or byte length", async () => {
    const invokeCommand = vi.fn().mockResolvedValue({
      localImageId: "pasted", mimeType: "image/jpeg", byteLength: 3, width: 2, height: 3,
      dataUrl: "data:image/jpeg;base64,YWJj",
    });
    const editor = createTauriMaterialLibrary({ invokeCommand }).contentEditor!;
    await expect(editor.importEditImageData!("draft", {
      name: "clipboard.png", mimeType: "image/png", bytes: [1, 2, 3],
    })).rejects.toThrow("回执");
    await expect(editor.importEditImageData!("draft", {
      name: "clipboard.jpg", mimeType: "image/jpeg", bytes: [1, 2],
    })).rejects.toThrow("回执");
  });

  const sessionId = "cb481ce3-64d4-4cd4-9cbb-79eb9d0a3c88";
  const newDraft = {
    ...material, name: "", description: "", tags: [], favorite: false, revision: 0, metadataVersion: 0,
  };

  it.each(MATERIAL_KINDS)("opens a project-free %s creation draft without a canonical save", async (kind) => {
    const payload = createEmptyMaterialPayload(kind, "New material");
    const draft = { ...newDraft, kind, payload };
    const invokeCommand = vi.fn().mockResolvedValue({ sessionId, isNew: true, material: draft });
    const editor = createTauriMaterialLibrary({ invokeCommand }).contentEditor!;
    expect(await editor.beginCreate(payload)).toEqual({ sessionId, isNew: true, material: draft });
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("library_begin_create", { payload });
  });

  it.each([
    { revision: 1 }, { metadataVersion: 1 }, { name: "Published" }, { description: "Not empty" },
    { tags: ["tag"] }, { favorite: true }, { deletedAt: 1 }, { imageCount: 1 },
    { byteLength: 1 }, { previewState: "ready" }, { previewPartial: true },
  ])("rejects creation replies that are not pristine drafts: %j", async (override) => {
    const editor = createTauriMaterialLibrary({
      invokeCommand: vi.fn().mockResolvedValue({ sessionId, isNew: true, material: { ...newDraft, ...override } }),
    }).contentEditor!;
    await expect(editor.beginCreate(validateMaterialPayload(material.payload))).rejects.toThrow();
  });

  it("requires an explicit creation flag and the requested seed", async () => {
    const invokeCommand = vi.fn().mockResolvedValue({ sessionId, material: newDraft });
    const editor = createTauriMaterialLibrary({ invokeCommand }).contentEditor!;
    await expect(editor.beginCreate(validateMaterialPayload(material.payload))).rejects.toThrow("草稿类型");
    invokeCommand.mockResolvedValue({ sessionId, isNew: true, material: newDraft });
    await expect(editor.beginCreate(createEmptyMaterialPayload("prop", "Different seed"))).rejects.toThrow("不一致");
  });

  it("never accepts zero-version creation drafts at canonical read, edit or commit boundaries", async () => {
    const invokeCommand = vi.fn().mockResolvedValue(newDraft);
    const repository = createTauriMaterialLibrary({ invokeCommand });
    await expect(repository.get(material.id)).rejects.toThrow();
    await expect(repository.contentEditor!.commitEdit({
      sessionId, operationId: material.id, payload: validateMaterialPayload(material.payload),
    })).rejects.toThrow();
    invokeCommand.mockResolvedValue({ items: [newDraft], total: 1, indexState: "ready" });
    await expect(repository.search({ query: "", sort: "recent", offset: 0, limit: 24 })).rejects.toThrow();
    invokeCommand.mockResolvedValue({ sessionId, isNew: true, material: newDraft });
    await expect(repository.contentEditor!.beginEdit(material.id, 1)).rejects.toThrow("创建草稿");
  });

  it("permanently deletes by canonical identity and expected metadata version only", async () => {
    const invokeCommand = vi.fn().mockResolvedValue(null);
    const repository = createTauriMaterialLibrary({ invokeCommand });
    await repository.purge(material.id, 3);
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("library_purge", {
      id: material.id, expectedVersion: 3,
    });
    invokeCommand.mockRejectedValue({ code: "library_purge_in_use", message: "Material is still in use" });
    await expect(repository.purge(material.id, 3)).rejects.toMatchObject({
      code: "library_purge_in_use", message: expect.stringContaining("无法永久删除素材"),
    });
    await expect(unavailableMaterialLibrary.purge(material.id, 3)).rejects.toThrow("桌面版");
  });

  it.each([
    ["library_not_deleted", "只能永久删除回收站中的素材"],
    ["library_metadata_conflict", "素材已发生变化"],
    ["library_purge_in_use", "请先保存或取消编辑"],
    ["library_purge_cleanup_pending", "尚未完全清理"],
    ["library_purged", "素材已永久删除"],
    ["library_create_conflict", "这份素材已保存"],
  ])("explains %s without exposing internal version values", async (code, message) => {
    const repository = createTauriMaterialLibrary({
      invokeCommand: vi.fn().mockRejectedValue({ code, message: "Native diagnostic" }),
    });
    await expect(repository.purge(material.id, 3)).rejects.toMatchObject({
      code, message: expect.stringContaining(message),
    });
  });

  it("opens an isolated content draft and commits its portable payload with a stable receipt", async () => {
    const sessionId = "cb481ce3-64d4-4cd4-9cbb-79eb9d0a3c88";
    const invokeCommand = vi.fn().mockResolvedValueOnce({ sessionId, material })
      .mockResolvedValueOnce({ ...material, revision: 2 }).mockResolvedValueOnce(null);
    const editor = createTauriMaterialLibrary({ invokeCommand }).contentEditor!;
    expect(await editor.beginEdit(material.id, 1)).toMatchObject({ sessionId, material });
    const input = { operationId: "5297f8bc-c647-4940-9be0-e9620f7d5c46", sessionId, payload: validateMaterialPayload(material.payload) };
    expect((await editor.commitEdit(input)).revision).toBe(2);
    await editor.discardEdit(sessionId);
    expect(invokeCommand.mock.calls).toEqual([
      ["library_begin_edit", { materialId: material.id, revision: 1 }],
      ["library_commit_edit", { input }],
      ["library_discard_edit", { sessionId }],
    ]);
  });

  it("sends metadata and content in one commit command without a separate metadata update", async () => {
    const metadata = { name: "一起保存", description: "素材信息", tags: ["新标签"], favorite: true };
    const saved = { ...material, ...metadata, revision: 2, metadataVersion: material.metadataVersion + 1 };
    const invokeCommand = vi.fn().mockResolvedValue(saved);
    const editor = createTauriMaterialLibrary({ invokeCommand }).contentEditor!;
    const input = {
      operationId: "5297f8bc-c647-4940-9be0-e9620f7d5c46",
      sessionId: "cb481ce3-64d4-4cd4-9cbb-79eb9d0a3c88", payload: validateMaterialPayload(material.payload),
      metadataUpdate: { expectedVersion: material.metadataVersion, metadata },
    };
    expect(await editor.commitEdit(input)).toMatchObject(saved);
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("library_commit_edit", { input });
  });

  it("does not import anything when the image picker is cancelled", async () => {
    const invokeCommand = vi.fn();
    const pickImageFiles = vi.fn(async () => []);
    const editor = createTauriMaterialLibrary({ invokeCommand, imagePicker: { pickImageFiles } }).contentEditor!;
    expect(await editor.importEditImages("draft")).toEqual([]);
    expect(pickImageFiles).toHaveBeenCalledWith("选择素材图片");
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("loads, imports and crops only through session-qualified image commands", async () => {
    const staged = { localImageId: "new-image", mimeType: "image/png", byteLength: 3, width: 20, height: 30, dataUrl: "data:image/png;base64,YWJj" };
    const invokeCommand = vi.fn().mockResolvedValueOnce(staged.dataUrl)
      .mockResolvedValueOnce([staged]).mockResolvedValueOnce(staged);
    const imagePicker = { pickImageFiles: vi.fn(async () => ["C:\\photos\\cup.png"]) };
    const editor = createTauriMaterialLibrary({ invokeCommand, imagePicker }).contentEditor!;
    expect(await editor.loadEditImage("draft", "original-image")).toBe(staged.dataUrl);
    expect(await editor.importEditImages("draft")).toEqual([staged]);
    const bounds = { x: 1, y: 2, width: 20, height: 30 };
    expect(await editor.cropEditImage("draft", "original-image", bounds)).toEqual(staged);
    expect(invokeCommand.mock.calls).toEqual([
      ["library_load_edit_image", { sessionId: "draft", localImageId: "original-image" }],
      ["library_import_edit_images", { sessionId: "draft", sourcePaths: ["C:\\photos\\cup.png"] }],
      ["library_crop_edit_image", { sessionId: "draft", localImageId: "original-image", bounds }],
    ]);
  });

  it.each([
    { localImageId: "image", mimeType: "image/png", byteLength: 3, width: 8192, height: 8192, dataUrl: "data:image/png;base64,YWJj" },
    { localImageId: "image", mimeType: "image/png", byteLength: 3, width: 10, height: 20, dataUrl: "https://example.com/image.png" },
    { localImageId: "", mimeType: "image/png", byteLength: 3, width: 10, height: 20, dataUrl: "data:image/png;base64,YWJj" },
  ])("rejects malformed staged image responses", async (staged) => {
    const editor = createTauriMaterialLibrary({
      invokeCommand: vi.fn().mockResolvedValue([staged]),
      imagePicker: { pickImageFiles: vi.fn(async () => ["selected.png"]) },
    }).contentEditor!;
    await expect(editor.importEditImages("draft")).rejects.toThrow();
  });

  it("rejects a draft for a different material or content revision", async () => {
    const editor = createTauriMaterialLibrary({
      invokeCommand: vi.fn().mockResolvedValue({
        sessionId: "cb481ce3-64d4-4cd4-9cbb-79eb9d0a3c88", material: { ...material, revision: 2 },
      }),
    }).contentEditor!;
    await expect(editor.beginEdit(material.id, 1)).rejects.toThrow();
  });

  it.each([
    [{ code: "library_revision", message: "Changed" }, "rejected"],
    [{ code: "library_metadata_conflict", message: "Metadata changed" }, "rejected"],
    [{ code: "library_metadata", message: "Invalid metadata" }, "rejected"],
    [{ code: "library_kind", message: "Wrong kind" }, "rejected"],
    [{ code: "library_edit_limit", message: "Limit" }, "rejected"],
    [{ code: "library_edit_image_corrupt", message: "Corrupt staged image" }, "rejected"],
    [{ code: "library_operation_conflict", message: "Another request used this receipt" }, "unknown"],
    [{ code: "library_create_conflict", message: "An earlier creation already committed" }, "unknown"],
    [{ code: "library_corrupt", message: "Unreadable receipt" }, "unknown"],
    [{ code: "library_database", message: "Unavailable" }, "unknown"],
    [new Error("connection lost"), "unknown"],
  ])("distinguishes a definite save rejection from an unconfirmed result", async (failure, outcome) => {
    const editor = createTauriMaterialLibrary({
      invokeCommand: vi.fn().mockRejectedValue(failure),
    }).contentEditor!;
    await expect(editor.commitEdit({
      operationId: "operation", sessionId: "session", payload: validateMaterialPayload(material.payload),
    })).rejects.toMatchObject({ name: "MaterialContentSaveError", outcome });
  });

  it("passes plain Chinese queries through a narrow typed search command", async () => {
    const invokeCommand = vi.fn().mockResolvedValue({
      items: [material], total: 1, indexState: "ready",
    });
    const repository = createTauriMaterialLibrary({ invokeCommand });
    const input = { query: "玻璃 OR", sort: "relevance" as const, offset: 0, limit: 50 };
    expect((await repository.search(input)).items[0].name).toBe("玻璃道具");
    expect(invokeCommand).toHaveBeenCalledWith("library_search", { input });
  });

  it("passes an exact name to native search without converting it to a full-text query", async () => {
    const invokeCommand = vi.fn().mockResolvedValue({
      items: [material], total: 1, indexState: "ready",
    });
    const repository = createTauriMaterialLibrary({ invokeCommand });
    const input = { query: "", exactName: material.name, sort: "name" as const, offset: 0, limit: 1 };
    expect((await repository.search(input)).items[0].name).toBe(material.name);
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("library_search", { input });
  });

  it("rejects malformed canonical payloads rather than exposing broken content", async () => {
    const repository = createTauriMaterialLibrary({
      invokeCommand: vi.fn().mockResolvedValue({
        ...material, payload: { ...material.payload, version: 999 },
      }),
    });
    await expect(repository.get(material.id)).rejects.toThrow();
  });

  it("does not accept external image URLs from the native boundary", async () => {
    const repository = createTauriMaterialLibrary({
      invokeCommand: vi.fn().mockResolvedValue("https://example.com/private.png"),
    });
    await expect(repository.loadImage(material.id, 1, "i1")).rejects.toThrow();
  });

  it("preserves operation context and native failure code", async () => {
    const cause = { code: "library_conflict", message: "素材已被修改" };
    const repository = createTauriMaterialLibrary({
      invokeCommand: vi.fn().mockRejectedValue(cause),
    });
    await expect(repository.setDeleted(material.id, 1, true)).rejects.toMatchObject({
      message: expect.stringContaining("素材已被修改"),
      code: "library_conflict",
      cause,
    });
  });

  it("supports an absent thumbnail without concealing source-image errors", async () => {
    const invokeCommand = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const repository = createTauriMaterialLibrary({ invokeCommand });
    await expect(repository.loadPreview(material.id, 1)).resolves.toBeNull();
    expect(invokeCommand).toHaveBeenCalledWith("library_load_preview", {
      id: material.id, revision: 1,
      renderKey: "preshot-material-preview:v6:plan15:bn0.53:light:900:480:8192:8M:png",
    });
    await expect(repository.loadImage(material.id, 1, "i1")).rejects.toThrow();
  });

  it("keeps browser operations explicitly unavailable", async () => {
    expect(unavailableMaterialLibrary.availability).toBe("unavailable");
    await expect(unavailableMaterialLibrary.search({
      query: "", sort: "recent", offset: 0, limit: 50,
    })).rejects.toThrow("桌面");
  });
});
