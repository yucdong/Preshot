import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { App } from "../../src/app/App";
import { createPlanDependencies } from "../../src/app/plan/planDependencies";
import { createEmptyProjectPlanV17 } from "../../src/domain/plan/canvas/blockDocument";
import { createMidsceneWorkspaceDependencies, MIDSCENE_PROJECT_ROOT } from "../../src/infrastructure/workspace/midsceneWorkspace";
import { browserBlockNotePlanRepository } from "../../src/infrastructure/plan/browserBlockNotePlan";
import i18n from "../../src/shared/i18n/config";
import "../../src/styles.css";

if (import.meta.env.MODE !== "e2e") throw new Error("E2E only");
const dependencies = createMidsceneWorkspaceDependencies();
await dependencies.service.loadProjects();
if (!localStorage.getItem("preshot.project-groups.seeded")) {
  for (const name of ["Autumn Portrait", "南京旧项目", "南京大桥夜景"]) {
    const project = await dependencies.service.createProject(MIDSCENE_PROJECT_ROOT, name);
    const plan = createEmptyProjectPlanV17(name, { makeId: () => "intro" });
    plan.document.blocks = [{ id: "intro", type: "paragraph", props: {}, content: [{ type: "text", text: `${name} · 拍摄安排`, styles: {} }], children: [] }];
    await browserBlockNotePlanRepository.saveRawPlan(project.path, plan);
  }
  localStorage.setItem("preshot.project-groups.seeded", "true");
}
createRoot(document.getElementById("root")!).render(<StrictMode><I18nextProvider i18n={i18n}><App dependencies={dependencies} planDependencies={createPlanDependencies()} /></I18nextProvider></StrictMode>);
