# i18n Foundation (Chinese Localization) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a typed `react-i18next` layer and convert the entire Preshot UI (plus app-generated defaults and the browser demo seed) to Chinese.

**Architecture:** A new `src/shared/i18n/` module owns a configured i18next singleton, a `zh` dictionary, typed-key augmentation, and provider wiring. Every `app/`/`features/`/`shared/` component reads strings via `useTranslation()`; the class `ErrorBoundary` and any non-hook code use the singleton `i18n.t()`. BlockNote chrome is localized via its own `zh` dictionary. User-facing error banners show a generic Chinese message; internal thrown/logged messages stay English.

**Tech Stack:** React 19 + TypeScript, `i18next` + `react-i18next`, BlockNote 0.52, Vitest, Playwright, Tailwind, pnpm.

## Global Constraints

- Package manager is **pnpm** (`pnpm@10.15.0`); never add npm/yarn lock files.
- i18n code lives in `src/shared/i18n/` (layer = `shared`; no business rules). `app`/`features` may import it; `domain` must not.
- Single locale now: `lng: "zh"`, `fallbackLng: "zh"`. **No** language-switcher UI, **no** date/number/plural localization.
- Typed keys are mandatory: unknown `t()` keys must be a TypeScript compile error (module augmentation).
- Keep internal `throw new Error("…")` messages **English** (logs/devs); only the presented banner is Chinese.
- Brand name "Preshot" stays literal (untranslated).
- TDD: for each string swap, update the test assertion to Chinese first (watch it fail), then localize the component (watch it pass). Commit per task.
- Validation commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm build`.

---

## File Structure

Created:
- `src/shared/i18n/locales/zh.ts` — the full `zh` dictionary (single source of truth for all keys).
- `src/shared/i18n/config.ts` — configured i18next singleton (default export).
- `src/shared/i18n/types.d.ts` — `CustomTypeOptions` augmentation for typed keys.
- `src/shared/i18n/index.ts` — re-exports the instance + `useTranslation`.
- `src/shared/i18n/config.test.ts` — smoke test (key resolution + interpolation).

Modified:
- `package.json` — add `i18next`, `react-i18next`.
- `index.html` — `<html lang="zh-CN">`.
- `src/main.tsx` — wrap root in `<I18nextProvider>`.
- `src/shared/testing/setup.ts` — import the i18n config so tests render Chinese.
- Components (+ their tests) across `app/`, `features/plan`, `features/workspace`, `features/agent`.
- `src/infrastructure/plan/browserPlan.ts` — Chinese demo seed.
- `e2e/plan.spec.ts`, `e2e/layout.spec.ts` — Chinese queries.
- `docs/design_docs/featurelist.json` — record the feature.

---

## Task 1: i18n infrastructure (config, dictionary, typed keys, wiring, smoke test)

**Files:**
- Create: `src/shared/i18n/locales/zh.ts`, `src/shared/i18n/config.ts`, `src/shared/i18n/types.d.ts`, `src/shared/i18n/index.ts`, `src/shared/i18n/config.test.ts`
- Modify: `package.json`, `index.html`, `src/main.tsx:1-24`, `src/shared/testing/setup.ts:1-3`

**Interfaces:**
- Produces:
  - default export `i18n` (an initialized `i18next` instance) from `src/shared/i18n/config.ts` and re-exported by `src/shared/i18n/index.ts`.
  - named re-export `useTranslation` from `src/shared/i18n/index.ts`.
  - `export const zh` (typed `as const`) from `src/shared/i18n/locales/zh.ts` — the complete key catalog every later task consumes via `t("<key>")`.

- [ ] **Step 1: Install dependencies**

Run:
```powershell
cd C:\projects\Preshot; pnpm add i18next react-i18next
```
Expected: `package.json` gains `i18next` and `react-i18next` under dependencies; `pnpm-lock.yaml` updates; exit 0.

- [ ] **Step 2: Create the full `zh` dictionary**

Create `src/shared/i18n/locales/zh.ts`:
```ts
export const zh = {
  shell: {
    tagline: "摄影计划",
    projects: "项目",
    newProject: "新建项目",
    openProject: "打开项目",
    openProjectNamed: "打开项目 {{name}}",
    projectUnavailableNamed: "{{name}}（不可用）",
    unavailable: "不可用",
  },
  agent: {
    title: "助手",
    preview: "预览",
    comingSoon:
      "规划助手即将上线。你将能够在这里对话，来组织拍摄、完善计划并整理参考图。",
    inputLabel: "向助手发送消息",
    inputPlaceholder: "向助手提问……（即将上线）",
    send: "发送",
  },
  plan: {
    exportPdf: "导出 PDF",
    exporting: "正在导出…",
    photographyPlan: "摄影计划",
    shotNotes: "拍摄笔记",
    planPlaceholder: "拍摄清单、日程与备注…",
  },
  save: {
    saving: "正在保存…",
    unsaved: "有未保存的更改",
    saved: "已保存所有更改",
  },
  reference: {
    heading: "参考图",
    sampleSets: "样片集",
    addGroup: "添加参考分组",
    groupTitleAria: "分组标题",
    imagesPerRow: "每行图片数",
    deleteGroup: "删除分组",
    groupAria: "参考分组：{{title}}",
    descriptionAria: "分组描述",
    descriptionPlaceholder: "描述这组参考——氛围、光线、造型或备注…",
    addImage: "添加参考图",
    openImage: "打开参考图 {{index}}",
    removeImage: "移除参考图 {{index}}",
    imageAlt: "参考图",
  },
  lightbox: {
    close: "关闭图片",
    closeButton: "关闭",
  },
  workspace: {
    intro: "启动最近的工作区、创建新的作品，或从桌面库中打开已有项目。",
    menuHint: "文件菜单操作与启动器保持同步，便于新建窗口和快速重开。",
    newProject: "新建项目",
    openProject: "打开项目",
    loading: "正在加载最近的项目",
    launcherEyebrow: "工作区启动器",
    emptyTitle: "开始你的下一个摄影计划",
    emptyBody: "创建一个新的 Preshot 项目，或打开这台电脑上已有的项目。",
  },
  rail: {
    recentProjects: "最近项目",
    recentProjectsHint: "浏览你最近的作品，无需重新打开文件夹即可继续编辑。",
    previous: "上一批项目",
    next: "下一批项目",
  },
  card: {
    recentProject: "最近项目",
    unavailable: "不可用",
    coverAlt: "{{name}} 封面",
    openHint: "打开你的摄影工作区。",
    movedHint: "该项目已移动或在原位置丢失。",
    openAria: "打开项目 {{name}}",
    relocateAria: "重新定位项目 {{name}}",
    removeAria: "将 {{name}} 从最近项目中移除",
    relocate: "重新定位项目",
    remove: "从最近项目中移除",
  },
  dialog: {
    eyebrow: "新建项目",
    title: "创建 Preshot 工作区",
    projectName: "项目名称",
    cancel: "取消",
    create: "创建项目",
    creating: "正在创建…",
  },
  content: {
    newGroupTitle: "新建分组",
    untitledGroup: "未命名分组",
  },
  errors: {
    workspace: "操作未能完成，请重试。",
    plan: "操作未能完成，请重试。",
    boundaryTitle: "Preshot 无法渲染此视图",
    boundaryBody: "请重启应用。如果问题持续，请保留项目文件并报告该错误。",
  },
} as const;
```

- [ ] **Step 3: Create the i18next config singleton**

Create `src/shared/i18n/config.ts`:
```ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { zh } from "./locales/zh";

