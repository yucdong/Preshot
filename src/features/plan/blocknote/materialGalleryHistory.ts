import { ui } from "../../../shared/i18n/ui";
import type { ProjectPlanV15 } from "../../../domain/plan/canvas/blockDocument";
import type { ReferenceImage } from "../../../domain/plan/canvas/models";
import type { ExternalImageHistoryEntry } from "./MaterialEditorBridge";

export function materialGalleryHistory(groupId: string, inserted: readonly ReferenceImage[],
  getPlan: () => ProjectPlanV15 | null, apply: (plan: ProjectPlanV15) => void): ExternalImageHistoryEntry {
  const ids = new Set(inserted.map((image) => image.id));
  let retained = [...inserted];
  let index = 0;
  const change = (update: (images: ReferenceImage[]) => ReferenceImage[]) => {
    const plan = getPlan();
    if (!plan || !plan.imageGroups.some((group) => group.id === groupId)) throw new Error(ui("目标图片组已不存在，无法恢复插入历史。"));
    apply({ ...plan, imageGroups: plan.imageGroups.map((group) => group.id === groupId ? { ...group, images: update(group.images) } : group) });
  };
  return {
    undo() {
      change((images) => {
        retained = images.filter((image) => ids.has(image.id));
        if (retained.length !== ids.size) throw new Error(ui("插入的图片已变化，无法撤销。"));
        index = images.findIndex((image) => ids.has(image.id));
        return images.filter((image) => !ids.has(image.id));
      });
    },
    redo() {
      change((images) => {
        if (images.some((image) => ids.has(image.id))) throw new Error(ui("图片已存在，不能重复插入。"));
        const position = Math.min(index, images.length);
        return [...images.slice(0, position), ...retained, ...images.slice(position)];
      });
    },
  };
}
