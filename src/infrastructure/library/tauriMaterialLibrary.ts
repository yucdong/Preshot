import { ui } from "../../shared/i18n/ui";
import { MATERIAL_IMAGE_MAX_BYTES } from "../../domain/library/imageLimits";
import { MATERIAL_PREVIEW_RENDER_KEY } from "./materialPreviewCache";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  MaterialContentSaveError,
  validateMaterialMetadata,
  validateMaterialPayload,
} from "../../domain/library";
import type {
  MaterialDetail,
  MaterialEditImage,
  MaterialImage,
  MaterialKind,
  MaterialSummary,
  PreparedMaterialInsert,
} from "../../domain/library/models";
import type { MaterialLibraryRepository } from "../../domain/library/ports";
import { assertLocalImageId } from "../../domain/library/validation";
import type { PlanImagePicker, ScreenCapture } from "../../domain/plan/ports";
import { planImagePicker } from "../plan/planDialog";
import { createTauriScreenCapture } from "../plan/screenCapture";
import { captureMaterialEditImage } from "./captureMaterialEditImage";
import { unavailableMaterialLibrary } from "./unavailableMaterialLibrary";

export function createPlatformMaterialLibrary(): MaterialLibraryRepository {
  return isTauri() ? createTauriMaterialLibrary() : unavailableMaterialLibrary;
}

