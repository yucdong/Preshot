import { artifactCollectionsInPlan, type ProjectPlanV15 } from "../plan/canvas/blockDocument";
import { createMaterialSnapshot, instantiateMaterial } from "./material";
import { componentImages, instancePlan } from "./materialStructure";
import type { MaterialPayload } from "./models";
import { validateMaterialPayload } from "./validation";

export interface MaterialEditDraft {
  readonly plan: ProjectPlanV15;
  readonly structure: string;
  readonly fileTokens: Map<string, string>;
}

function structure(plan: ProjectPlanV15): string {
  return JSON.stringify({
    schemaVersion: plan.schemaVersion,
    title: plan.title,
    document: plan.document,
    imageGroups: plan.imageGroups.map(({ images, name, description, ...outer }) => {
      void images; void name; void description;
      return outer;
    }),
    artifacts: plan.artifacts.map((artifact) => ({
      id: artifact.id, kind: artifact.kind, layout: artifact.layout,
      collections: artifactCollectionsInPlan({ ...plan, artifacts: [artifact] })
        .map(({ id }) => id),
      ...(artifact.kind === "clothing" ? { tryOn: artifact.tryOn } : {}),
    })),
  });
}

export function createMaterialEditDraft(
  payload: MaterialPayload,
  makeId: () => string,
): MaterialEditDraft {
  const sources = componentImages(payload.component).map(({ localImageId }, index) => ({
    localImageId, file: `references/${String(index + 1).padStart(4, "0")}.png`,
  }));
  const plan = instancePlan(instantiateMaterial(payload, sources, makeId));
  return {
    plan, structure: structure(plan),
    fileTokens: new Map(sources.map(({ file, localImageId }) => [file, localImageId])),
  };
}

export function serializeMaterialEditDraft(
  plan: ProjectPlanV15,
  draft: Pick<MaterialEditDraft, "structure" | "fileTokens">,
): MaterialPayload {
  if (plan.document.blocks.length !== 1 || structure(plan) !== draft.structure) {
    throw new Error("素材编辑只能修改当前组件的内容，不能改变组件类型、结构或外部布局。");
  }
  const snapshot = createMaterialSnapshot(plan, plan.document.blocks[0].id);
  const nativeTokens = new Map<string, string>();
  const used = new Set<string>();
  for (const { localImageId, file } of snapshot.sources) {
    const token = draft.fileTokens.get(file);
    if (!token || used.has(token)) {
      throw new Error("图片不属于当前素材编辑会话或被重复引用，请重新添加图片。");
    }
    used.add(token);
    nativeTokens.set(localImageId, token);
  }
  // Snapshot IDs are traversal-local, not native staging identities. Rebind
  // through the virtual reference file, including after reorder and undo.
  for (const image of componentImages(snapshot.payload.component)) {
    image.localImageId = nativeTokens.get(image.localImageId)!;
  }
  return validateMaterialPayload(snapshot.payload);
}
