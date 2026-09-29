import type { ProjectPlanV16 } from "../../../domain/plan/canvas/blockDocument";
import { ui } from "../../../shared/i18n/ui";
import { findArtifactCollection, replaceArtifactCollection } from "./artifactCollections";
import type { ExternalImageHistoryEntry } from "./MaterialEditorBridge";

/** Restore only the resized image, keeping other columns and later metadata intact. */
export function imageFrameHistory(groupId: string, imageId: string,
  before: ProjectPlanV16, after: ProjectPlanV16,
  getPlan: () => ProjectPlanV16 | null, apply: (plan: ProjectPlanV16) => void): ExternalImageHistoryEntry | null {
  const find = (plan: ProjectPlanV16) => (plan.imageGroups.find(group => group.id === groupId)
    ?? findArtifactCollection(plan, groupId)?.collection)?.images.find(image => image.id === imageId);
  const original = find(before); const resized = find(after);
  if (!original || !resized || JSON.stringify(original) === JSON.stringify(resized)) return null;
  const restore = (expected: typeof original, replacement: typeof original, source: ProjectPlanV16) => {
    const current = getPlan();
    if (!current || JSON.stringify(find(current)) !== JSON.stringify(expected)) {
      throw new Error(ui("方案版本已失效，请重新执行图片操作"));
    }
    const images = (items: typeof current.imageGroups[number]["images"]) => items.map(image => image.id === imageId ? structuredClone(replacement) : image);
    const height = source.imageGroups.find(group => group.id === groupId)?.height;
    apply(replaceArtifactCollection({ ...current, imageGroups: current.imageGroups.map(group => group.id === groupId
      ? { ...group, images: images(group.images), ...(height === undefined ? {} : { height }) } : group) },
    groupId, collection => ({ ...collection, images: images(collection.images) })));
  };
  return { undo: () => restore(resized, original, before), redo: () => restore(original, resized, after) };
}
