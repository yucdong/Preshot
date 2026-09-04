import type {
  ArtifactRecord,
  ImageCollection,
  ProjectPlanV15,
} from "../../../domain/plan/canvas/blockDocument";
import { layoutDocumentImageGroupForWidth } from "../../../domain/plan/canvas/documentImageGroupLayout";
import {
  DEFAULT_REFERENCE_HEIGHT,
  MIN_COMPONENT_HEIGHT,
  type ReferenceComponent,
} from "../../../domain/plan/canvas/models";
import { BLOCKNOTE_DOCUMENT_CONTENT_WIDTH } from "./canvasViewport";

export interface ArtifactCollectionOwner {
  readonly artifactId: string;
  readonly artifactKind: ArtifactRecord["kind"];
  readonly collection: ImageCollection;
  readonly label: string;
}

export function collectionsForArtifact(
  artifact: ArtifactRecord,
): readonly ArtifactCollectionOwner[] {
  if (artifact.kind === "shootingLocation") {
    return [{
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      collection: artifact.gallery,
      label: "场地图片",
    }];
  }
  if (artifact.kind === "modelCard") {
    return [{
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      collection: artifact.samples,
      label: "样片",
    }];
  }
  if (artifact.kind === "clothing") {
    return [
      {
        artifactId: artifact.id,
        artifactKind: artifact.kind,
        collection: artifact.mainGallery,
        label: "服装主图",
      },
      {
        artifactId: artifact.id,
        artifactKind: artifact.kind,
        collection: artifact.tryOn.gallery,
        label: "试穿参考",
      },
    ];
  }
  return [{
    artifactId: artifact.id,
    artifactKind: artifact.kind,
    collection: artifact.gallery,
    label: "道具图片",
  }];
}

export function artifactCollectionOwners(
  plan: Pick<ProjectPlanV15, "artifacts">,
): readonly ArtifactCollectionOwner[] {
  return plan.artifacts.flatMap(collectionsForArtifact);
}

export function artifactCollectionGroups(
  plan: Pick<ProjectPlanV15, "artifacts">,
  width = BLOCKNOTE_DOCUMENT_CONTENT_WIDTH,
): ReferenceComponent[] {
  return artifactCollectionOwners(plan).map(({
    artifactKind,
    collection,
    label,
  }) => ({
    id: collection.id,
    name: label,
    type: "reference",
    x: 0,
    width,
    height: Math.max(
      MIN_COMPONENT_HEIGHT,
      artifactKind === "modelCard" ? DEFAULT_REFERENCE_HEIGHT : 134,
      layoutDocumentImageGroupForWidth(collection.images, width).height,
    ),
    description: "",
    images: collection.images,
  }));
}

export function findArtifactCollection(
  plan: Pick<ProjectPlanV15, "artifacts">,
  collectionId: string,
): ArtifactCollectionOwner | undefined {
  return artifactCollectionOwners(plan).find(
    ({ collection }) => collection.id === collectionId,
  );
}

export function replaceArtifactCollection(
  plan: ProjectPlanV15,
  collectionId: string,
  update: (collection: ImageCollection) => ImageCollection,
): ProjectPlanV15 {
  let found = false;
  const artifacts = plan.artifacts.map((artifact): ArtifactRecord => {
    const replace = (collection: ImageCollection): ImageCollection => {
      if (collection.id !== collectionId) return collection;
      found = true;
      return update(collection);
    };
    if (artifact.kind === "shootingLocation") {
      return { ...artifact, gallery: replace(artifact.gallery) };
    }
    if (artifact.kind === "modelCard") {
      return { ...artifact, samples: replace(artifact.samples) };
    }
    if (artifact.kind === "clothing") {
      return {
        ...artifact,
        mainGallery: replace(artifact.mainGallery),
        tryOn: {
          ...artifact.tryOn,
          gallery: replace(artifact.tryOn.gallery),
        },
      };
    }
    return { ...artifact, gallery: replace(artifact.gallery) };
  });
  return found ? { ...plan, artifacts } : plan;
}

export function artifactCollectionIdsInDocumentOrder(
  plan: ProjectPlanV15,
): string[] {
  const byId = new Map(plan.artifacts.map((artifact) => [
    artifact.id,
    artifact,
  ]));
  const ids: string[] = [];
  const visit = (blocks: typeof plan.document.blocks) => {
    for (const block of blocks) {
      if (
        block.type === "shootingLocation" ||
        block.type === "modelCard" ||
        block.type === "clothing" ||
        block.type === "prop"
      ) {
        const artifact = byId.get(String(block.props.artifactId));
        if (artifact) {
          ids.push(
            ...collectionsForArtifact(artifact).map(
              ({ collection }) => collection.id,
            ),
          );
        }
      }
      visit(block.children);
    }
  };
  visit(plan.document.blocks);
  return ids;
}

export function allCollectionIdsInDocumentOrder(
  plan: ProjectPlanV15,
): string[] {
  const byId = new Map(plan.artifacts.map((artifact) => [
    artifact.id,
    artifact,
  ]));
  const ids: string[] = [];
  const visit = (blocks: typeof plan.document.blocks) => {
    for (const block of blocks) {
      if (block.type === "imageGroup") {
        ids.push(String(block.props.groupId));
      } else if (
        block.type === "shootingLocation" ||
        block.type === "modelCard" ||
        block.type === "clothing" ||
        block.type === "prop"
      ) {
        const artifact = byId.get(String(block.props.artifactId));
        if (artifact) {
          ids.push(
            ...collectionsForArtifact(artifact).map(
              ({ collection }) => collection.id,
            ),
          );
        }
      }
      visit(block.children);
    }
  };
  visit(plan.document.blocks);
  return ids;
}