type InvokeCommand = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
interface Dependencies {
  invokeCommand?: InvokeCommand;
  imagePicker?: Pick<PlanImagePicker, "pickImageFiles">;
  screenCapture?: ScreenCapture;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(ui("素材库返回了无效数据"));
  }
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error(ui("素材库文本字段无效"));
  return value;
}
function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(ui("素材库数值字段无效"));
  }
  return value;
}
function identifier(value: unknown): string {
  const id = text(value);
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) {
    throw new Error(ui("素材库标识无效"));
  }
  return id;
}
function kind(value: unknown): MaterialKind {
  if (value === "image" || value === "imageGroup" || value === "shootingLocation" || value === "modelCard" || value === "prop" || value === "clothing") {
    return value;
  }
  throw new Error(ui("素材类型不受支持"));
}
function summary(value: unknown, creationDraft = false): MaterialSummary {
  const item = record(value);
  if (!Array.isArray(item.tags) || typeof item.favorite !== "boolean") {
    throw new Error(ui("素材库标签或收藏状态无效"));
  }
  const previewState = item.previewState;
  if (previewState !== "pending" && previewState !== "ready" && previewState !== "failed") {
    throw new Error(ui("素材库预览状态无效"));
  }
  if (item.previewPartial !== undefined && typeof item.previewPartial !== "boolean") {
    throw new Error(ui("素材库预览范围无效"));
  }
  const createdAt = integer(item.createdAt);
  const metadata = {
    name: text(item.name), description: text(item.description),
    tags: item.tags.map(text), favorite: item.favorite,
  };
  if (creationDraft && (metadata.name !== "" || metadata.description !== "" ||
      metadata.tags.length !== 0 || metadata.favorite || item.deletedAt !== null ||
      item.imageCount !== 0 || item.byteLength !== 0 || previewState !== "pending" || item.previewPartial === true)) {
    throw new Error(ui("新素材必须是尚未保存的空白草稿"));
  }
  return {
    ...(creationDraft ? metadata : validateMaterialMetadata(metadata)),
    id: identifier(item.id),
    kind: kind(item.kind),
    revision: integer(item.revision, creationDraft ? 0 : 1, creationDraft ? 0 : Number.MAX_SAFE_INTEGER),
    metadataVersion: integer(item.metadataVersion, creationDraft ? 0 : 1, creationDraft ? 0 : Number.MAX_SAFE_INTEGER),
    createdAt,
    updatedAt: integer(item.updatedAt, createdAt),
    deletedAt: item.deletedAt === null ? null : integer(item.deletedAt, createdAt),
    imageCount: integer(item.imageCount, 0, 128),
    byteLength: integer(item.byteLength, 0),
    previewState,
    ...(item.previewPartial === undefined ? {} : { previewPartial: item.previewPartial }),
  };
}
function image(value: unknown): MaterialImage {
  const item = record(value);
  const mimeType = item.mimeType;
  if (mimeType !== "image/jpeg" && mimeType !== "image/png") throw new Error(ui("素材图片类型无效"));
  const localImageId = text(item.localImageId);
  const blobId = text(item.blobId);
  if (!localImageId || !/^[a-f0-9]{64}$/.test(blobId)) throw new Error(ui("素材图片标识无效"));
  assertLocalImageId(localImageId);
  const storageId = item.storageId === undefined ? undefined : identifier(item.storageId);
  if (storageId !== undefined && storageId !== storageId.toLowerCase()) throw new Error(ui("素材图片存储标识无效"));
  const width = integer(item.width, 1, 0xffffffff);
  const height = integer(item.height, 1, 0xffffffff);
  return {
    localImageId,
    blobId,
    ...(storageId === undefined ? {} : { storageId }),
    mimeType,
    byteLength: integer(item.byteLength, 1),
    width,
    height,
  };
}
function detail(value: unknown, creationDraft = false): MaterialDetail {
  const item = record(value);
  const result = summary(item, creationDraft);
  const payload = validateMaterialPayload(item.payload);
  if (!Array.isArray(item.images) || result.kind !== payload.kind) throw new Error(ui("素材内容与类型不一致"));
  const images = item.images.map(image);
  if (result.kind === "image" && images.length !== (creationDraft ? 0 : 1)) {
    throw new Error(ui("图片素材必须包含一张图片"));
  }
  const component = payload.component;
  const occurrences = (component.kind === "image" || component.kind === "imageGroup") ? component.images
    : component.kind === "modelCard" ? component.samples.images
      : component.kind === "clothing" ? component.mainGallery.images
        : component.gallery.images;
  if (
    images.length !== result.imageCount ||
    images.length !== occurrences.length ||
    new Set(images.map((entry) => entry.localImageId)).size !== images.length ||
    new Set(images.flatMap((entry) => entry.storageId ? [entry.storageId] : [])).size !==
      images.filter((entry) => entry.storageId !== undefined).length ||
    result.byteLength !== images.reduce((sum, entry) => sum + entry.byteLength, 0) ||
    occurrences.some((entry, index) => images[index].localImageId !== entry.localImageId)
  ) {
    throw new Error(ui("素材图片清单与内容不一致"));
  }
  return { ...result, payload, images };
}
function dataUrl(value: unknown, maximumBytes: number): string {
  const url = text(value);
  if (
    url.length > Math.ceil(maximumBytes * 4 / 3) + 100 ||
    !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(url)
  ) {
    throw new Error(ui("素材图片数据无效或超出大小限制"));
  }
  return url;
}
function editImage(value: unknown): MaterialEditImage {
  const item = record(value);
  assertLocalImageId(item.localImageId);
  const mimeType = item.mimeType;
  if (mimeType !== "image/jpeg" && mimeType !== "image/png") throw new Error(ui("素材图片类型无效"));
  const width = integer(item.width, 1, 0xffffffff);
  const height = integer(item.height, 1, 0xffffffff);
  const byteLength = integer(item.byteLength, 1);
  const axes = item.presentationAxes;
  if (axes !== undefined && axes !== "raw" && axes !== "exif") throw new Error("Invalid image presentation axes");
  const display = item.displayWidth !== undefined || item.displayHeight !== undefined ? {
    displayWidth: integer(item.displayWidth, 1, 0xffffffff), displayHeight: integer(item.displayHeight, 1, 0xffffffff),
  } : {};
  if (axes === "exif" && (!display.displayWidth || !display.displayHeight)) throw new Error("Missing EXIF display dimensions");
  const previewError = typeof item.previewError === "string" && item.previewError ? item.previewError : undefined;
  const url = item.dataUrl === "" && previewError ? "" : dataUrl(item.dataUrl, MATERIAL_IMAGE_MAX_BYTES);
  return { localImageId: item.localImageId, mimeType, byteLength, width, height, dataUrl: url,
    ...(axes === undefined ? {} : { presentationAxes: axes }), ...display, ...(previewError ? { previewError } : {}) };
}
function prepared(value: unknown): PreparedMaterialInsert {
  const item = record(value);
  const payload = validateMaterialPayload(item.payload);
  let selection: PreparedMaterialInsert["selection"];
  if (item.selection !== undefined) {
    const selected = record(item.selection);
    if ((selected.mode !== "images" && selected.mode !== "imageGroup") || !Array.isArray(selected.imageIds) ||
        selected.imageIds.length === 0 || selected.imageIds.length > 128 || payload.component.kind !== "imageGroup") {
      throw new Error(ui("插入图片选择无效"));
    }
    const imageIds = selected.imageIds.map((id) => text(id));
    if (new Set(imageIds).size !== imageIds.length || imageIds.length !== payload.component.images.length ||
        payload.component.images.some((image) => !imageIds.includes(image.localImageId))) throw new Error(ui("插入图片与选择不一致"));
    selection = { imageIds, mode: selected.mode };
  }
  if (!Array.isArray(item.images) || item.images.length > 128) throw new Error(ui("插入图片清单无效"));
  const targetGroupId = item.targetGroupId === undefined ? undefined : text(item.targetGroupId);
  if (targetGroupId !== undefined && (!targetGroupId || !["image", "imageGroup"].includes(payload.kind) || selection?.mode === "images")) {
    throw new Error(ui("目标图片组或插入形式无效"));
  }
  return {
    operationId: identifier(item.operationId),
    materialId: identifier(item.materialId),
    revision: integer(item.revision, 1),
    payload,
    ...(selection ? { selection } : {}),
    ...(targetGroupId !== undefined ? { targetGroupId } : {}),
    images: item.images.map((entry) => {
      const source = record(entry);
      const file = text(source.file);
      const pattern = targetGroupId === undefined && (payload.kind === "image" || selection?.mode === "images") ? /^media\/[0-9]{4,}\.(?:jpg|png)$/ : /^references\/[0-9]{4,}\.(?:jpg|png)$/;
      if (!pattern.test(file)) {
        throw new Error(ui("插入图片必须属于项目中对应的图片目录"));
      }
      return { localImageId: text(source.localImageId), file };
    }),
  };
}

