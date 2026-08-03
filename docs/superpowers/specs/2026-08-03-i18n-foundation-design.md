# i18n Foundation (Chinese Localization) Design

## Goal

Introduce a real internationalization layer to Preshot and convert the entire
user-facing UI to Chinese. Only Chinese (`zh`) is shipped now, but the
architecture must make adding another locale later a drop-in change — no
hardcoded strings left in components.

This is the first of two spec→plan→implement cycles the user requested; the
second (a canvas-based component system) is out of scope here and will build on
this i18n layer so its strings are Chinese from the start.

## Scope

In scope:

- Add `i18next` + `react-i18next` and a `src/shared/i18n/` module (config,
  `zh` locale, typed keys, provider wiring).
- Replace **every** user-facing English literal across `app/`, `features/`, and
  `shared/` UI with a translation key rendered in Chinese: app shell, agent
  panel, plan/reference tabs, save status, reference lightbox, error boundary,
  workspace launcher, project cards, project rail, and the new-project dialog.
- Localize **app-generated default content**: the default new-group title
  (`"New group"`) and the `"Untitled"` group-name fallback.
- Localize **browser demo/sample content** (`SEEDED_PLAN`) to Chinese so the
  dev/e2e page is fully Chinese.
- Localize the **BlockNote editor chrome** (slash menu, formatting toolbar,
  placeholders) via BlockNote's built-in `zh` dictionary.
- Show a **Chinese generic message** in user-facing error banners.
- Update all component tests and Playwright e2e to assert the Chinese strings.

Out of scope (non-goals):

- No language-switcher UI (single locale now; architecture stays swappable).
- No date/number localization (the current UI shows no dates/numbers needing
  `Intl` formatting).
- No error-code system: internal `throw new Error("…")` messages stay English
  for logs/developers; only the presented banner is Chinese.
- The canvas component system, per-image captions, and the photography-plan
  template are a separate later cycle.
- No changes to the `.preshot` persistence schema, domain models, or Rust
  commands beyond localizing any default title string they may emit.

## Decisions (from brainstorming)

- **Library:** `react-i18next` (industry standard) over a bespoke layer — the
  user chose it explicitly. We add typed keys via module augmentation to regain
  compile-time key safety.
- **Single language, hardwired:** `lng: "zh"`, `fallbackLng: "zh"`. No detector,
  no switcher.
- **Full Chinese page:** UI chrome + app-generated defaults + browser demo seed
  are all Chinese.
- **BlockNote is localized separately** from react-i18next, using its own
  dictionary prop.

## Architecture & Data Flow

### Module: `src/shared/i18n/`

`shared` is the correct layer (reusable UI utility, no business rules); `app/`
and `features/` may depend on it (AGENTS.md dependency rules).

- **`config.ts`** — builds and exports the configured singleton:

  ```ts
  import i18n from "i18next";
  import { initReactI18next } from "react-i18next";
  import { zh } from "./locales/zh";

  i18n.use(initReactI18next).init({
    lng: "zh",
    fallbackLng: "zh",
    resources: { zh: { translation: zh } },
    interpolation: { escapeValue: false }, // React already escapes
    returnNull: false,
  });

  export default i18n;
  ```

- **`locales/zh.ts`** — `export const zh = { … } as const;` a nested object keyed
  by namespace: `shell`, `agent`, `plan`, `reference`, `save`, `workspace`,
  `dialog`, `card`, `lightbox`, `errors`, `content`. Values are Chinese;
  interpolated values use i18next `{{var}}` syntax.

- **`types.d.ts`** — module augmentation for typed `t()`:

  ```ts
  import type { zh } from "./locales/zh";
  declare module "i18next" {
    interface CustomTypeOptions {
      defaultNS: "translation";
      resources: { translation: typeof zh };
    }
  }
  ```

  This makes unknown keys a compile error and enables autocomplete, covering the
  main weakness of react-i18next's default typing.

- **`index.ts`** — re-exports the instance (and re-exports `useTranslation` from
  `react-i18next` for a single import site).

### Wiring

- **`src/main.tsx`** — import `./shared/i18n/config` (side-effect init) and wrap
  the root in `<I18nextProvider i18n={i18n}>`. The provider makes tests and app
  share one initialized instance.
- **`index.html`** — set `<html lang="zh-CN">`.

### Usage pattern

- **Components:** `const { t } = useTranslation();` then replace literals, e.g.
  `t("plan.exportPdf")`, `t("save.saved")`, `t("reference.openImage", { index })`.
- **Interpolation:** i18next `{{var}}` — key `"打开参考图 {{index}}"` rendered via
  `t("reference.openImage", { index })`.
- **Non-component code** (e.g. the provider creating a group): call the instance
  directly — `i18n.t("content.newGroupTitle")` — since hooks aren't available
  there.

### Representative key map (illustrative, not exhaustive)

