import {
  artifactCollectionsInPlan,
  type ImageCollection,
  type ProjectPlanV15,
  type PreshotBlock,
  mediaFilesInBlockDocument,
} from "../plan/canvas/blockDocument";
import { DEFAULT_REFERENCE_HEIGHT, type ReferenceImage } from "../plan/canvas/models";
import {
  MATERIAL_KINDS,
  type MaterialImageSource,
  type MaterialPayload,
  type MaterialSnapshot,
  type PortableCollection,
  type PortableComponent,
  type PortableImage,
} from "./models";
import {
  buildMaterialInstance,
  componentImages,
  componentText,
  componentTitle,
  instancePlan,
  MATERIAL_FULL_ROW_WIDTH,
  sourceMap,
  type MaterialInstance,
} from "./materialStructure";
import {
  assertLocalImageId,
  assertReferenceFile,
  exactRecord,
  validateLibraryPlan,
  validateMaterialPayload,
} from "./validation";

function planIdentities(plan: ProjectPlanV15): string[] {
  const ids: string[] = [];
  const visit = (blocks: readonly PreshotBlock[]) => {
    for (const block of blocks) {
      ids.push(block.id);
      visit(block.children);
    }
  };
  visit(plan.document.blocks);
  for (const group of plan.imageGroups) {
    ids.push(group.id, ...group.images.map(({ id }) => id));
  }
  ids.push(...plan.artifacts.map(({ id }) => id));
  for (const collection of artifactCollectionsInPlan(plan)) {
    ids.push(collection.id, ...collection.images.map(({ id }) => id));
  }
  return ids;
}

function planImages(plan: ProjectPlanV15): ReferenceImage[] {
  return [
    ...plan.imageGroups.flatMap(({ images }) => images),
    ...artifactCollectionsInPlan(plan).flatMap(({ images }) => images),
  ];
}

export function createMaterialSnapshot(plan: ProjectPlanV15, blockId: string): MaterialSnapshot {
  const source = validateLibraryPlan(plan);
  const block = source.document.blocks.find(({ id }) => id === blockId);
  if (!block || block.type === "image" || !(MATERIAL_KINDS as readonly string[]).includes(block.type)) {
    throw new Error("Select one supported top-level material component");
  }
  if (block.children.length !== 0) {
    throw new Error("Material snapshots cannot include child blocks");
  }
  const sources: MaterialImageSource[] = [];
  const reserved = new Set(planIdentities(source));
  let nextLocalId = 0;
  const images = (entries: ReferenceImage[]): PortableImage[] => {
    if (entries.length > 128) throw new Error("Material snapshot exceeds the 128 image limit");
    return entries.map((image) => {
      assertReferenceFile(image.file);
      let localImageId: string;
      do {
        localImageId = `material-image-${++nextLocalId}`;
      } while (reserved.has(localImageId));
      reserved.add(localImageId);
      sources.push({ localImageId, file: image.file });
      const { id, file, crop, ...visual } = image;
      void id;
      void file;
      return {
        ...visual, localImageId,
        ...(crop === undefined ? {} : { crop: { ...crop } }),
      };
    });
  };
  const collection = (value: ImageCollection): PortableCollection => ({
    images: images(value.images),
  });
  let component: PortableComponent;
  let omittedLegacyImages = 0;
  if (block.type === "imageGroup") {
    const group = source.imageGroups.find(({ id }) => id === block.props.groupId)!;
    component = {
      kind: "imageGroup", name: group.name, description: group.description,
      images: images(group.images),
    };
  } else {
    const artifact = source.artifacts.find(({ id }) => id === block.props.artifactId)!;
    switch (artifact.kind) {
      case "shootingLocation":
        component = {
          kind: artifact.kind, venueName: artifact.venueName, address: artifact.address,
          description: artifact.description, gallery: collection(artifact.gallery),
        };
        break;
      case "modelCard":
        component = {
          kind: artifact.kind, modelId: artifact.modelId,
          heightCm: artifact.heightCm, weightKg: artifact.weightKg,
          shoeSize: artifact.shoeSize,
          ...(artifact.notes === undefined ? {} : { notes: artifact.notes }),
          samples: collection(artifact.samples),
        };
        break;
      case "prop":
        component = {
          kind: artifact.kind, title: artifact.title, source: artifact.source,
          gallery: collection(artifact.gallery),
        };
        break;
      case "clothing":
        component = {
          kind: artifact.kind, title: artifact.title, source: artifact.source,
          mainGallery: collection(artifact.mainGallery),
        };
        omittedLegacyImages = artifact.tryOn.gallery.images.length;
        break;
    }
  }
  return {
    sourceBlockId: block.id,
    payload: validateMaterialPayload({
      format: "preshot-material", version: 1, kind: component.kind, component,
    }),
    sources,
    omittedLegacyImages,
  };
}

export function materialPayloadTitle(payload: MaterialPayload): string {
  return componentTitle(validateMaterialPayload(payload).component);
}

export function materialPayloadText(payload: MaterialPayload): string {
  return componentText(validateMaterialPayload(payload).component).join("\n");
}

