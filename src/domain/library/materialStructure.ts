import type {
  ArtifactRecord,
  ImageCollection,
  PreshotBlock,
  ProjectPlanV15,
} from "../plan/canvas/blockDocument";
import { promoteImagePresentationPlan } from "../plan/canvas/blockDocument";
import { DEFAULT_REFERENCE_HEIGHT, type ReferenceComponent } from "../plan/canvas/models";
import type {
  MaterialImageSource,
  MaterialPayload,
  PortableComponent,
  PortableImage,
} from "./models";

export interface MaterialInstance {
  block: PreshotBlock;
  imageGroup?: ReferenceComponent;
  artifact?: ArtifactRecord;
}

export function componentImages(component: PortableComponent): PortableImage[] {
  switch (component.kind) {
    case "image":
    case "imageGroup": return component.images;
    case "shootingLocation":
    case "prop": return component.gallery.images;
    case "modelCard": return component.samples.images;
    case "clothing": return component.mainGallery.images;
  }
}

export function componentTitle(component: PortableComponent): string {
  switch (component.kind) {
    case "image":
    case "imageGroup": return component.name;
    case "shootingLocation": return component.venueName;
    case "modelCard": return component.modelId;
    case "clothing":
    case "prop": return component.title;
  }
}

export function componentText(component: PortableComponent): string[] {
  let fields: string[];
  switch (component.kind) {
    case "image":
    case "imageGroup": fields = [component.name, component.description]; break;
    case "shootingLocation":
      fields = [component.venueName, component.address, component.description]; break;
    case "modelCard":
      fields = [
        component.modelId,
        ...(component.heightCm === null ? [] : [String(component.heightCm)]),
        ...(component.weightKg === null ? [] : [String(component.weightKg)]),
        component.shoeSize,
        ...(component.notes === undefined ? [] : [component.notes]),
      ];
      break;
    case "prop":
    case "clothing": fields = [component.title, component.source]; break;
  }
  return [...fields, ...componentImages(component).flatMap((image) =>
    image.caption === undefined ? [] : [image.caption])];
}

// The active editor creates full rows at 1080 - 2 * 36 logical units.
// Keep this domain factory independent of the feature-only viewport module.
export const MATERIAL_FULL_ROW_WIDTH = 1008;

export function buildMaterialInstance(
  payload: MaterialPayload,
  sources: ReadonlyMap<string, string>,
  makeId: () => string,
): MaterialInstance {
  const blockId = makeId();
  const sidecarId = makeId();
  const component = payload.component;
  const images = componentImages(component).map(({ localImageId, crop, ...visual }) => ({
    ...visual,
    ...(crop === undefined ? {} : { crop: { ...crop } }),
    id: makeId(),
    file: sources.get(localImageId)!,
  }));
  const block: PreshotBlock = {
    id: blockId,
    type: component.kind === "image" ? "imageGroup" : component.kind,
    props: (component.kind === "image" || component.kind === "imageGroup")
      ? { groupId: sidecarId }
      : { artifactId: sidecarId },
    content: undefined,
    children: [],
  };
  if ((component.kind === "image" || component.kind === "imageGroup")) {
    return {
      block,
      imageGroup: {
        id: sidecarId, type: "reference",
        name: component.name, description: component.description,
        x: 0, width: MATERIAL_FULL_ROW_WIDTH, height: DEFAULT_REFERENCE_HEIGHT, images,
      },
    };
  }
  const collection: ImageCollection = { id: makeId(), images };
  const base = { id: sidecarId, revision: 0, ...(component.contentLayout ? { contentLayout: component.contentLayout } : {}) };
  let artifact: ArtifactRecord;
  switch (component.kind) {
    case "shootingLocation":
      artifact = {
        ...base, kind: component.kind,
        venueName: component.venueName, address: component.address,
        description: component.description, gallery: collection,
      };
      break;
    case "modelCard":
      artifact = {
        ...base, kind: component.kind, modelId: component.modelId,
        heightCm: component.heightCm, weightKg: component.weightKg,
        shoeSize: component.shoeSize,
        ...(component.notes === undefined ? {} : { notes: component.notes }),
        samples: collection,
      };
      break;
    case "prop":
      artifact = {
        ...base, kind: component.kind, title: component.title,
        source: component.source, gallery: collection,
      };
      break;
    case "clothing":
      artifact = {
        ...base, kind: component.kind, title: component.title,
        source: component.source, mainGallery: collection,
        tryOn: { expanded: false, gallery: { id: makeId(), images: [] } },
      };
      break;
  }
  return { block, artifact };
}

export function instancePlan(instance: MaterialInstance): ProjectPlanV15 {
  return promoteImagePresentationPlan({
    schemaVersion: 17,
    title: "Material validation",
    document: { format: "preshot-blocks", version: 5, blocks: [instance.block] },
    imageGroups: instance.imageGroup ? [instance.imageGroup] : [],
    artifacts: instance.artifact ? [instance.artifact] : [],
  });
}

export function sourceMap(sources: readonly MaterialImageSource[]): Map<string, string> {
  return new Map(sources.map(({ localImageId, file }) => [localImageId, file]));
}