| Key | Chinese |
|-----|---------|
| `shell.appName` | Preshot（保留） |
| `shell.tagline` | 摄影计划 |
| `shell.projects` | 项目 |
| `shell.newProject` / `workspace.newProject` | 新建项目 |
| `shell.openProject` / `workspace.openProject` | 打开项目 |
| `shell.openProjectNamed` | 打开项目 {{name}} |
| `shell.projectUnavailable` | {{name}}（不可用） |
| `agent.title` | 助手 |
| `agent.preview` | 预览 |
| `agent.comingSoon` | 规划助手即将上线…… |
| `agent.inputPlaceholder` | 向助手提问……（即将上线） |
| `agent.send` | 发送 |
| `plan.exportPdf` | 导出 PDF |
| `plan.exporting` | 正在导出… |
| `plan.photographyPlanEyebrow` | 摄影计划 |
| `plan.shotNotes` | 拍摄笔记 |
| `plan.planPlaceholder` | 拍摄清单、日程与备注… |
| `save.saved` | 已保存所有更改 |
| `save.unsaved` | 有未保存的更改 |
| `save.saving` | 正在保存… |
| `reference.heading` | 参考图 |
| `reference.sampleSets` | 样片集 |
| `reference.addGroup` | 添加参考分组 |
| `reference.groupTitle` | 分组标题 |
| `reference.imagesPerRow` | 每行图片数 |
| `reference.deleteGroup` | 删除分组 |
| `reference.addImage` | 添加参考图 |
| `reference.openImage` | 打开参考图 {{index}} |
| `reference.removeImage` | 移除参考图 {{index}} |
| `reference.groupAria` | 参考分组：{{title}} |
| `reference.descriptionPlaceholder` | 描述这组参考——氛围、光线、造型或备注… |
| `lightbox.close` | 关闭图片 |
| `card.recentProject` | 最近项目 |
| `card.unavailable` | 不可用 |
| `card.openHint` | 打开你的摄影工作区。 |
| `card.movedHint` | 该项目已移动或在原位置丢失。 |
| `card.relocate` | 重新定位项目 |
| `card.remove` | 从最近项目中移除 |
| `dialog.newProjectTitle` | 创建 Preshot 工作区 |
| `dialog.projectName` | 项目名称 |
| `dialog.cancel` | 取消 |
| `dialog.create` | 创建项目 |
| `dialog.creating` | 正在创建… |
| `content.newGroupTitle` | 新建分组 |
| `content.untitledGroup` | 未命名分组 |
| `errors.openProject` | 无法打开该项目，请重试。 |

The final `zh.ts` will hold the complete set; keys above show shape and coverage.

## Default & Sample Content

- **`ProjectPlanProvider.tsx:203`** — `service.addGroup(planRef.current, "New group")`
  becomes `service.addGroup(planRef.current, i18n.t("content.newGroupTitle"))`.
- **`ReferenceImagesTab.tsx`** — the `` `Reference group: ${group.title || "Untitled"}` ``
  aria label becomes `t("reference.groupAria", { title: group.title || t("content.untitledGroup") })`.
- **`browserPlan.ts` `SEEDED_PLAN`** — rewrite the sample strings to Chinese
  directly (static sample data, not keyed): plan heading/body, group title
  (`"Lookbook"` → e.g. `"造型参考"`), and descriptions.
- **Rust check:** verify whether new real projects emit a default title/content
  string (`src-tauri`); if so, localize it consistently. (No schema change.)

## BlockNote Editor Localization

`RichTextEditor` (BlockNote) UI is not covered by react-i18next. Pass BlockNote's
built-in Chinese dictionary to the editor (`useCreateBlockNote({ dictionary })`,
importing the `zh` locale from BlockNote's locales). The exact import path is
verified during implementation. The component's own `placeholder`/`ariaLabel`
props continue to come from i18next.

## Error Handling

- Internal `throw new Error("…")` messages in `domain`/`infrastructure` stay
  English (developer/log-facing). No behavior change there.
- User-facing error banners (the workspace error in `AppShell`/`WorkspaceLauncher`
  and the plan error in `PlanPanel`) render a **translated generic Chinese
  message** (e.g. `errors.openProject`) instead of the raw thrown string; the raw
  detail remains in logs. This keeps scope tight (no error-code taxonomy).
- Missing keys can't occur for known strings (typed keys → compile error); if one
  slipped through, i18next returns the key string (visible, not a crash).

## Testing

- **Test setup:** `src/shared/testing/setup.ts` imports the i18n config so every
  component test renders real Chinese synchronously (one initialized instance).
- **Component tests:** update assertions from English to Chinese across the
  affected suites (AppShell, PlanPanel, ReferenceImagesTab, GroupImageGrid,
  AgentPanel, RichTextEditor, ReferenceImageLightbox, ErrorBoundary, App,
  ProjectPlanProvider, WorkspaceLauncher, and any workspace tests). These are
  mechanical role-name/text swaps.
- **i18n smoke test:** a small unit test asserting a representative key resolves
  to the expected Chinese string and that interpolation
  (`t("reference.openImage", { index: 1 })`) fills `{{index}}`. (i18next itself
  is upstream-tested; this only guards our config/dictionary.)
- **Playwright e2e:** update `plan.spec.ts` and `layout.spec.ts` — every English
  role/text query (`"Export PDF"`, `"Add reference group"`,
  `"Reference group: Lookbook"`, `"Open reference image 1"`, `"New project"`,
  `"Open project"`, save-status labels, etc.) becomes its Chinese equivalent,
  matching the localized UI and Chinese seed.
- **Domain tests:** unaffected (no user-facing strings in `domain`).

## Risks & Mitigations

- **Broad test churn:** localizing strings touches many test assertions. Mitigate
  by keeping keys/values centralized in `zh.ts`, updating tests alongside each
  component, and running the full unit + e2e suites before shipping.
- **BlockNote dictionary import path/shape:** the exact export may differ by
  version; verified against the installed `@blocknote` version during
  implementation, with the editor smoke/e2e test guarding it.
- **Instance init order in tests:** importing the config in the shared test setup
  guarantees initialization before any component renders; component tests don't
  each re-init.
- **Untranslated dynamic error strings:** by design, only the banner is
  translated; raw messages stay in logs. Acceptable for this cycle.

## Documented Limitations

- Only Chinese ships; no runtime language switching.
- No date/number/plural localization yet (not needed by the current UI).
- Deep domain/infrastructure error messages are English in logs; users see a
  generic Chinese banner.
