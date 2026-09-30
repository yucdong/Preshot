import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { App } from "../../src/app/App";
import { createPlanDependencies } from "../../src/app/plan/planDependencies";
import { createBlockNotePlanService } from "../../src/domain/plan/blocknote/service";
import { createEmptyProjectPlanV17 } from "../../src/domain/plan/canvas/blockDocument";
import { createMidsceneWorkspaceDependencies, MIDSCENE_PROJECT_ROOT } from "../../src/infrastructure/workspace/midsceneWorkspace";
import { browserBlockNoteImageStore, browserBlockNoteMediaStore, browserBlockNotePlanRepository } from "../../src/infrastructure/plan/browserBlockNotePlan";
import i18n from "../../src/shared/i18n/config";
import "../../src/styles.css";

if (import.meta.env.MODE !== "e2e") throw new Error("E2E only");
const dependencies = createMidsceneWorkspaceDependencies();
await dependencies.service.loadProjects();
const project = await dependencies.service.createProject(MIDSCENE_PROJECT_ROOT, "图片批量加载测试");
const plan = createEmptyProjectPlanV17(project.name, { makeId: () => crypto.randomUUID() });
const group = (id: string) => ({ id: `${id}-block`, type: "imageGroup", props: { groupId: id }, content: undefined, children: [] });
plan.imageGroups = ["gallery", "other"].map(id => ({ id, type: "reference", name: id, description: "", x: 0, width: 700, height: 80, images: [] }));
plan.document.blocks = new URLSearchParams(location.search).has("columns")
  ? [{ id: "columns", type: "columnList", props: {}, content: undefined, children: ["gallery", "other"].map(id => ({
      id: `${id}-column`, type: "column", props: { width: 1 }, content: undefined, children: [group(id)],
    })) }]
  : [group("gallery"), group("other")];
await browserBlockNotePlanRepository.saveRawPlan(project.path, plan);

// Only file-picker, file I/O and manifest persistence boundaries are controlled.
// The production service, provider, editor, transactions and progress UI all run.
let pending: { resolve(): void; reject(error: Error): void } | undefined;
let finishSave: (() => void) | undefined;
let holdNextSave = false;
let cancelPicker = false;
let imports = 0;
const controls = {
  get pendingImage() { return Boolean(pending); },
  get pendingSave() { return Boolean(finishSave); },
  get importCount() { return imports; },
  completeImage() { const step = pending; pending = undefined; step?.resolve(); },
  failImage() { const step = pending; pending = undefined; step?.reject(new Error("测试图片读取失败")); },
  completeSave() { const step = finishSave; finishSave = undefined; step?.(); },
  cancelNextPicker() { cancelPicker = true; },
};
Object.assign(window, { __PRESHOT_IMPORT_TEST__: controls });
const plans = createPlanDependencies();
plans.picker = {
  pickImageFile: async () => null,
  pickImageFiles: async () => {
    if (cancelPicker) { cancelPicker = false; return []; }
    return ["bridge.png", "portrait.png", "umbrella.png"];
  },
};
plans.service = createBlockNotePlanService({
  repository: {
    loadRawPlan: browserBlockNotePlanRepository.loadRawPlan,
    async saveRawPlan(path, value) {
      if ((value as typeof plan).imageGroups.some(entry => entry.images.length) && holdNextSave) {
        holdNextSave = false;
        await new Promise<void>(resolve => { finishSave = resolve; });
      }
      await browserBlockNotePlanRepository.saveRawPlan(path, value);
    },
  },
  imageStore: {
    ...browserBlockNoteImageStore,
    async importImage(path, source) {
      imports += 1;
      holdNextSave = true;
      await new Promise<void>((resolve, reject) => { pending = { resolve, reject }; });
      const asset = await browserBlockNoteImageStore.importImage(path, source);
      return { ...asset, sourceWidth: 8, sourceHeight: 5 };
    },
  },
  imageCropStore: browserBlockNoteImageStore,
  mediaStore: browserBlockNoteMediaStore,
  createId: () => crypto.randomUUID(),
  logger: plans.logger,
});
createRoot(document.getElementById("root")!).render(<StrictMode><I18nextProvider i18n={i18n}>
  <App dependencies={dependencies} planDependencies={plans} />
</I18nextProvider></StrictMode>);
