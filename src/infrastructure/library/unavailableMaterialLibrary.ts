import { ui } from "../../shared/i18n/ui";
import type { MaterialLibraryRepository } from "../../domain/library/ports";

async function unavailable(): Promise<never> {
  throw new Error(ui("全局素材库需要 Preshot 桌面版；浏览器模式不会保存或插入素材。"));
}

export const unavailableMaterialLibrary: MaterialLibraryRepository = {
  availability: "unavailable",
  search: unavailable,
  get: unavailable,
  save: unavailable,
  updateMetadata: unavailable,
  setDeleted: unavailable,
  purge: unavailable,
  loadImage: unavailable,
  loadPreview: unavailable,
  savePreview: unavailable,
  markPreviewFailed: unavailable,
  prepareInsert: unavailable,
  commitInsert: unavailable,
  abortInsert: unavailable,
  getInsertStatus: unavailable,
};
