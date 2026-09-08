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
    throw new Error("素材库返回了无效数据");
  }
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("素材库文本字段无效");
  return value;
}
function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error("素材库数值字段无效");
  }
  return value;
}
function identifier(value: unknown): string {
  const id = text(value);
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) {
    throw new Error("素材库标识无效");
  }
  return id;
}
function kind(value: unknown): MaterialKind {
  if (value === "imageGroup" || value === "shootingLocation" || value === "modelCard" || value === "prop" || value === "clothing") {
    return value;
  }
  throw new Error("素材类型不受支持");
}
function summary(value: unknown, creationDraft = false): MaterialSummary {
  const item = record(value);
  if (!Array.isArray(item.tags) || typeof item.favorite !== "boolean") {
    throw new Error("素材库标签或收藏状态无效");
  }
  const previewState = item.previewState;
  if (previewState !== "pending" && previewState !== "ready" && previewState !== "failed") {
    throw new Error("素材库预览状态无效");
  }
  if (item.previewPartial !== undefined && typeof item.previewPartial !== "boolean") {
    throw new Error("素材库预览范围无效");
  }
  const createdAt = integer(item.createdAt);
  const metadata = {
    name: text(item.name), description: text(item.description),
    tags: item.tags.map(text), favorite: item.favorite,
  };
  if (creationDraft && (metadata.name !== "" || metadata.description !== "" ||
      metadata.tags.length !== 0 || metadata.favorite || item.deletedAt !== null ||
      item.imageCount !== 0 || item.byteLength !== 0 || previewState !== "pending" || item.previewPartial === true)) {
    throw new Error("新素材必须是尚未保存的空白草稿");
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
    byteLength: integer(item.byteLength, 0, 256 * 1024 * 1024),
    previewState,
    ...(item.previewPartial === undefined ? {} : { previewPartial: item.previewPartial }),
  };
}
function image(value: unknown): MaterialImage {
  const item = record(value);
  const mimeType = item.mimeType;
  if (mimeType !== "image/jpeg" && mimeType !== "image/png") throw new Error("素材图片类型无效");
  const localImageId = text(item.localImageId);
  const blobId = text(item.blobId);
  if (!localImageId || !/^[a-f0-9]{64}$/.test(blobId)) throw new Error("素材图片标识无效");
  return {
    localImageId,
    blobId,
    mimeType,
    byteLength: integer(item.byteLength, 1, 16 * 1024 * 1024),
    width: integer(item.width, 1, 8192),
    height: integer(item.height, 1, 8192),
  };
}
function detail(value: unknown, creationDraft = false): MaterialDetail {
  const item = record(value);
  const result = summary(item, creationDraft);
  const payload = validateMaterialPayload(item.payload);
  if (!Array.isArray(item.images) || result.kind !== payload.kind) throw new Error("素材内容与类型不一致");
  const images = item.images.map(image);
  const component = payload.component;
  const occurrences = component.kind === "imageGroup" ? component.images
    : component.kind === "modelCard" ? component.samples.images
      : component.kind === "clothing" ? component.mainGallery.images
        : component.gallery.images;
  if (
    images.length !== result.imageCount ||
    images.length !== occurrences.length ||
    new Set(images.map((entry) => entry.localImageId)).size !== images.length ||
    occurrences.some((entry) => !images.some((source) => source.localImageId === entry.localImageId))
  ) {
    throw new Error("素材图片清单与内容不一致");
  }
  return { ...result, payload, images };
}
function dataUrl(value: unknown, maximumBytes: number): string {
  const url = text(value);
  if (
    url.length > Math.ceil(maximumBytes * 4 / 3) + 100 ||
    !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(url)
  ) {
    throw new Error("素材图片数据无效或超出大小限制");
  }
  return url;
}
function editImage(value: unknown): MaterialEditImage {
  const item = record(value);
  assertLocalImageId(item.localImageId);
  const mimeType = item.mimeType;
  if (mimeType !== "image/jpeg" && mimeType !== "image/png") throw new Error("素材图片类型无效");
  const width = integer(item.width, 1, 8192);
  const height = integer(item.height, 1, 8192);
  const byteLength = integer(item.byteLength, 1, 16 * 1024 * 1024);
  const url = dataUrl(item.dataUrl, 16 * 1024 * 1024);
  const encoded = url.slice(url.indexOf(",") + 1);
  const decodedLength = encoded.length * 3 / 4 - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  if (width * height > 32_000_000 || !url.startsWith(`data:${mimeType};base64,`) ||
      encoded.length % 4 !== 0 || decodedLength !== byteLength) {
    throw new Error("素材图片尺寸或数据与清单不一致");
  }
  return { localImageId: item.localImageId, mimeType, byteLength, width, height, dataUrl: url };
}
function prepared(value: unknown): PreparedMaterialInsert {
  const item = record(value);
  const payload = validateMaterialPayload(item.payload);
  if (!Array.isArray(item.images) || item.images.length > 128) throw new Error("插入图片清单无效");
  return {
    operationId: identifier(item.operationId),
    materialId: identifier(item.materialId),
    revision: integer(item.revision, 1),
    payload,
    images: item.images.map((entry) => {
      const source = record(entry);
      const file = text(source.file);
      if (!/^references\/[0-9]{4,}\.(?:jpg|png)$/.test(file)) {
        throw new Error("插入图片必须属于项目的参考图片目录");
      }
      return { localImageId: text(source.localImageId), file };
    }),
  };
}

