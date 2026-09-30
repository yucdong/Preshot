import { ui } from "../../shared/i18n/ui";
import {
  createMaterialEditDraft,
  serializeMaterialEditDraft,
  type MaterialEditDraft,
} from "../../domain/library/materialEditing";
import type { MaterialDetail, MaterialEditImage, MaterialPayload, PortableImage } from "../../domain/library/models";
import { assertLocalImageId } from "../../domain/library/validation";
import { componentImages } from "../../domain/library/materialStructure";
import { imageAssetKey } from "../../domain/plan/canvas/imagePresentation";
import type { ClipboardImagePresentation } from "../../domain/clipboard/imageClipboard";
import { pastedReferenceImage } from "../../domain/clipboard/projectImagePaste";
import { EXIF_PLAN_SCHEMA_VERSION, promoteImagePresentationPlan, type ArtifactRecord, type ProjectPlanV15 } from "../../domain/plan/canvas/blockDocument";
import { cropForResizedFrame } from "../../domain/plan/canvas/imageView";
import type { ImageFitMode, ReferenceComponent, ReferenceImage } from "../../domain/plan/canvas/models";
import { defaultImageFrame } from "../../domain/plan/canvas/plan";
import {
  artifactCollectionGroups,
  replaceArtifactCollection,
} from "../plan/blocknote/artifactCollections";