function materialFailureMessage(code: string): string | undefined {
  switch (code) {
    case "library_size":
    case "library_image_size": return ui("文件为空或超过大小限制。单张素材图片上限为 64 MiB，请选择有效的 JPG/PNG 文件。");
    case "library_image_dimensions": return ui("图片尺寸信息无效或缩略图尺寸不符合要求，请重新选择有效的 JPG/PNG 图片。");
    case "library_image_render": return ui("无法按当前画幅生成素材图片。请检查原图或缩小图片尺寸后重试。");
    case "library_insert_selection": return ui("所选图片或插入形式已变化，请重新选择后再插入。");
    case "library_not_deleted": return ui("只能永久删除回收站中的素材，请重新打开素材库后重试。");
    case "library_metadata_conflict": return ui("素材已发生变化，请重新打开素材库后重试。");
    case "library_purge_in_use": return ui("素材仍有未完成的编辑，请先保存或取消编辑，再重试永久删除。");
    case "library_purge_cleanup_pending": return ui("素材已删除，但图片或缩略图尚未完全清理。请关闭占用文件的程序后重试。");
    case "library_purged": return ui("素材已永久删除，请关闭窗口后重新操作。");
    case "library_create_conflict": return ui("这份素材已保存，不能重复创建；需要重新打开已保存的素材才能继续编辑。");
  }
}

export class MaterialLibraryNativeError extends Error {
  readonly code: string;
  constructor(operation: string, cause: unknown) {
    const native = cause && typeof cause === "object" ? cause : null;
    const code = native && "code" in native && typeof native.code === "string"
      ? native.code : "library_operation_failed";
    const message = materialFailureMessage(code) ??
      (native && "message" in native && typeof native.message === "string" ? native.message : String(cause));
    super(`${operation}：${message}`, { cause });
    this.name = "MaterialLibraryNativeError";
    this.code = code;
  }
}

