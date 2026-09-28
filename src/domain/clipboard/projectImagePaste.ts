import {
  artifactCollectionsInPlan, mediaFilesInBlockDocument, validateProjectPlanV15,
  type ArtifactRecord, type ImageCollection, type PreshotBlock, type ProjectPlanV15,
} from "../plan/canvas/blockDocument";
import { defaultImageFrame } from "../plan/canvas/plan";
import type { ReferenceImage } from "../plan/canvas/models";
import type { ClipboardImagePresentation, ClipboardNativeImageProps, ImagePasteTarget } from "./imageClipboard";

export interface ImagePasteFile {
  operationId: string;
  file: string;
  name: string;
  mimeType: string;
}

export interface ImagePasteBytes {
  name: string;
  mimeType: string;
  bytes: number[];
}

export interface ImagePasteRepository {
  prepareImagePaste(input: {
    projectPath: string; operationId: string; expectedPlan: ProjectPlanV15;
    destination: "media" | "references"; image: ImagePasteBytes;
  }): Promise<ImagePasteFile>;
  commitImagePaste(input: {
    projectPath: string; operationId: string; expectedPlan: ProjectPlanV15; nextPlan: ProjectPlanV15;
  }): Promise<void>;
  getImagePasteStatus(projectPath: string, operationId: string): Promise<"prepared" | "committed" | "aborted" | "missing">;
  abortImagePaste(projectPath: string, operationId: string): Promise<void>;
}

export class ImagePasteRecoveryError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "ImagePasteRecoveryError";
  }
}

export function findClipboardBlock(blocks: readonly PreshotBlock[], id: string): PreshotBlock | undefined {
  for (const block of blocks) {
    if (block.id === id) return block;
    const child = findClipboardBlock(block.children, id);
    if (child) return child;
  }
}

export function pastedReferenceImage(
  id: string, file: string, dimensions: { width: number; height: number },
  presentation?: ClipboardImagePresentation, maxFrameWidth = 768,
): ReferenceImage {
  const { width, height } = dimensions;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width > 8192 || height > 8192 || width * height > 32_000_000 ||
      !Number.isFinite(maxFrameWidth) || maxFrameWidth < 32 || maxFrameWidth > 8192) {
    throw new Error("图片尺寸或目标区域尺寸无效，请重新选择粘贴位置。");
  }
  const frame = presentation ?? { aspectRatio: width / height, ...defaultImageFrame(width / height) };
  if (!Number.isFinite(frame.frameWidth) || !Number.isFinite(frame.frameHeight) ||
      frame.frameWidth <= 0 || frame.frameHeight <= 0) throw new Error("复制图片的显示尺寸无效。");
  const scale = Math.min(1, maxFrameWidth / frame.frameWidth);
  return {
    ...frame, id, file, aspectRatio: width / height, sourceWidth: width, sourceHeight: height,
    frameWidth: frame.frameWidth * scale, frameHeight: frame.frameHeight * scale,
    frameOffsetX: 0, frameOffsetY: 0,
  };
}

export function changeClipboardGallery(
  plan: ProjectPlanV15, groupId: string, update: (images: ReferenceImage[]) => ReferenceImage[],
): ProjectPlanV15 {
  let found = false;
  const replace = (collection: ImageCollection): ImageCollection => {
    if (collection.id !== groupId) return collection;
    found = true;
    return { ...collection, images: update(collection.images) };
  };
  const imageGroups = plan.imageGroups.map(group => {
    if (group.id !== groupId) return group;
    found = true;
    return { ...group, images: update(group.images) };
  });
  const artifacts = plan.artifacts.map((artifact): ArtifactRecord => {
    const before = found;
    let next: ArtifactRecord;
    if (artifact.kind === "modelCard") next = { ...artifact, samples: replace(artifact.samples) };
    else if (artifact.kind === "clothing") next = { ...artifact, mainGallery: replace(artifact.mainGallery) };
    else next = { ...artifact, gallery: replace(artifact.gallery) };
    return found !== before ? { ...next, revision: artifact.revision + 1 } : artifact;
  });
  if (!found) throw new Error("图片区域已不存在，请重新选择粘贴位置。");
  return { ...plan, imageGroups, artifacts };
}

export interface ImagePasteResult {
  plan: ProjectPlanV15;
  imageId: string;
  blockId: string | null;
  image: ReferenceImage | null;
}

