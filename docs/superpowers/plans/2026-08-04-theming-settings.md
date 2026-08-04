# Theming (Dark/Light) + Settings Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Light/Dark/System theming (default System) selectable from an in-app Settings panel (gear button), persisted to `~/.preshot/settings.json`, applied via Tailwind v4's class-based `dark:` variant across the app + BlockNote.

**Architecture:** A Rust settings command persists `~/.preshot/settings.json`; a `SettingsRepository` port + adapters; a React `ThemeProvider` resolves the theme (System→`matchMedia`), toggles `.dark` on `<html>`, and persists changes; components use Tailwind `dark:` variants.

**Tech Stack:** Tauri 2 (Rust), React 19 + TS, Tailwind v4 (CSS config), react-i18next (zh), Vitest, Playwright.

## Global Constraints

- Tailwind v4 (no `tailwind.config.js`; config in `src/styles.css`). Dark mode uses a CLASS strategy via `@custom-variant dark (&:where(.dark, .dark *));` — NOT prefers-color-scheme alone.
- Themes: `"light" | "dark" | "system"`; default `"system"`. Light = light-gray surfaces + dark text; Dark = near-black surfaces + light text; both WCAG-AA contrast.
- Persist to `~/.preshot/settings.json` via Rust; the app creates `~/.preshot` when missing.
- All new UI text is Chinese i18n keys in `src/shared/i18n/locales/zh.ts`. No hardcoded UI text.
- Every task keeps the suite green (`pnpm typecheck`, `lint`, `test`; `cargo test` for Rust tasks). Commit trailer: `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

## File Structure

- `src-tauri/src/settings.rs` (new) + `lib.rs` (register) — read/write `~/.preshot/settings.json`.
- `src/domain/settings/{models.ts,ports.ts}` (new) — `AppSettings`, `normalizeSettings`, `SettingsRepository`.
- `src/infrastructure/settings/{tauriSettings.ts,browserSettings.ts}` (new).
- `src/app/theme/ThemeProvider.tsx` (new) + wire into `src/app/App.tsx`.
- `src/styles.css` — dark variant + root/theme colors + BlockNote dark.
- `src/features/settings/{SettingsButton.tsx,SettingsPanel.tsx}` (new) + top-bar wiring.
- `~84` component files — add `dark:` variants (Task 4, split by area).
- `src/shared/i18n/locales/zh.ts` — settings/theme keys.

---

### Task 1: Rust settings command (`~/.preshot/settings.json`)

**Files:** Create `src-tauri/src/settings.rs`; Modify `src-tauri/src/lib.rs`.

**Interfaces produced:** `#[tauri::command] read_settings() -> Result<serde_json::Value, CommandError>` (returns `{}` when the file is absent), `write_settings(value: serde_json::Value) -> Result<(), CommandError>` (atomic); pure `settings_dir()`/`settings_path()`.

- [ ] **Step 1:** Write a Rust unit test in `settings.rs`: `settings_path` ends with `.preshot/settings.json`; writing a value then reading returns it; reading a non-existent file (temp dir) returns an empty object. Run `cargo test --manifest-path src-tauri\Cargo.toml` → FAIL.
- [ ] **Step 2:** Implement: `preshot_home()` = user home + `.preshot` (use `dirs`/`std::env` as the crate already resolves home elsewhere — mirror `workspace.rs`); `settings_path()` = home/`settings.json`; `read_settings` creates `~/.preshot` if missing, returns `{}` when the file is absent, else parses the JSON `Value`; `write_settings` creates `~/.preshot`, writes atomically (temp + rename). Use the crate `CommandError` (mirror `pdf.rs`/`workspace.rs`). Register both in `lib.rs` `generate_handler!`. Run cargo test → PASS.
- [ ] **Step 3:** Commit `feat(settings): add ~/.preshot/settings.json read/write commands`.

---

### Task 2: Domain settings model + adapters

**Files:** Create `src/domain/settings/models.ts`, `src/domain/settings/ports.ts`, `src/infrastructure/settings/tauriSettings.ts`, `src/infrastructure/settings/browserSettings.ts` (+ tests).

**Interfaces produced:** `type Theme = "light"|"dark"|"system"`; `interface AppSettings { theme: Theme }`; `DEFAULT_SETTINGS = { theme: "system" }`; `normalizeSettings(raw: unknown): AppSettings` (total; unknown/missing → default); `interface SettingsRepository { read(): Promise<AppSettings>; write(s: AppSettings): Promise<void> }`.

- [ ] **Step 1:** Write failing tests: `normalizeSettings` maps `{theme:"dark"}`→dark, `{}`/`null`/`{theme:"x"}`→system. `tauriSettings.read` invokes `read_settings` and normalizes; `write` invokes `write_settings` with the settings. `browserSettings` round-trips in-memory (for e2e).
- [ ] **Step 2:** Implement `models.ts` (+`normalizeSettings`), `ports.ts`, `tauriSettings` (invoke + normalize), `browserSettings` (in-memory/localStorage). Run tests → PASS.
- [ ] **Step 3:** Commit `feat(settings): domain model + tauri/browser settings adapters`.

---

### Task 3: Tailwind dark variant + ThemeProvider

**Files:** Modify `src/styles.css`, `src/app/App.tsx`; Create `src/app/theme/ThemeProvider.tsx` (+ test).

**Interfaces produced:** `ThemeProvider` (React context) + `useTheme() → { theme: Theme; setTheme(t: Theme): void; resolved: "light"|"dark" }`.