function materialFailureMessage(code: string): string | undefined {
  switch (code) {
    case "library_not_deleted": return "只能永久删除回收站中的素材，请重新打开素材库后重试。";
    case "library_metadata_conflict": return "素材已发生变化，请重新打开素材库后重试。";
    case "library_purge_in_use": return "素材仍有未完成的编辑，请先保存或取消编辑，再重试永久删除。";
    case "library_purge_cleanup_pending": return "素材已删除，但图片或缩略图尚未完全清理。请关闭占用文件的程序后重试。";
    case "library_purged": return "素材已永久删除，请关闭窗口后重新操作。";
    case "library_create_conflict": return "这份素材已保存，不能重复创建；需要重新打开已保存的素材才能继续编辑。";
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
    contentEditor: {
      beginCreate: (payload) => call(
        "无法创建素材草稿", "library_begin_create", { payload }, (value) => {
          const item = record(value);
          if (item.isNew !== true) throw new Error("创建素材返回了错误的草稿类型");
          const material = detail(item.material, true);
          if (JSON.stringify(material.payload) !== JSON.stringify(validateMaterialPayload(payload))) {
            throw new Error("新素材草稿与所选组件不一致");
          }
          return { sessionId: identifier(item.sessionId), material, isNew: true };
        },
      ),
      beginEdit: (materialId, revision) => call(
        "无法打开素材编辑画布", "library_begin_edit", { materialId, revision }, (value) => {
          const item = record(value);
          if (item.isNew !== undefined && item.isNew !== false) throw new Error("不能将创建草稿作为已保存素材打开");
          const material = detail(item.material);
          if (material.id !== materialId || material.revision !== revision || material.deletedAt !== null) {
            throw new Error("素材已变化，请刷新素材库后重新编辑");
          }
          return { sessionId: identifier(item.sessionId), material };
        },
      ),
      loadEditImage: (sessionId, localImageId) => call(
        "无法读取素材草稿图片", "library_load_edit_image", { sessionId, localImageId },
        (value) => dataUrl(value, 16 * 1024 * 1024),
      ),
      async importEditImages(sessionId) {
        let sourcePaths: string[];
        try {
          sourcePaths = await imagePicker.pickImageFiles("选择素材图片");
        } catch (error) {
          throw new MaterialLibraryNativeError("无法选择素材图片", error);
        }
        if (sourcePaths.length === 0) return [];
        return call("无法导入素材图片", "library_import_edit_images", { sessionId, sourcePaths }, (value) => {
          if (!Array.isArray(value) || value.length > 128) throw new Error("素材草稿图片清单无效");
          const images = value.map(editImage);
          if (new Set(images.map((image) => image.localImageId)).size !== images.length) {
            throw new Error("素材草稿图片标识重复");
          }
          return images;
        });
      },
      async captureEditImage(sessionId, cancellation) {
        try {
          return await captureMaterialEditImage(screenCapture, cancellation, (path) => call(
            "无法导入素材截图", "library_import_edit_images", { sessionId, sourcePaths: [path] },
            (value) => {
              if (!Array.isArray(value) || value.length !== 1) throw new Error("素材截图必须返回一张草稿图片");
              return editImage(value[0]);
            },
          ));
        } catch (error) {
          throw new MaterialLibraryNativeError("无法截图到素材草稿", error);
        }
      },
      cropEditImage: (sessionId, localImageId, bounds) => call(
        "无法裁切素材图片", "library_crop_edit_image", { sessionId, localImageId, bounds }, editImage,
      ),
      async commitEdit(input) {
        try {
          return await call("无法保存素材", "library_commit_edit", { input }, detail);
        } catch (error) {
          const rejected = error instanceof MaterialLibraryNativeError &&
            /^(library_(?:revision|metadata|metadata_conflict|deleted|not_found|kind|invalid_id|payload|validation|edit_limit|edit_not_found|edit_corrupt|image_not_found|edit_image_corrupt|image_corrupt|image_size|image_dimensions|image_format|image_decode|size))$/.test(error.code);
          throw new MaterialContentSaveError(
            error instanceof Error ? error.message : "无法确认素材保存结果",
            rejected ? "rejected" : "unknown",
            { cause: error },
          );
        }
      },
      discardEdit: (sessionId) => call("无法清理素材编辑草稿", "library_discard_edit", { sessionId }, nothing),
    },
    search: (input) => call("无法搜索素材库", "library_search", { input }, (value) => {
      const result = record(value);
      if (!Array.isArray(result.items) || result.items.length > 100) throw new Error("搜索结果无效");
      if (result.indexState !== "ready" && result.indexState !== "rebuilding") throw new Error("检索索引状态无效");
      return { items: result.items.map((item) => summary(item)), total: integer(result.total), indexState: result.indexState };
    }),
    get: (id) => call("无法读取素材", "library_get", { id }, detail),
    save: (input) => call("无法保存素材", "library_save", { input }, detail),
    updateMetadata: (id, expectedVersion, metadata) => call(
      "无法修改素材信息", "library_update_metadata", { id, expectedVersion, metadata }, summary,
    ),
    setDeleted: (id, expectedVersion, deleted) => call(
      deleted ? "无法删除素材" : "无法恢复素材",
      "library_set_deleted", { id, expectedVersion, deleted }, summary,
    ),
    purge: (id, expectedVersion) => call(
      "无法永久删除素材", "library_purge", { id, expectedVersion }, nothing,
    ),
    loadImage: (id, revision, localImageId) => call(
      "无法读取素材图片", "library_load_image", { id, revision, localImageId },
      (value) => dataUrl(value, 16 * 1024 * 1024),
    ),
    loadPreview: (id, revision) => call(
      "无法读取素材预览", "library_load_preview", { id, revision },
      (value) => value === null ? null : dataUrl(value, 2 * 1024 * 1024),
    ),
    savePreview: (id, revision, preview) => call(
      "无法保存素材预览", "library_save_preview", { id, revision, preview }, nothing,
    ),
    markPreviewFailed: (id, revision) => call(
      "无法记录预览失败", "library_mark_preview_failed", { id, revision }, nothing,
    ),
    prepareInsert: (input) => call(
      "无法准备插入素材", "library_prepare_insert", { input }, prepared,
    ),
    commitInsert: (input) => call(
      "无法完成素材插入", "library_commit_insert", { input }, nothing,
    ),
    abortInsert: (projectPath, operationId) => call(
      "无法清理未完成的素材插入", "library_abort_insert", { projectPath, operationId }, nothing,
    ),
    getInsertStatus: (projectPath, operationId) => call(
      "无法确认素材插入状态", "library_insert_status", { projectPath, operationId }, (value) => {
        if (value !== "prepared" && value !== "committed" && value !== "cancelled" && value !== "conflict") {
          throw new Error("素材插入状态无效");
        }
        return value;
      },
    ),
  };
}