export function instantiateMaterial(
  payload: MaterialPayload,
  files: readonly MaterialImageSource[],
  makeId: () => string,
  surface: "project" | "libraryCanvas" = "project",
): MaterialInstance {
  const validated = validateMaterialPayload(payload);
  const nativeImage = validated.kind === "image" && surface === "project";
  const images = componentImages(validated.component);
  if (nativeImage && images.length !== 1) throw new Error("图片素材需要且只能包含一张图片。");
  if (!Array.isArray(files) || files.length !== images.length) {
    throw new Error("Material image sources must map every payload image exactly once");
  }
  const expected = new Set(images.map(({ localImageId }) => localImageId));
  const supplied = new Set<string>();
  for (const source of files) {
    const value = exactRecord(source, ["localImageId", "file"], "Material image source");
    assertLocalImageId(value.localImageId);
    if (nativeImage) {
      if (typeof value.file !== "string" || !value.file.startsWith("media/")) {
        throw new Error("Image material insertion requires a project-local media file");
      }
      assertReferenceFile(value.file.replace(/^media\//, "references/"));
    } else {
      assertReferenceFile(value.file);
    }
    if (!expected.has(value.localImageId) || supplied.has(value.localImageId)) {
      throw new Error("Material image sources must form a bijection with payload images");
    }
    supplied.add(value.localImageId);
  }
  const used = new Set(expected);
  const freshId = (): string => {
    const id = makeId();
    if (
      typeof id !== "string" || id.length === 0 || id !== id.trim() ||
      /\p{Cc}/u.test(id) || used.has(id)
    ) {
      throw new Error("Material factory must allocate fresh unique identifiers");
    }
    used.add(id);
    return id;
  };
  const instance: MaterialInstance = nativeImage && validated.component.kind === "image"
    ? { block: {
      id: freshId(), type: "image", children: [], content: undefined,
      props: {
        url: files[0].file, name: validated.component.name,
        caption: images[0].caption ?? "", showPreview: true,
        previewWidth: images[0].frameWidth,
      },
    } }
    : buildMaterialInstance(validated, sourceMap(files), freshId);
  validateLibraryPlan(instancePlan(instance));
  return instance;
}

function topLevelAnchorIndex(blocks: PreshotBlock[], anchor: string | null): number {
  if (anchor === null) return -1;
  const contains = (block: PreshotBlock): boolean =>
    block.id === anchor || block.children.some(contains);
  const index = blocks.findIndex(contains);
  if (index < 0) throw new Error("Material insertion anchor no longer exists");
  return index;
}

function cloneData<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => cloneData(entry)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
      [key, cloneData(entry)])) as T;
  }
  return value;
}

export function insertMaterialIntoPlan(
  plan: ProjectPlanV15,
  instance: MaterialInstance,
  afterBlockId: string | null,
): ProjectPlanV15 {
  const target = validateLibraryPlan(plan);
  const index = topLevelAnchorIndex(target.document.blocks, afterBlockId);
  exactRecord(instance, ["block", "imageGroup", "artifact"], "Material instance");
  exactRecord(instance.block, ["id", "type", "props", "content", "children"], "Material block");
  if (
    !(MATERIAL_KINDS as readonly string[]).includes(instance.block.type) ||
    !Array.isArray(instance.block.children) || instance.block.children.length !== 0 ||
    instance.block.content !== undefined ||
    (instance.block.type === "image"
      ? instance.imageGroup !== undefined || instance.artifact !== undefined
      : instance.block.type === "imageGroup"
      ? !instance.imageGroup || instance.artifact !== undefined
      : !instance.artifact || instance.imageGroup !== undefined)
  ) {
    throw new Error("Material insertion requires exactly one supported block and sidecar");
  }
  exactRecord(instance.block.props, instance.block.type === "image"
    ? ["url", "name", "caption", "showPreview", "previewWidth"]
    : [instance.block.type === "imageGroup" ? "groupId" : "artifactId"], "Material marker");
  if (instance.block.type === "image") {
    const url = instance.block.props.url;
    if (typeof url !== "string" || !url.startsWith("media/")) throw new Error("Image material requires local media");
    assertReferenceFile(url.replace(/^media\//, "references/"));
  }
  if (instance.artifact?.layout !== undefined) {
    throw new Error("Material artifact must not contain outer layout");
  }
  if (instance.imageGroup && (
    instance.imageGroup.x !== 0 || instance.imageGroup.width !== MATERIAL_FULL_ROW_WIDTH ||
    instance.imageGroup.height !== DEFAULT_REFERENCE_HEIGHT || instance.imageGroup.frameOffsetY !== undefined
  )) {
    throw new Error("Material image group must use the full-row factory geometry");
  }
  const addition = validateLibraryPlan(instancePlan(instance));
  const used = new Set(planIdentities(target));
  for (const id of planIdentities(addition)) {
    if (used.has(id)) throw new Error("Material insertion identity collision");
    used.add(id);
  }
  const imageFiles = (plan: ProjectPlanV15) => [
    ...planImages(plan).map(({ file }) => file), ...mediaFilesInBlockDocument(plan.document),
  ];
  const existingFiles = new Set(imageFiles(target).map((file) => file.toLowerCase()));
  for (const file of imageFiles(addition)) {
    if (existingFiles.has(file.toLowerCase())) {
      throw new Error("Material insertion files must be newly copied project files");
    }
  }
  const detached = cloneData(instance);
  const blocks = [...target.document.blocks];
  blocks.splice(index + 1, 0, detached.block);
  return validateLibraryPlan({
    ...target,
    document: { ...target.document, blocks },
    imageGroups: detached.imageGroup
      ? [...target.imageGroups, detached.imageGroup]
      : [...target.imageGroups],
    artifacts: detached.artifact
      ? [...target.artifacts, detached.artifact]
      : [...target.artifacts],
  });
}
