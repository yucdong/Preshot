# Theming (Dark/Light) + Settings Panel — Design

PRD sub-project 2 (of the `requirement_prd_0804.md` decomposition). Adds a
light/dark/system theme with a consistent, high-contrast palette and an in-app
Settings panel, persisted to `~/.preshot/settings.json`.

## Goal

A user can switch between **Light**, **Dark**, and **System** themes from an
in-app Settings panel (opened by a gear button in the top bar). The choice
persists across launches in `~/.preshot/settings.json`. All UI — the workspace
shell, canvas, components, dialogs, and the BlockNote editors — respects the
theme with sufficient text/background contrast.

## Decisions (from brainstorming)

- **Entry point:** an in-app gear/"设置" button in the app top bar opens a
  Settings modal (not a native OS menu). Theme selection lives there.
- **Modes:** Light, Dark, System; **default = System** (follow OS) on first run.
  Light = light-gray surfaces / dark text; Dark = near-black surfaces / light
  text, both meeting WCAG-AA contrast.
- **Persistence:** `~/.preshot/settings.json` via a small Rust settings command
  (creates `~/.preshot` if missing — the app owns `~/.preshot` creation).
- **Mechanism:** Tailwind v4 `dark:` variant with a **class strategy** (`.dark`
  on `<html>`); a `ThemeProvider` resolves System→OS via `matchMedia` and toggles
  the class. BlockNote (Mantine) gets a dark theme too.

## Architecture & Data Flow

```
Settings (Rust ~/.preshot/settings.json) <-> settingsService (infra) <-> ThemeProvider (React context)
ThemeProvider: resolve theme (light|dark|system→matchMedia) -> toggle <html class="dark"> -> Tailwind dark: variants
```

### Rust settings command (`src-tauri/src/settings.rs`)

- `#[tauri::command] read_settings() -> Result<serde_json::Value, CommandError>` —
  reads `~/.preshot/settings.json` (creating `~/.preshot` + returning `{}` when
  absent); opaque JSON (schema lives in TS, mirroring the plan-field pattern).
- `#[tauri::command] write_settings(value: serde_json::Value) -> Result<(), CommandError>` —
  atomic write (temp + rename), creating `~/.preshot` if missing.
- Register in `lib.rs`; a pure `settings_dir()`/`settings_path()` helper +
  unit test. No capability needed (app command).

### Tailwind v4 dark mode (`src/styles.css`)

- Add `@custom-variant dark (&:where(.dark, .dark *));` so `dark:` responds to a
  `.dark` class rather than only `prefers-color-scheme`.
- Define the palette as semantic surfaces where it reduces churn, but the
  pragmatic path is adding `dark:` variants to the existing ~84 color usages
  (e.g. `bg-white → bg-white dark:bg-stone-900`, `text-stone-800 → … dark:text-stone-100`,
  `border-stone-200 → … dark:border-stone-700`, `bg-stone-100 → … dark:bg-stone-800`).
  Fix the current `:root { color:#1c1917; background:#0c0a09 }` inconsistency so
  the root bg/text follow the theme.
- BlockNote: theme `.bn-editor` for dark (`html.dark .bn-wrap .bn-editor { background:#1c1917; color:#e7e5e4; border-color:rgba(255,255,255,0.12) }`) and pass BlockNoteView `theme` = resolved light/dark.

### Domain / infrastructure

- `src/domain/settings/models.ts` — `AppSettings = { theme: "light" | "dark" | "system" }`,
  `DEFAULT_SETTINGS`, a pure `normalizeSettings(raw): AppSettings` (total, defaults
  to system, ignores unknown).
- `src/domain/settings/ports.ts` — `SettingsRepository { read(): Promise<AppSettings>; write(s: AppSettings): Promise<void> }`.
- `src/infrastructure/settings/tauriSettings.ts` (invokes the commands + normalize)
  and `browserSettings.ts` (in-memory/localStorage for e2e).

### React (`src/app/theme/ThemeProvider.tsx`, `src/features/settings/`)

- `ThemeProvider` — loads settings on mount, holds `theme` + `resolvedMode`
  (light|dark), subscribes to `matchMedia("(prefers-color-scheme: dark)")` when
  `theme === "system"`, applies/removes `document.documentElement.classList` `dark`,
  and persists on change via the repository. Exposes `useTheme() → { theme, setTheme }`.
- `SettingsButton` (gear, i18n `settings.open`) in the top bar (`ProjectCanvasProvider`
  header / `AppShell`) opens `SettingsPanel` (reuse the `ConfirmDialog` modal
  pattern / a shared `Modal`), which renders a theme segmented control
  (浅色 / 深色 / 跟随系统) bound to `useTheme`.

## Error Handling

- `read_settings` on a missing/corrupt file → default settings (never throws to
  the UI); a write failure logs + shows the generic banner but never blocks the
  app. Theme application is best-effort (class toggle can't fail).

## Testing

- **Rust:** `settings_path` helper; read returns default on absent file; write
  then read round-trips; atomic write.
- **Domain:** `normalizeSettings` (valid, missing, unknown, wrong types → system).
- **Component:** `ThemeProvider` applies `.dark` for dark / removes for light /
  follows `matchMedia` for system (mock matchMedia); `SettingsPanel` renders the
  three options and calls `setTheme`; `SettingsButton` opens the panel.
- **Contrast:** a smoke test asserting key surfaces carry `dark:` variants (lint
  or a snapshot of representative components), plus manual dark-mode review.
- **E2E:** open Settings, switch to 深色, assert `<html class="dark">`, reload,
  assert it persisted (memory settings adapter).

## Documented Limitations

- Only Light/Dark/System (no custom accent colors). BlockNote dark relies on
  overriding Mantine CSS (kept minimal).