void i18n.use(initReactI18next).init({
  lng: "zh",
  fallbackLng: "zh",
  resources: { zh: { translation: zh } },
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
```

- [ ] **Step 4: Add typed-key augmentation**

Create `src/shared/i18n/types.d.ts`:
```ts
import type { zh } from "./locales/zh";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof zh };
  }
}
```

- [ ] **Step 5: Create the barrel**

Create `src/shared/i18n/index.ts`:
```ts
export { useTranslation } from "react-i18next";
export { default as i18n } from "./config";
```

- [ ] **Step 6: Write the smoke test**

Create `src/shared/i18n/config.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import i18n from "./config";

describe("i18n config", () => {
  it("initializes the zh locale", () => {
    expect(i18n.language).toBe("zh");
  });

  it("resolves a known key to Chinese", () => {
    expect(i18n.t("plan.exportPdf")).toBe("导出 PDF");
  });

  it("interpolates named values", () => {
    expect(i18n.t("reference.openImage", { index: 1 })).toBe("打开参考图 1");
  });
});
```

- [ ] **Step 7: Run the smoke test to verify it passes**

Run: `pnpm exec vitest run src/shared/i18n/config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Wire the provider and test setup**

Modify `src/main.tsx` — add the import and wrap the tree:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { App } from "./app/App";
import { ErrorBoundary } from "./app/ErrorBoundary";
import i18n from "./shared/i18n/config";
import "@blocknote/mantine/style.css";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Unable to start Preshot: missing root element");
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <I18nextProvider i18n={i18n}>
        <App />
      </I18nextProvider>
    </ErrorBoundary>
  </StrictMode>,
);
```

Modify `src/shared/testing/setup.ts` — add this import at the very top (before other imports) so every component test renders Chinese:
```ts
import "../i18n/config";
```

- [ ] **Step 9: Set the document language**

Modify `index.html`: change the opening `<html …>` tag's `lang` attribute to `zh-CN` (e.g. `<html lang="zh-CN">`).

- [ ] **Step 10: Verify the full suite still passes (components still English, tests unchanged)**

Run: `pnpm typecheck; pnpm test`
Expected: typecheck clean; all existing tests PASS (no component asserts Chinese yet; the only new test is the smoke test).

- [ ] **Step 11: Commit**

```powershell
cd C:\projects\Preshot; git add package.json pnpm-lock.yaml index.html src/main.tsx src/shared/i18n src/shared/testing/setup.ts
git commit -m "feat(i18n): add react-i18next foundation with typed zh dictionary

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 2: Localize the app shell, agent panel, and error boundary