export function insertPastedImage(
  plan: ProjectPlanV15, target: ImagePasteTarget, file: ImagePasteFile,
  dimensions: { width: number; height: number }, makeId: () => string,
  presentation?: ClipboardImagePresentation, nativeProps?: ClipboardNativeImageProps,
): ImagePasteResult {
  const allCollections = [...plan.imageGroups, ...artifactCollectionsInPlan(plan)];
  const allImages = allCollections.flatMap(group => group.images);
  if (allImages.some(image => image.file === file.file) || mediaFilesInBlockDocument(plan.document).includes(file.file)) {
    throw new Error("粘贴必须创建独立的新图片文件。");
  }
  const id = makeId();
  if (!id || allImages.some(image => image.id === id) || findClipboardBlock(plan.document.blocks, id) ||
      plan.artifacts.some(artifact => artifact.id === id) || allCollections.some(group => group.id === id)) {
    throw new Error("粘贴图片必须使用新的标识。");
  }
  if (target.kind === "gallery") {
    if (!/^references\/[0-9]{4,}\.(png|jpg)$/.test(file.file)) throw new Error("参考图片文件路径无效。");
    const image = pastedReferenceImage(id, file.file, dimensions, presentation, target.maxFrameWidth);
    const next = changeClipboardGallery(plan, target.groupId, images => {
      const after = target.afterImageId === null ? images.length - 1 : images.findIndex(entry => entry.id === target.afterImageId);
      if (target.afterImageId !== null && after < 0) throw new Error("目标图片已变化，请重新选择粘贴位置。");
      return [...images.slice(0, after + 1), image, ...images.slice(after + 1)];
    });
    return { plan: validateProjectPlanV15(next), imageId: id, blockId: null, image };
  }
  if (!/^media\/[^/\\]+\.(png|jpe?g|gif|webp)$/i.test(file.file)) throw new Error("正文图片文件路径无效。");
  const index = target.afterBlockId === null ? -1 : plan.document.blocks.findIndex(block =>
    block.id === target.afterBlockId || findClipboardBlock(block.children, target.afterBlockId!) !== undefined);
  if (target.afterBlockId !== null && index < 0) throw new Error("正文插入位置已变化，请重新选择。");
  const block: PreshotBlock = {
    id, type: "image", content: undefined, children: [],
    props: {
      name: file.name, url: file.file, caption: nativeProps?.caption ?? "",
      textAlignment: nativeProps?.textAlignment ?? "left", backgroundColor: "default",
      showPreview: true, previewWidth: Math.min(768, nativeProps?.previewWidth ?? 512),
    },
  };
  const blocks = [...plan.document.blocks.slice(0, index + 1), block, ...plan.document.blocks.slice(index + 1)];
  return {
    plan: validateProjectPlanV15({ ...plan, document: { ...plan.document, blocks } }),
    imageId: id, blockId: id, image: null,
  };
}

export async function pasteProjectImage(input: {
  repository: ImagePasteRepository; projectPath: string; operationId: string; expectedPlan: ProjectPlanV15;
  target: ImagePasteTarget; image: ImagePasteBytes; dimensions: { width: number; height: number };
  presentation?: ClipboardImagePresentation; nativeProps?: ClipboardNativeImageProps;
  makeId(): string; isCurrent(): boolean;
  preparePublication?(result: ImagePasteResult, file: ImagePasteFile): Promise<void>;
  publish(result: ImagePasteResult, file: ImagePasteFile): void;
}): Promise<void> {
  const { repository, projectPath, operationId, expectedPlan } = input;
  const requireCurrent = () => {
    if (!input.isCurrent()) throw new Error("粘贴位置已变化或编辑已结束，请重新选择目标。");
  };
  const abort = async (cause: unknown) => {
    try { await repository.abortImagePaste(projectPath, operationId); }
    catch (cleanup) {
      throw new ImagePasteRecoveryError("图片粘贴清理未完成，请重新打开项目，勿重复粘贴。", new AggregateError([cause, cleanup]));
    }
  };
  requireCurrent();
  let prepared: ImagePasteFile;
  try {
    prepared = await repository.prepareImagePaste({
      projectPath, operationId, expectedPlan, image: input.image,
      destination: input.target.kind === "document" ? "media" : "references",
    });
  } catch (error) {
    await abort(error);
    throw error;
  }
  let result: ImagePasteResult;
  try {
    requireCurrent();
    if (prepared.operationId !== operationId || prepared.mimeType !== input.image.mimeType) {
      throw new Error("图片粘贴准备结果与请求不一致。");
    }
    result = insertPastedImage(expectedPlan, input.target, prepared, input.dimensions,
      input.makeId, input.presentation, input.nativeProps);
    await input.preparePublication?.(result, prepared);
    requireCurrent();
  } catch (error) {
    await abort(error);
    throw error;
  }
  try {
    await repository.commitImagePaste({ projectPath, operationId, expectedPlan, nextPlan: result.plan });
  } catch (error) {
    let status;
    try { status = await repository.getImagePasteStatus(projectPath, operationId); }
    catch (statusError) {
      throw new ImagePasteRecoveryError("无法确认图片是否已写入项目，请重新打开项目，勿重复粘贴。", new AggregateError([error, statusError]));
    }
    if (status === "prepared") { await abort(error); throw error; }
    if (status === "aborted") throw error;
    if (status !== "committed") {
      throw new ImagePasteRecoveryError("图片粘贴回执无法确认，请重新打开项目，勿重复粘贴。", error);
    }
  }
  try { input.publish(result, prepared); }
  catch (error) { throw new ImagePasteRecoveryError("图片已写入，但画布未能刷新。请重新打开项目，不要再次粘贴。", error); }
}