- [ ] **Step 1:** In `styles.css` add `@custom-variant dark (&:where(.dark, .dark *));` and fix the `:root` so background/text are the LIGHT theme by default (light surface, dark text) with a `.dark` override for root bg/text.
- [ ] **Step 2:** Write failing `ThemeProvider.test.tsx`: rendering with a mock `SettingsRepository` returning `dark` adds `document.documentElement.classList` `dark`; `light` removes it; `system` follows a mocked `matchMedia("(prefers-color-scheme: dark)")`; `setTheme` persists via the repository and updates the class. (Mock `matchMedia` + repository.)
- [ ] **Step 3:** Implement `ThemeProvider`: load settings on mount (repo.read), hold `theme`; compute `resolved` (system → matchMedia, else theme); apply/remove `.dark` on `document.documentElement`; subscribe to matchMedia change while `system`; `setTheme` updates state + `repo.write`. Provide the repo via a prop/dependency (tauri in app, browser in tests/e2e). Wrap the app in `App.tsx`. Run tests → PASS.
- [ ] **Step 4:** Commit `feat(theme): Tailwind dark variant + ThemeProvider`.

---

### Task 4: Dark-mode variants across the UI

**Files:** Modify component files under `src/app`, `src/features`, `src/shared/ui` that use hardcoded light colors (~84 usages); `src/styles.css` (BlockNote dark).

**Interfaces:** none (styling only).

- [ ] **Step 1 (shell/workspace):** Add `dark:` variants to color classes in `src/app/layout/*`, `src/features/workspace/*`, `src/app/workspace/*` (e.g. `bg-white → dark:bg-stone-900`, `bg-stone-100 → dark:bg-stone-800`, `text-stone-800 → dark:text-stone-100`, `text-stone-600 → dark:text-stone-300`, `border-stone-200 → dark:border-stone-700`, hover states likewise). Verify contrast. Run `pnpm build`/manual dark check.
- [ ] **Step 2 (canvas/components/dialogs):** Same for `src/features/plan/**` (PlanCanvas, ComponentFrame, ReferenceComponentView, GroupImageGrid, SortableImageTile, SaveStatus, InsertComponentMenu, RichTextEditor wrapper) and `src/shared/ui/ConfirmDialog`, plus the plan top bar. Ensure captions/inputs/textareas get `dark:bg-*`/`dark:text-*`/`dark:border-*` with contrast.
- [ ] **Step 3 (BlockNote):** In `styles.css`, add `html.dark .bn-wrap .bn-editor { background:#1c1917; color:#e7e5e4; border-color: rgba(255,255,255,0.12); }` and pass `BlockNoteView` `theme={resolved}` (thread `resolved` from `useTheme` into `RichTextEditor`).
- [ ] **Step 4:** Manual dark-mode pass for contrast; `pnpm typecheck`, `lint`, `test` green. Commit `feat(theme): dark-mode variants across the app + BlockNote`.

---

### Task 5: Settings button + panel

**Files:** Create `src/features/settings/SettingsButton.tsx`, `src/features/settings/SettingsPanel.tsx` (+ tests); Modify the app top bar (`ProjectCanvasProvider` header and/or `AppShell`), `src/shared/i18n/locales/zh.ts`.

**Interfaces:** `SettingsPanel({ open, onClose })` renders a theme segmented control bound to `useTheme`; `SettingsButton` opens it.

- [ ] **Step 1:** Write failing tests: `SettingsButton` (gear, i18n `settings.open`) opens the panel; `SettingsPanel` renders three options (`浅色`/`深色`/`跟随系统` via `settings.themeLight/themeDark/themeSystem`), highlights the current theme, and calls `setTheme` on selection; Escape/backdrop closes.
- [ ] **Step 2:** Implement `SettingsButton` (gear icon button) + `SettingsPanel` (reuse the `ConfirmDialog`/modal pattern; a `role="dialog"` with a segmented control). Add i18n keys `settings.open`="设置", `settings.title`="设置", `settings.theme`="主题", `settings.themeLight`="浅色", `settings.themeDark`="深色", `settings.themeSystem`="跟随系统". Place `SettingsButton` in the top bar. Run tests → PASS.
- [ ] **Step 3:** Commit `feat(settings): in-app settings panel with theme selector`.

---

### Task 6: e2e + full matrix

**Files:** Modify `e2e/`, `docs/design_docs/featurelist.json`.

- [ ] **Step 1:** e2e (memory settings adapter): open Settings via the gear, select 深色, assert `document.documentElement` has class `dark` and a dark surface color is applied; select 浅色 → class removed. (Persistence across reload can be asserted if the memory adapter persists; otherwise assert the class toggle.)
- [ ] **Step 2:** Update `featurelist.json` (theming + settings entry, `lastVerified`); validate JSON.
- [ ] **Step 3:** Full matrix: `pnpm typecheck`, `lint`, `test`, `test:e2e`, `cargo test --manifest-path src-tauri\Cargo.toml`, `pnpm build`. Commit `test(theme): e2e + featurelist for theming`.

## Self-Review

- Spec coverage: Rust settings (T1) ✓; domain/adapters (T2) ✓; dark variant + ThemeProvider (T3) ✓; dark variants + BlockNote (T4) ✓; settings panel/gear (T5) ✓; e2e/featurelist (T6) ✓.
- Green-at-every-task: T1–T3 additive; T4 is styling-only (light unchanged, dark added); T5 additive UI; T6 validation.
- Types consistent: `Theme`, `AppSettings`, `normalizeSettings`, `SettingsRepository`, `useTheme().resolved` used across tasks.
