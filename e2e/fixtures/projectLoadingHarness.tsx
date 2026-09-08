import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { App } from "../../src/app/App";
import { createPlanDependencies } from "../../src/app/plan/planDependencies";
import {
  createMidsceneWorkspaceDependencies,
  MIDSCENE_PROJECT_ROOT,
} from "../../src/infrastructure/workspace/midsceneWorkspace";
import i18n from "../../src/shared/i18n/config";
import type { ProjectLoadingControls } from "./projectLoadingControls";
import "../../src/styles.css";

if (import.meta.env.MODE !== "e2e") throw new Error("This fixture requires E2E mode");

const dependencies = createMidsceneWorkspaceDependencies();
await dependencies.service.loadProjects();
await dependencies.service.createProject(MIDSCENE_PROJECT_ROOT, "进度条示例");
const plans = createPlanDependencies();
let gate: Promise<void> | null = null;
let release: (() => void) | null = null;
let failNextPlan = false;
const controls: ProjectLoadingControls = {
  pause() {
    if (gate) throw new Error("Project loading is already paused");
    gate = new Promise<void>((resolve) => { release = resolve; });
  },
  resume() {
    if (!release) throw new Error("Project loading is not paused");
    const resolve = release;
    gate = null;
    release = null;
    resolve();
  },
  failNextPlan() { failNextPlan = true; },
};
window.__PRESHOT_PROJECT_LOADING__ = controls;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <App
        dependencies={dependencies}
        planDependencies={{
          ...plans,
          service: {
            ...plans.service,
            async loadPlan(projectPath, projectName) {
              if (gate) await gate;
              if (failNextPlan) {
                failNextPlan = false;
                throw new Error("示例项目读取失败，请重试");
              }
              return plans.service.loadPlan(projectPath, projectName);
            },
          },
        }}
      />
    </I18nextProvider>
  </StrictMode>,
);