**Files:**
- Modify: `src/app/layout/AppShell.tsx`, `src/features/agent/AgentPanel.tsx`, `src/app/ErrorBoundary.tsx`
- Test: `src/app/layout/AppShell.test.tsx`, `src/features/agent/AgentPanel.test.tsx`, `src/app/ErrorBoundary.test.tsx`

**Interfaces:**
- Consumes: `useTranslation` from `react-i18next`; `i18n` singleton from `src/shared/i18n/config`; keys under `shell.*`, `agent.*`, `errors.*` from Task 1.

- [ ] **Step 1: Update the failing tests first**

In `src/app/layout/AppShell.test.tsx`, replace the English expectations with Chinese:
- `"Open project Sunset Shanghai"` → `"打开项目 Sunset Shanghai"`
- `"Open project Editorial"` → `"打开项目 Editorial"`
- `"New project"` → `"新建项目"`, `"Open project"` → `"打开项目"`
- navigation name `"Projects"` → `"项目"`
- `"Missing Archive (unavailable)"` → `"Missing Archive（不可用）"`
- `"Unavailable"` text → `"不可用"`
- The workspace-error assertion `toHaveTextContent("Unable to open workspace project")` → `toHaveTextContent("操作未能完成，请重试。")`

In `src/features/agent/AgentPanel.test.tsx`, swap any asserted strings (e.g. heading `"Assistant"` → `"助手"`, `"Send"` → `"发送"`, placeholder/coming-soon text → the Chinese values from `zh.agent`).

