import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { App } from "../../src/app/App";
import { createPlanDependencies } from "../../src/app/plan/planDependencies";
import { createMidsceneWorkspaceDependencies, MIDSCENE_PROJECT_ROOT } from "../../src/infrastructure/workspace/midsceneWorkspace";
import { createEmptyProjectPlanV17 } from "../../src/domain/plan/canvas/blockDocument";
import type { ProjectManifest } from "../../src/domain/workspace/models";
import type { NativeProjectCopy, ProjectCopyStatus } from "../../src/domain/workspace/projectCopy";
import i18n from "../../src/shared/i18n/config";
import "../../src/styles.css";

if (import.meta.env.MODE !== "e2e") throw new Error("E2E only");
const records = new Map<string, ProjectCopyStatus>();
const canceled = new Set<string>();
const params = new URLSearchParams(location.search);
const planKey = (path: string) => `preshot.browser-blocknote-plan-v15:${encodeURIComponent(path)}`;
const readProjects = (): Record<string, ProjectManifest> => JSON.parse(localStorage.getItem("preshot.midscene.projects") ?? "{}");
const boundary: NativeProjectCopy = {
  async suggestProjectCopy(source, baseName) {
    const parentPath = source.path.slice(0, source.path.lastIndexOf("\\"));
    let name = baseName, suffix = 2;
    while (readProjects()[`${parentPath}\\${name}`]) name = `${baseName} ${suffix++}`;
    return { parentPath, name };
  },
  async copyProject(input) {
    const existing = records.get(input.operationId);
    if (existing?.phase === "completed") return existing;
    const status: ProjectCopyStatus = { operationId: input.operationId, phase: "copying", copiedBytes: 1, totalBytes: 2, project: null, error: null };
    records.set(input.operationId, status);
    await new Promise(resolve => setTimeout(resolve, params.has("slow") ? 1800 : 100));
    if (canceled.has(input.operationId)) { status.phase = "cancelled"; return status; }
    const projects = readProjects();
    const path = `${input.parentPath}\\${input.name}`;
    if (projects[path]) { status.phase = "failed"; throw new Error("目标文件夹已存在，请修改项目名称或存放目录"); }
    const plan = JSON.parse(sessionStorage.getItem(planKey(input.sourcePath))!);
    plan.title = input.name;
    sessionStorage.setItem(planKey(path), JSON.stringify(plan));
    const now = new Date().toISOString();
    projects[path] = { ...projects[input.sourcePath], id: crypto.randomUUID(), name: input.name, createdAt: now, updatedAt: now };
    localStorage.setItem("preshot.midscene.projects", JSON.stringify(projects));
    Object.assign(status, { phase: "completed", copiedBytes: 2, project: { path, manifest: projects[path], resolvedCoverImage: null, coverDataUrl: null } });
    return status;
  },
  async projectCopyStatus(id) { return records.get(id) ?? null; },
  async cancelProjectCopy(id) { canceled.add(id); },
  async pendingProjectCopies() { return []; },
  async acknowledgeProjectCopy() {},
};
const dependencies = createMidsceneWorkspaceDependencies(undefined, boundary);
await dependencies.service.loadProjects();
const source = await dependencies.service.createProject(MIDSCENE_PROJECT_ROOT, "南京长江大桥");
const plan = createEmptyProjectPlanV17(source.name, { makeId: () => "intro" });
plan.document.blocks = [
  { id: "intro", type: "paragraph", props: {}, content: [{ type: "text", text: "桥上人像拍摄计划", styles: {} }], children: [] },
  { id: "props", type: "prop", props: { artifactId: "prop-a" }, content: undefined, children: [] },
];
plan.artifacts = [{ id: "prop-a", kind: "prop", revision: 0, title: "透明伞", source: "雨后拍摄", gallery: { id: "gallery-a", images: [] } }];
sessionStorage.setItem(planKey(source.path), JSON.stringify(plan));
const plans = createPlanDependencies();
const savePlan = plans.service.savePlan;
let failSave = params.has("failSave");
Object.assign(window, { __PRESHOT_COPY_TEST__: { failNextSave() { failSave = true; } } });
plans.service.savePlan = async (path, value) => {
  if (failSave) { failSave = false; throw new Error("测试保存失败，请重试"); }
  await savePlan(path, value);
};
createRoot(document.getElementById("root")!).render(<StrictMode><I18nextProvider i18n={i18n}><App dependencies={dependencies} planDependencies={plans} /></I18nextProvider></StrictMode>);