interface DraftSnapshot {
  readonly plan: ProjectPlanV15;
  readonly groups: ReferenceComponent[];
  readonly sources: Readonly<Record<string, string>>;
  readonly revision: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export class MaterialContentDraft {
  private readonly draft: MaterialEditDraft;
  private readonly assets = new Map<string, string>();
  private readonly dimensions = new Map<string, { width: number; height: number }>();
  private readonly listeners = new Set<() => void>();
  private readonly past: ProjectPlanV15[] = [];
  private readonly future: ProjectPlanV15[] = [];
  private snapshot: DraftSnapshot;

  constructor(
    material: MaterialDetail,
    assets: ReadonlyMap<string, string>,
    private onChange: (payload: MaterialPayload) => void,
    private readonly makeId: () => string = () => crypto.randomUUID(),
  ) {
    this.draft = createMaterialEditDraft(material.payload, makeId);
    for (const [file, token] of this.draft.fileTokens) {
      const source = assets.get(token);
      const metadata = material.images.find(({ localImageId }) => localImageId === token);
      if (!source || !metadata) throw new Error(ui("素材图片尚未加载完成，请重新打开素材。"));
      this.assets.set(file, source);
      const visual = componentImages(material.payload.component).find(image => image.localImageId === token);
      this.dimensions.set(file, visual?.presentationAxes === "exif"
        ? { width: visual.sourceWidth ?? metadata.width, height: visual.sourceHeight ?? metadata.height }
        : { width: metadata.width, height: metadata.height });
    }
    this.snapshot = this.buildSnapshot(this.draft.plan, 0);
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  readonly getSnapshot = (): DraftSnapshot => this.snapshot;

  setOnChange(onChange: (payload: MaterialPayload) => void): void {
    this.onChange = onChange;
  }

  readPayload(): MaterialPayload {
    return serializeMaterialEditDraft(this.snapshot.plan, this.draft);
  }

  setPreview(file: string, dataUrl: string): void {
    this.getToken(file);
    this.assets.set(file, dataUrl);
    this.snapshot = this.buildSnapshot(this.snapshot.plan, this.snapshot.revision + 1);
    this.listeners.forEach(listener => listener());
  }

  getToken(file: string): string {
    const token = this.draft.fileTokens.get(file);
    if (!token) throw new Error(ui("图片不属于当前素材编辑会话。"));
    return token;
  }

  getDimensions(file: string): { width: number; height: number } {
    const result = this.dimensions.get(file);
    if (!result) throw new Error(ui("图片尺寸尚未加载，无法裁剪，请重新打开素材。"));
    return result;
  }

  private buildSnapshot(plan: ProjectPlanV15, revision: number): DraftSnapshot {
    const groups = [...plan.imageGroups, ...artifactCollectionGroups(plan)];
    return {
      plan, revision, groups,
      sources: Object.fromEntries(groups.flatMap(group => group.images.map(image =>
        [imageAssetKey(image.file, image.presentationAxes), this.assets.get(image.file) ?? ""]))),
      canUndo: this.past.length > 0, canRedo: this.future.length > 0,
    };
  }

  private publish(plan: ProjectPlanV15, payload: MaterialPayload): void {
    const compatible = this.snapshot.plan.schemaVersion === EXIF_PLAN_SCHEMA_VERSION
      ? { ...plan, schemaVersion: EXIF_PLAN_SCHEMA_VERSION } : promoteImagePresentationPlan(plan);
    this.snapshot = this.buildSnapshot(compatible, this.snapshot.revision + 1);
    this.onChange(payload);
    this.listeners.forEach((listener) => listener());
  }

  private apply(plan: ProjectPlanV15): void {
    const payload = serializeMaterialEditDraft(plan, this.draft);
    if (JSON.stringify(payload) === JSON.stringify(this.readPayload())) return;
    this.past.push(this.snapshot.plan);
    this.future.length = 0;
    this.publish(plan, payload);
  }

  undo(): void {
    const plan = this.past.pop();
    if (!plan) return;
    this.future.push(this.snapshot.plan);
    this.publish(plan, serializeMaterialEditDraft(plan, this.draft));
  }

  redo(): void {
    const plan = this.future.pop();
    if (!plan) return;
    this.past.push(this.snapshot.plan);
    this.publish(plan, serializeMaterialEditDraft(plan, this.draft));
  }

  updateArtifact(id: string, update: (artifact: ArtifactRecord) => ArtifactRecord): void {
    const plan = this.snapshot.plan;
    if (!plan.artifacts.some((artifact) => artifact.id === id)) {
      throw new Error(ui("当前素材组件不存在，无法修改。"));
    }
    this.apply({
      ...plan,
      artifacts: plan.artifacts.map((artifact) => {
        if (artifact.id !== id) return artifact;
        const next = update(structuredClone(artifact));
        return { ...next, revision: artifact.revision + 1 };
      }),
    });
  }

  private updateImages(id: string, update: (images: ReferenceImage[]) => ReferenceImage[]): void {
    const plan = this.snapshot.plan;
    if (!this.snapshot.groups.some((group) => group.id === id)) {
      throw new Error(ui("只能编辑当前素材中的图片。"));
    }
    const next = plan.imageGroups.some((group) => group.id === id)
      ? { ...plan, imageGroups: plan.imageGroups.map((group) =>
        group.id === id ? { ...group, images: update(group.images) } : group) }
      : replaceArtifactCollection(plan, id, (collection) => ({
        ...collection, images: update(collection.images),
      }));
    this.apply(next);
  }

  private stage(images: readonly MaterialEditImage[]): string[] {
    const used = new Set(this.draft.fileTokens.values());
    for (const image of images) {
      assertLocalImageId(image.localImageId);
      if (
        used.has(image.localImageId) || !Number.isInteger(image.width) ||
        !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0 ||
        (image.presentationAxes !== undefined && image.presentationAxes !== "raw" && image.presentationAxes !== "exif") ||
        (image.presentationAxes === "exif" && (!Number.isInteger(image.displayWidth) || !Number.isInteger(image.displayHeight) ||
          (image.displayWidth ?? 0) <= 0 || (image.displayHeight ?? 0) <= 0)) ||
        !["image/png", "image/jpeg"].includes(image.mimeType) ||
        (!/^data:image\/(png|jpeg);base64,/.test(image.dataUrl) && !(image.dataUrl === "" && image.previewError))
      ) {
        throw new Error(ui("导入图片数据无效或会话标识已被使用，请重新添加图片。"));
      }
      used.add(image.localImageId);
    }
    return images.map((image) => {
      const suffix = image.mimeType === "image/jpeg" ? "jpg" : "png";
      const file = `references/${String(this.draft.fileTokens.size + 1).padStart(4, "0")}.${suffix}`;
      this.draft.fileTokens.set(file, image.localImageId);
      this.assets.set(file, image.dataUrl);
      this.dimensions.set(file, image.presentationAxes === "exif"
        ? { width: image.displayWidth!, height: image.displayHeight! } : { width: image.width, height: image.height });
      return file;
    });
  }

  addImages(groupId: string, images: readonly MaterialEditImage[], visuals?: readonly PortableImage[], maxFrameWidth?: number): void {
    if (visuals && visuals.length !== images.length) throw new Error(ui("素材图片与显示信息不一致。"));
    const group = this.snapshot.groups.find(({ id }) => id === groupId);
    if (this.draft.kind === "image" && (group?.images.length ?? 0) + images.length > 1) throw new Error(ui("图片素材只能保留一张图片，请先移除原图再添加。"));
    if (!group || group.images.length + images.length > 128) {
      throw new Error(ui("每个素材最多保留 128 张图片，请先移除部分图片。"));
    }

    if (images.length === 0) return;
    const files = this.stage(images);
    this.updateImages(groupId, (existing) => [...existing, ...images.map((image, index) => {
      if (visuals) {
        const { localImageId: _sourceId, ...visual } = visuals[index];
        return { ...structuredClone(visual), id: this.makeId(), file: files[index] };
      }
      const width = image.presentationAxes === "exif" ? image.displayWidth! : image.width;
      const height = image.presentationAxes === "exif" ? image.displayHeight! : image.height;
      return {
        id: this.makeId(), file: files[index],
        aspectRatio: width / height,
        sourceWidth: width, sourceHeight: height,
        ...(image.presentationAxes === undefined ? {} : { presentationAxes: image.presentationAxes }),
        ...defaultImageFrame(width / height, maxFrameWidth),
      };
    })]);
  }

  pasteImage(
    groupId: string, afterImageId: string | null, image: MaterialEditImage,
    presentation?: ClipboardImagePresentation, maxFrameWidth?: number,
  ): ReferenceImage {
    const group = this.snapshot.groups.find(entry => entry.id === groupId);
    if (this.draft.kind === "image" && group?.images.length) throw new Error(ui("图片素材只能保留一张图片，请先移除原图再粘贴。"));
    if (!group || group.images.length >= 128) throw new Error(ui("图片区域不存在或已达到 128 张图片上限。"));
    const index = afterImageId === null ? group.images.length - 1 : group.images.findIndex(entry => entry.id === afterImageId);
    if (afterImageId !== null && index < 0) throw new Error(ui("目标图片已变化，请重新选择粘贴位置。"));
    const id = this.makeId();
    if (this.snapshot.groups.some(entry => entry.images.some(existing => existing.id === id))) {
      throw new Error(ui("粘贴图片必须使用新的标识。"));
    }
    const pasted = pastedReferenceImage(id, "", image, presentation, maxFrameWidth);
    const [file] = this.stage([image]);
    pasted.file = file;
    this.updateImages(groupId, existing => [...existing.slice(0, index + 1), pasted, ...existing.slice(index + 1)]);
    return pasted;
  }

  replaceImage(groupId: string, imageId: string, replacement: MaterialEditImage): void {
    if (!this.snapshot.groups.find(({ id }) => id === groupId)?.images.some(({ id }) => id === imageId)) {
      throw new Error(ui("裁剪目标图片已改变，请重新打开图片。"));
    }
    const [file] = this.stage([replacement]);
    const dimensions = this.getDimensions(file);
    const ratio = dimensions.width / dimensions.height;
    this.updateImages(groupId, (images) => images.map((image) => image.id !== imageId ? image : ({
      ...image, file, aspectRatio: ratio,
      ...(image.presentationAxes === undefined && replacement.presentationAxes === undefined ? {} : { presentationAxes: replacement.presentationAxes ?? "raw" }),
      sourceWidth: dimensions.width, sourceHeight: dimensions.height,
      frameWidth: image.frameHeight * ratio, frameOffsetX: 0, frameOffsetY: 0,
      crop: { x: 0, y: 0, width: 1, height: 1 },
    })));
  }

  removeImage(groupId: string, imageId: string): void {
    this.updateImages(groupId, (images) => images.filter(({ id }) => id !== imageId));
  }

  setImageFrame(
    groupId: string, imageId: string,
    frame: Pick<ReferenceImage, "frameWidth" | "frameHeight" | "frameOffsetX" | "frameOffsetY">,
  ): void {
    const { frameWidth, frameHeight, frameOffsetX, frameOffsetY } = frame;
    const visual = { frameWidth, frameHeight, frameOffsetX, frameOffsetY };
    this.updateImages(groupId, (images) => images.map((image) => image.id !== imageId ? image : ({
      ...image, ...visual,
      crop: image.fitMode === "stretch" ? image.crop : cropForResizedFrame(image, visual),
    })));
  }

  setImageFitMode(groupId: string, imageId: string, fitMode: ImageFitMode): void {
    this.updateImages(groupId, (images) => images.map((image) =>
      image.id === imageId ? { ...image, fitMode } : image));
  }

  moveImage(from: string, imageId: string, to: string, index: number): void {
    if (from !== to || !Number.isInteger(index) || index < 0) {
      throw new Error(ui("不能将图片移动到当前素材以外的组件。"));
    }
    this.updateImages(from, (images) => {
      const image = images.find(({ id }) => id === imageId);
      if (!image || index >= images.length) throw new Error(ui("图片移动目标已改变，请重试。"));
      const next = images.filter(({ id }) => id !== imageId);
      next.splice(index, 0, image);
      return next;
    });
  }
}