In `src/app/ErrorBoundary.test.tsx`, swap the asserted title/body to `"Preshot 无法渲染此视图"` / `"请重启应用。如果问题持续，请保留项目文件并报告该错误。"`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run src/app/layout/AppShell.test.tsx src/features/agent/AgentPanel.test.tsx src/app/ErrorBoundary.test.tsx`
Expected: FAIL (components still render English).

- [ ] **Step 3: Localize `AppShell.tsx`**

Add `import { useTranslation } from "react-i18next";` and `const { t } = useTranslation();` at the top of the `AppShell` function body. Replace literals:

| Current literal | Replacement |
|---|---|
| `Photography planning` | `{t("shell.tagline")}` |
| `Projects` (the `<p>` and nav `aria-label="Projects"`) | `{t("shell.projects")}` / `aria-label={t("shell.projects")}` |
| ``Open project ${project.name}`` | `t("shell.openProjectNamed", { name: project.name })` |
| ``${project.name} (unavailable)`` | `t("shell.projectUnavailableNamed", { name: project.name })` |
| `Unavailable` | `{t("shell.unavailable")}` |
| `New project` | `{t("shell.newProject")}` |
| `Open project` | `{t("shell.openProject")}` |

Replace the error banner body `{error}` with `{t("errors.workspace")}` (keep the `{error ? (…) : null}` guard so it only renders when an error exists). Leave the `Preshot` `<h1>` literal.

- [ ] **Step 4: Localize `AgentPanel.tsx`**

Add `useTranslation`. Replace: `Assistant` → `{t("agent.title")}`, `Preview` → `{t("agent.preview")}`, the coming-soon `<p>` text → `{t("agent.comingSoon")}`, `Message the assistant` (sr-only label) → `{t("agent.inputLabel")}`, `placeholder="Ask the assistant… (coming soon)"` → `placeholder={t("agent.inputPlaceholder")}`, `Send` → `{t("agent.send")}`.

- [ ] **Step 5: Localize `ErrorBoundary.tsx`**

`ErrorBoundary` is a class component, so use the singleton. Add `import i18n from "../shared/i18n/config";` and in `render()` replace the `<h1>` text with `{i18n.t("errors.boundaryTitle")}` and the `<p>` text with `{i18n.t("errors.boundaryBody")}`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/app/layout/AppShell.test.tsx src/features/agent/AgentPanel.test.tsx src/app/ErrorBoundary.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
cd C:\projects\Preshot; git add src/app/layout/AppShell.tsx src/features/agent/AgentPanel.tsx src/app/ErrorBoundary.tsx src/app/layout/AppShell.test.tsx src/features/agent/AgentPanel.test.tsx src/app/ErrorBoundary.test.tsx
git commit -m "feat(i18n): localize app shell, agent panel, error boundary

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 3: Localize the plan panel chrome (PlanPanel, SaveStatus, PhotographyPlanTab)

**Files:**
- Modify: `src/features/plan/PlanPanel.tsx`, `src/features/plan/SaveStatus.tsx`, `src/features/plan/PhotographyPlanTab.tsx`
- Test: `src/features/plan/PlanPanel.test.tsx`

**Interfaces:**
- Consumes: `useTranslation`; keys `plan.*`, `save.*`, `errors.plan`.

- [ ] **Step 1: Update the failing test first**

In `src/features/plan/PlanPanel.test.tsx`, swap asserted strings: the textbox name `"Photography plan"` → `"摄影计划"`; any `"Export PDF"` → `"导出 PDF"`; any save-status labels (`"All changes saved"` → `"已保存所有更改"`, etc.); any plan-error text → `"操作未能完成，请重试。"`. (Keep non-string assertions like `toHaveValue("<p>Plan body</p>")`.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/features/plan/PlanPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Localize `SaveStatus.tsx`**

Convert the static label map to keys. Replace the module-level `STATUS` label strings with keys and read them via `useTranslation` inside the component:
```tsx
import { useTranslation } from "react-i18next";

export type SaveState = "saved" | "unsaved" | "saving";

const DOT: Record<SaveState, string> = {
  saving: "bg-amber-400 animate-pulse",
  unsaved: "bg-stone-400",
  saved: "bg-emerald-500",
};

const LABEL_KEY: Record<SaveState, "save.saving" | "save.unsaved" | "save.saved"> = {
  saving: "save.saving",
  unsaved: "save.unsaved",
  saved: "save.saved",
};