export function createTauriMaterialLibrary({
  invokeCommand = invoke,
  imagePicker = planImagePicker,
  screenCapture = createTauriScreenCapture({ invokeCommand }),
}: Dependencies = {}): MaterialLibraryRepository {
  async function call<T>(
    operation: string,
    command: string,
    args: Record<string, unknown>,
    read: (value: unknown) => T,
  ): Promise<T> {
    try {
      return read(await invokeCommand(command, args));
    } catch (error) {
      throw new MaterialLibraryNativeError(operation, error);
    }
  }
  const nothing = () => undefined;
  return {
    availability: "desktop",
    imageRepresentation: "display",
    contentEditor: {
      beginCreate: (payload) => call(
        ui("无法创建素材草稿"), "library_begin_create", { payload }, (value) => {
          const item = record(value);
          if (item.isNew !== true) throw new Error(ui("创建素材返回了错误的草稿类型"));
          const material = detail(item.material, true);
          if (JSON.stringify(material.payload) !== JSON.stringify(validateMaterialPayload(payload))) {
            throw new Error(ui("新素材草稿与所选组件不一致"));
          }
          return { sessionId: identifier(item.sessionId), material, isNew: true };
        },
      ),
      beginEdit: (materialId, revision) => call(
        ui("无法打开素材编辑画布"), "library_begin_edit", { materialId, revision }, (value) => {
          const item = record(value);
          if (item.isNew !== undefined && item.isNew !== false) throw new Error(ui("不能将创建草稿作为已保存素材打开"));
          const material = detail(item.material);
          if (material.id !== materialId || material.revision !== revision || material.deletedAt !== null) {
            throw new Error(ui("素材已变化，请刷新素材库后重新编辑"));
          }
          return { sessionId: identifier(item.sessionId), material };
        },
      ),
      loadEditImage: (sessionId, localImageId, axes) => call(
        ui("无法读取素材草稿图片"), "library_load_edit_image", { sessionId, localImageId, ...(axes === undefined ? {} : { presentationAxes: axes }) },
        (value) => dataUrl(value, MATERIAL_IMAGE_MAX_BYTES),
      ),
      revealEditImage: (sessionId, localImageId) => call(
        ui("无法打开原图所在位置"), "library_reveal_edit_image", { sessionId, localImageId }, nothing,
      ),
      revealEditImageGroup: (sessionId) => call(
        ui("无法打开原图所在位置"), "library_reveal_edit_image_group", { sessionId }, nothing,
      ),
      async importEditImageData(sessionId, input) {
        if (typeof input.name !== "string" || !input.name || input.name.length > 255 ||
            /[\\/:<>"|?*]/.test(input.name) ||
            Array.from(input.name).some((char) => char.charCodeAt(0) < 32 ||
              (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159)) ||
            !/\.(?:jpe?g|png)$/i.test(input.name) ||
            (input.mimeType !== "image/png" && input.mimeType !== "image/jpeg") ||
            (input.mimeType === "image/png") !== /\.png$/i.test(input.name) ||
            !Array.isArray(input.bytes) || input.bytes.length === 0 ||
            input.bytes.length > MATERIAL_IMAGE_MAX_BYTES ||
            input.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
          throw new MaterialLibraryNativeError(ui("无法粘贴素材图片"), ui("请选择有效的 JPG/PNG 图片，且大小不超过 64 MiB"));
        }
        return call(ui("无法粘贴素材图片"), "library_import_edit_image_data", { sessionId, input }, (value) => {
          const image = editImage(value);
          if (image.mimeType !== input.mimeType || image.byteLength !== input.bytes.length) {
            throw new Error(ui("粘贴图片回执与输入数据不一致"));
          }
          return image;
        });
      },
      importLibraryImages: (sessionId, materialId, revision, imageIds) => call(
        ui("无法导入素材图片"), "library_import_library_images", { sessionId, materialId, revision, imageIds }, value => {
          if (!Array.isArray(value) || value.length !== imageIds.length) throw new Error(ui("素材草稿图片清单无效"));
          return value.map(editImage);
        },
      ),
      async importEditImages(sessionId, onSelected) {
        let sourcePaths: string[];
        try {
          sourcePaths = await imagePicker.pickImageFiles(ui("选择素材图片"));
        } catch (error) {
          throw new MaterialLibraryNativeError(ui("无法选择素材图片"), error);
        }
        if (sourcePaths.length === 0) return [];
        onSelected?.(sourcePaths.length);
        return call(ui("无法导入素材图片"), "library_import_edit_images", { sessionId, sourcePaths }, (value) => {
          if (!Array.isArray(value) || value.length > 128) throw new Error(ui("素材草稿图片清单无效"));
          const images = value.map(editImage);
          if (new Set(images.map((image) => image.localImageId)).size !== images.length) {
            throw new Error(ui("素材草稿图片标识重复"));
          }
          return images;
        });
      },
      async captureEditImage(sessionId, cancellation, review) {
        try {
          return await captureMaterialEditImage(screenCapture, cancellation, (path) => call(
            ui("无法导入素材截图"), "library_import_edit_images", { sessionId, sourcePaths: [path] },
            (value) => {
              if (!Array.isArray(value) || value.length !== 1) throw new Error(ui("素材截图必须返回一张草稿图片"));
              return editImage(value[0]);
            },
          ), review);
        } catch (error) {
          throw new MaterialLibraryNativeError(ui("无法截图到素材草稿"), error);
        }
      },
      cropEditImage: (sessionId, localImageId, bounds, axes) => call(
        ui("无法裁切素材图片"), "library_crop_edit_image", { sessionId, localImageId, bounds, ...(axes === undefined ? {} : { presentationAxes: axes }) }, editImage,
      ),
      async commitEdit(input) {
        try {
          return await call(ui("无法保存素材"), "library_commit_edit", { input }, detail);
        } catch (error) {
          const rejected = error instanceof MaterialLibraryNativeError &&
            /^(library_(?:revision|metadata|metadata_conflict|deleted|not_found|kind|invalid_id|payload|validation|edit_limit|edit_not_found|edit_corrupt|image_not_found|edit_image_corrupt|image_corrupt|image_size|image_dimensions|image_format|image_decode|size))$/.test(error.code);
          throw new MaterialContentSaveError(
            error instanceof Error ? error.message : ui("无法确认素材保存结果"),
            rejected ? "rejected" : "unknown",
            { cause: error },
          );
        }
      },
      discardEdit: (sessionId) => call(ui("无法清理素材编辑草稿"), "library_discard_edit", { sessionId }, nothing),
    },
    search: (input) => call(ui("无法搜索素材库"), "library_search", { input }, (value) => {
      const result = record(value);
      if (!Array.isArray(result.items) || result.items.length > 100) throw new Error(ui("搜索结果无效"));
      if (result.indexState !== "ready" && result.indexState !== "rebuilding") throw new Error(ui("检索索引状态无效"));
      return { items: result.items.map((item) => summary(item)), total: integer(result.total), indexState: result.indexState };
    }),
    get: (id) => call(ui("无法读取素材"), "library_get", { id }, detail),
    save: (input) => call(ui("无法保存素材"), "library_save", { input }, detail),
    updateMetadata: (id, expectedVersion, metadata) => call(
      ui("无法修改素材信息"), "library_update_metadata", { id, expectedVersion, metadata }, summary,
    ),
    setDeleted: (id, expectedVersion, deleted) => call(
      deleted ? ui("无法删除素材") : ui("无法恢复素材"),
      "library_set_deleted", { id, expectedVersion, deleted }, summary,
    ),
    purge: (id, expectedVersion) => call(
      ui("无法永久删除素材"), "library_purge", { id, expectedVersion }, nothing,
    ),
    loadImage: async (materialId, revision, localImageId, display) => {
      if (!display) return call(ui("无法读取素材图片"), "library_load_image", { id: materialId, revision, localImageId },
        value => dataUrl(value, MATERIAL_IMAGE_MAX_BYTES));
      const id = crypto.randomUUID();
      let finished = false;
      const pending = call(ui("无法读取素材图片"), "library_image_display", { materialId, revision, localImageId, edge: display.edge, id },
        value => dataUrl(value, MATERIAL_IMAGE_MAX_BYTES));
      void display.cancellation?.then(() => { if (!finished) void call(ui("素材预览已取消。"), "cancel_image_display", { id }, nothing).catch(() => undefined); });
      try { return await pending; } finally { finished = true; }
    },
    revealImage: (id, revision, localImageId) => call(
      ui("无法打开原图所在位置"), "library_reveal_image", { id, revision, localImageId }, nothing,
    ),
    revealImageGroup: (id, revision) => call(
      ui("无法打开原图所在位置"), "library_reveal_image_group", { id, revision }, nothing,
    ),
    loadPreview: (id, revision) => call(
      ui("无法读取素材预览"), "library_load_preview", { id, revision, renderKey: MATERIAL_PREVIEW_RENDER_KEY },
      (value) => value === null ? null : dataUrl(value, 2 * 1024 * 1024),
    ),
    savePreview: (id, revision, preview) => call(
      ui("无法保存素材预览"), "library_save_preview", { id, revision, preview }, nothing,
    ),
    markPreviewFailed: (id, revision) => call(
      ui("无法记录预览失败"), "library_mark_preview_failed", { id, revision }, nothing,
    ),
    prepareInsert: (input) => call(
      ui("无法准备插入素材"), "library_prepare_insert", { input }, prepared,
    ),
    commitInsert: (input) => call(
      ui("无法完成素材插入"), "library_commit_insert", { input }, nothing,
    ),
    abortInsert: (projectPath, operationId) => call(
      ui("无法清理未完成的素材插入"), "library_abort_insert", { projectPath, operationId }, nothing,
    ),
    getInsertStatus: (projectPath, operationId) => call(
      ui("无法确认素材插入状态"), "library_insert_status", { projectPath, operationId }, (value) => {
        if (value !== "prepared" && value !== "committed" && value !== "cancelled" && value !== "conflict") {
          throw new Error(ui("素材插入状态无效"));
        }
        return value;
      },
    ),
  };
}