export function SaveStatus({ state }: { state: SaveState }) {
  const { t } = useTranslation();
  return (
    <span
      aria-live="polite"
      className="inline-flex items-center gap-2 text-xs text-stone-500"
      data-testid="save-status"
      role="status"
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${DOT[state]}`} />
      {t(LABEL_KEY[state])}
    </span>
  );
}
```

- [ ] **Step 4: Localize `PlanPanel.tsx`**

Add `useTranslation`. Replace `Exporting…` → `{t("plan.exporting")}`, `Export PDF` → `{t("plan.exportPdf")}`. Replace the error banner `{error}` with `{t("errors.plan")}` (keep the `{error ? … : null}` guard).

- [ ] **Step 5: Localize `PhotographyPlanTab.tsx`**

Add `useTranslation`. Replace: section `aria-label="Photography Plan"` → `aria-label={t("plan.photographyPlan")}`; eyebrow `Photography Plan` → `{t("plan.photographyPlan")}`; heading `Shot notes` → `{t("plan.shotNotes")}`; `ariaLabel="Photography plan"` → `ariaLabel={t("plan.photographyPlan")}`; `placeholder="Shot list, schedule, and notes…"` → `placeholder={t("plan.planPlaceholder")}`.

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm exec vitest run src/features/plan/PlanPanel.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
cd C:\projects\Preshot; git add src/features/plan/PlanPanel.tsx src/features/plan/SaveStatus.tsx src/features/plan/PhotographyPlanTab.tsx src/features/plan/PlanPanel.test.tsx
git commit -m "feat(i18n): localize plan panel chrome and save status

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 4: Localize the reference-images area and default content

**Files:**
- Modify: `src/features/plan/ReferenceImagesTab.tsx`, `src/features/plan/GroupImageGrid.tsx`, `src/features/plan/SortableImageTile.tsx`, `src/features/plan/ReferenceImageLightbox.tsx`, `src/features/plan/ProjectPlanProvider.tsx`
- Test: `src/features/plan/ReferenceImagesTab.test.tsx`, `src/features/plan/GroupImageGrid.test.tsx`, `src/features/plan/ReferenceImageLightbox.test.tsx`, `src/features/plan/ProjectPlanProvider.test.tsx`

**Interfaces:**
- Consumes: `useTranslation`; keys `reference.*`, `lightbox.*`, `content.newGroupTitle`.

- [ ] **Step 1: Update the failing tests first**

- `ReferenceImagesTab.test.tsx`: swap asserted strings — `"Add reference group"` → `"添加参考分组"`, `"Reference group: …"` → `"参考分组：…"`, `"Images per row"` → `"每行图片数"`, `"Delete group"` → `"删除分组"`, `"Group title"` → `"分组标题"`, description placeholder → the Chinese value, and any `"Open reference image N"`/`"Remove reference image N"` → `"打开参考图 N"`/`"移除参考图 N"`.
- `GroupImageGrid.test.tsx`: `"Add reference image"` → `"添加参考图"`; image aria names → `"打开参考图 N"` / `"移除参考图 N"`.
- `ReferenceImageLightbox.test.tsx`: the close button `aria-label` query `"Close image"` → `"关闭图片"`; if it asserts the button text `"Close"`, → `"关闭"`. (The `alt` prop is passed by the test directly and can stay as-is, or update to a Chinese literal — it is test input, not app copy.)
- `ProjectPlanProvider.test.tsx`: if it asserts the default group title `"New group"` after "add group", change to `"新建分组"`; swap any other asserted UI strings (e.g. `"Add reference group"`, lightbox `"Close image"`) to Chinese.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm exec vitest run src/features/plan/ReferenceImagesTab.test.tsx src/features/plan/GroupImageGrid.test.tsx src/features/plan/ReferenceImageLightbox.test.tsx src/features/plan/ProjectPlanProvider.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Localize `ReferenceImagesTab.tsx`**

Add `useTranslation`. Replace:

| Current literal | Replacement |
|---|---|
| `Reference Images` (eyebrow) | `{t("reference.heading")}` |
| `Sample sets` | `{t("reference.sampleSets")}` |
| `Add reference group` | `{t("reference.addGroup")}` |
| `aria-label="Group title"` | `aria-label={t("reference.groupTitleAria")}` |
| `Images per row` (label text + `aria-label="Images per row"`) | `{t("reference.imagesPerRow")}` / `aria-label={t("reference.imagesPerRow")}` |
| `Delete group` (text + `aria-label="Delete group"`) | `{t("reference.deleteGroup")}` / `aria-label={t("reference.deleteGroup")}` |
| ``Reference group: ${group.title \|\| "Untitled"}`` | `t("reference.groupAria", { title: group.title \|\| t("content.untitledGroup") })` |
| `ariaLabel="Group description"` | `ariaLabel={t("reference.descriptionAria")}` |
| `placeholder="Describe this set of references — …"` | `placeholder={t("reference.descriptionPlaceholder")}` |

- [ ] **Step 4: Localize `GroupImageGrid.tsx`**

Add `useTranslation`. Replace `aria-label="Add reference image"` → `aria-label={t("reference.addImage")}` (and any visible "Add reference image" text likewise).

- [ ] **Step 5: Localize `SortableImageTile.tsx`**

Add `useTranslation`. Replace ``aria-label={`Open reference image ${index + 1}`}`` → `aria-label={t("reference.openImage", { index: index + 1 })}` and ``aria-label={`Remove reference image ${index + 1}`}`` → `aria-label={t("reference.removeImage", { index: index + 1 })}`. Update the `<img alt={`Reference image ${index + 1}`}>` to `alt={t("reference.imageAlt")}` (or keep an indexed alt via a dedicated key if preferred; use `reference.imageAlt`).

- [ ] **Step 6: Localize `ReferenceImageLightbox.tsx`**

Add `useTranslation`. Replace `aria-label="Close image"` → `aria-label={t("lightbox.close")}` and the button text `Close` → `{t("lightbox.closeButton")}`. (`alt` stays a prop.)

- [ ] **Step 7: Localize default content in `ProjectPlanProvider.tsx`**

Add `const { t } = useTranslation();` in the provider component. At line ~203 replace `service.addGroup(planRef.current, "New group")` with `service.addGroup(planRef.current, t("content.newGroupTitle"))`. At the lightbox render (~line 364) replace `alt="Reference image"` with `alt={t("reference.imageAlt")}`.

- [ ] **Step 8: Run to verify they pass**

Run: `pnpm exec vitest run src/features/plan/ReferenceImagesTab.test.tsx src/features/plan/GroupImageGrid.test.tsx src/features/plan/ReferenceImageLightbox.test.tsx src/features/plan/ProjectPlanProvider.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
cd C:\projects\Preshot; git add src/features/plan/ReferenceImagesTab.tsx src/features/plan/GroupImageGrid.tsx src/features/plan/SortableImageTile.tsx src/features/plan/ReferenceImageLightbox.tsx src/features/plan/ProjectPlanProvider.tsx src/features/plan/ReferenceImagesTab.test.tsx src/features/plan/GroupImageGrid.test.tsx src/features/plan/ReferenceImageLightbox.test.tsx src/features/plan/ProjectPlanProvider.test.tsx
git commit -m "feat(i18n): localize reference images area and default group title

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 5: Localize the BlockNote editor chrome

**Files:**
- Modify: `src/features/plan/RichTextEditor.tsx`
- Test: `src/features/plan/RichTextEditor.test.tsx`

**Interfaces:**
- Consumes: the BlockNote `zh` locale (`import { zh } from "@blocknote/core/locales"`).

- [ ] **Step 1: Pass the Chinese dictionary to BlockNote**

In `src/features/plan/RichTextEditor.tsx` add `import { zh } from "@blocknote/core/locales";` and change `const editor = useCreateBlockNote();` to `const editor = useCreateBlockNote({ dictionary: zh });`.

- [ ] **Step 2: Verify the editor still mounts (assertion unchanged by dictionary)**

Run: `pnpm exec vitest run src/features/plan/RichTextEditor.test.tsx`
Expected: PASS. (The existing test asserts the wrapper `role="group"` by its `ariaLabel` prop, which is unaffected; if that test still uses the English label `"Photography plan"`, update it to `"摄影计划"` only if the test constructs the component via `PhotographyPlanTab`; the standalone `RichTextEditor` test passes `ariaLabel` directly and can keep its own literal.)

- [ ] **Step 3: Typecheck (confirms the locale import resolves)**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```powershell
cd C:\projects\Preshot; git add src/features/plan/RichTextEditor.tsx src/features/plan/RichTextEditor.test.tsx
git commit -m "feat(i18n): localize BlockNote editor chrome to Chinese

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 6: Localize the workspace launcher surfaces

**Files:**
- Modify: `src/features/workspace/WorkspaceLauncher.tsx`, `src/features/workspace/ProjectCard.tsx`, `src/features/workspace/ProjectRail.tsx`, `src/features/workspace/NewProjectDialog.tsx`
- Test: `src/features/workspace/WorkspaceLauncher.test.tsx`

**Interfaces:**
- Consumes: `useTranslation`; keys `workspace.*`, `rail.*`, `card.*`, `dialog.*`, `errors.workspace`.

- [ ] **Step 1: Update the failing test first**

In `src/features/workspace/WorkspaceLauncher.test.tsx`, swap asserted strings to Chinese, e.g.: `"New project"` → `"新建项目"`, `"Open project"` → `"打开项目"`, `"Recent projects"` → `"最近项目"`, `"Open project <name>"` → `"打开项目 <name>"`, `"Relocate project"` → `"重新定位项目"`, `"Remove from recent projects"` → `"从最近项目中移除"`, dialog `"Create a Preshot workspace"` → `"创建 Preshot 工作区"`, `"Project name"` → `"项目名称"`, `"Cancel"` → `"取消"`, `"Create project"` → `"创建项目"`, any error text → `"操作未能完成，请重试。"`, loading `"Loading recent projects"` → `"正在加载最近的项目"`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/features/workspace/WorkspaceLauncher.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Localize `WorkspaceLauncher.tsx`**

Add `useTranslation`. Replace the intro `<p>` → `{t("workspace.intro")}`, the menu-hint `<p>` → `{t("workspace.menuHint")}`, `New project` → `{t("workspace.newProject")}`, `Open project` → `{t("workspace.openProject")}`, `Loading recent projects` → `{t("workspace.loading")}`, `Workspace launcher` → `{t("workspace.launcherEyebrow")}`, `Start your next photography plan` → `{t("workspace.emptyTitle")}`, the empty-state body → `{t("workspace.emptyBody")}`, and the error banner `{error}` → `{t("errors.workspace")}` (keep the `{error ? … : null}` guard). Leave the two `Preshot` brand literals.

- [ ] **Step 4: Localize `ProjectCard.tsx`**

Add `useTranslation`. Replace: `Recent project` → `{t("card.recentProject")}`, `Unavailable` → `{t("card.unavailable")}`, ``alt={`${project.name} cover`}`` → `alt={t("card.coverAlt", { name: project.name })}`, `Open your photography workspace.` → `{t("card.openHint")}`, the moved/missing `<p>` → `{t("card.movedHint")}`, ``aria-label={`Open project ${project.name}`}`` → `aria-label={t("card.openAria", { name: project.name })}`, ``aria-label={`Relocate project ${project.name}`}`` → `aria-label={t("card.relocateAria", { name: project.name })}`, ``aria-label={`Remove ${project.name} from recent projects`}`` → `aria-label={t("card.removeAria", { name: project.name })}`, `Relocate project` (button text) → `{t("card.relocate")}`, `Remove from recent projects` (button text) → `{t("card.remove")}`.

- [ ] **Step 5: Localize `ProjectRail.tsx`**

Add `useTranslation`. Replace: heading `Recent projects` → `{t("rail.recentProjects")}`, the hint `<p>` → `{t("rail.recentProjectsHint")}`, `aria-label="Previous projects"` → `aria-label={t("rail.previous")}`, `aria-label="Next projects"` → `aria-label={t("rail.next")}`, the scroller `aria-label="Recent projects"` → `aria-label={t("rail.recentProjects")}`.

- [ ] **Step 6: Localize `NewProjectDialog.tsx`**

Add `useTranslation`. Replace: eyebrow `New project` → `{t("dialog.eyebrow")}`, `Create a Preshot workspace` → `{t("dialog.title")}`, `Project name` → `{t("dialog.projectName")}`, `Cancel` → `{t("dialog.cancel")}`, `Creating...` → `{t("dialog.creating")}`, `Create project` → `{t("dialog.create")}`.

- [ ] **Step 7: Run to verify it passes**

Run: `pnpm exec vitest run src/features/workspace/WorkspaceLauncher.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
cd C:\projects\Preshot; git add src/features/workspace/WorkspaceLauncher.tsx src/features/workspace/ProjectCard.tsx src/features/workspace/ProjectRail.tsx src/features/workspace/NewProjectDialog.tsx src/features/workspace/WorkspaceLauncher.test.tsx
git commit -m "feat(i18n): localize workspace launcher, cards, rail, and dialog

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 7: Chinese demo seed, e2e updates, and full validation

**Files:**
- Modify: `src/infrastructure/plan/browserPlan.ts`, `e2e/plan.spec.ts`, `e2e/layout.spec.ts`, `docs/design_docs/featurelist.json`
- Test: `src/infrastructure/plan/browserPlan.test.ts` (only if it asserts seed strings)

**Interfaces:**
- Consumes: nothing new; this task makes the demo/e2e surfaces Chinese to match the localized UI.

- [ ] **Step 1: Translate the browser demo seed**

In `src/infrastructure/plan/browserPlan.ts`, rewrite `SEEDED_PLAN` sample strings to Chinese (static data — not keyed), e.g.:
```ts
const SEEDED_PLAN: ProjectPlan = {
  photographyPlan:
    "<h2>日落大片</h2><p>海滨的黄金时刻。记得带 85mm 镜头。</p>",
  referenceGroups: [
    {
      id: "seed-group",
      title: "造型参考",
      description: "这组大片的氛围、光线与姿势参考。",
      columnsPerRow: 3,
      images: [
        { id: "seed-1", file: "references/0001.png" },
        { id: "seed-2", file: "references/0002.png" },
      ],
    },
  ],
};
```
If `src/infrastructure/plan/browserPlan.test.ts` asserts any of these strings, update those assertions to the Chinese values.

- [ ] **Step 2: Update `e2e/plan.spec.ts`**

Replace every English role/text query with its Chinese equivalent, matching the localized UI and the Chinese seed:
- `"Reference group: Lookbook"` → `"参考分组：造型参考"`
- `"Reference group: New group"` → `"参考分组：新建分组"`
- `"Open reference image 1"` / `"Open reference image 2"` → `"打开参考图 1"` / `"打开参考图 2"`
- `"Add reference image"` → `"添加参考图"`
- `"Add reference group"` → `"添加参考分组"`
- `"Export PDF"` → `"导出 PDF"`, `"Exporting…"` → `"正在导出…"`
- `"Close image"` → `"关闭图片"`
- save-status `"All changes saved"` → `"已保存所有更改"`, `"Unsaved changes"` → `"有未保存的更改"`
- the block-editor test's `role="group"` name `"Photography plan"` → `"摄影计划"`
- any `"New project"` / `"Open project"` → `"新建项目"` / `"打开项目"`

- [ ] **Step 3: Update `e2e/layout.spec.ts`**

Replace: `"New project"` (exact) → `"新建项目"`, `"Open project"` (exact) → `"打开项目"`, `"Add reference group"` → `"添加参考分组"`, `"Reference group: New group"` → `"参考分组：新建分组"`, `"Add reference image"` → `"添加参考图"`, and the `section[aria-label="Plan"]` selector — update to the localized plan section aria (`"摄影计划"` is the PhotographyPlanTab section; the PlanPanel wrapper `aria-label="Plan"` has no visible text — confirm whether PlanPanel's `<section aria-label="Plan">` is localized: if you localize it, use the new value here; otherwise keep `"Plan"`). Note: PlanPanel's outer `<section aria-label="Plan">` is not in the string tables above — leave it as `"Plan"` (structural, not user-visible) so this selector stays valid.

- [ ] **Step 4: Run the e2e suite**

Run: `pnpm test:e2e`
Expected: all pass (10). If a query fails, fix the specific Chinese string to match the rendered text.

- [ ] **Step 5: Run the full validation matrix**

Run: `pnpm typecheck; pnpm lint; pnpm test; pnpm build`
Expected: typecheck clean; lint clean; all unit tests pass; build succeeds.

- [ ] **Step 6: Update the feature list**

Add a feature entry (or extend the plan-editing feature) in `docs/design_docs/featurelist.json` recording: react-i18next foundation, full Chinese UI + defaults + demo seed, BlockNote zh dictionary, generic Chinese error banners, typed keys; include a `lastVerified` block with the passing counts. Validate JSON:
Run: `node -e "JSON.parse(require('fs').readFileSync('docs/design_docs/featurelist.json','utf8'));console.log('OK')"`

- [ ] **Step 7: Commit**

```powershell
cd C:\projects\Preshot; git add src/infrastructure/plan/browserPlan.ts e2e/plan.spec.ts e2e/layout.spec.ts docs/design_docs/featurelist.json
git commit -m "feat(i18n): Chinese demo seed + e2e, finalize localization

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Self-Review Notes

- **Spec coverage:** i18n module + typed keys (Task 1) ✓; full UI localization across shell/agent/error-boundary (Task 2), plan chrome (Task 3), reference area + defaults (Task 4), BlockNote (Task 5), workspace launcher (Task 6) ✓; demo seed + e2e + generic error banners (Tasks 2/3/6/7) ✓; test setup renders Chinese (Task 1) ✓; no switcher/date-localization (out of scope, honored) ✓.
- **Interpolation keys** (`{{name}}`, `{{index}}`, `{{title}}`) are all defined in `zh.ts` (Task 1) and consumed with matching param names in later tasks.
- **Error banners:** presentation-layer generic Chinese (`errors.workspace`, `errors.plan`); internal thrown/logged messages remain English per the spec.
- **Rust check:** new real projects start from `EMPTY_PLAN` (no seeded strings), so no Rust localization is required; the only default title comes from `ProjectPlanProvider` (Task 4).
