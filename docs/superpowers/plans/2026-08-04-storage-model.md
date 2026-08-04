# Project Storage Model (`.preshotproj` + `~/.preshot`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Converge project files on a `.preshotproj` manifest (auto-migrating legacy `.preshot`), default new projects to `~/.preshot/projects/` via a Chinese folder picker, and dedupe duplicate names with ` (2)`/`(3)` suffixes.

**Architecture:** The change lives almost entirely in Rust `workspace.rs` (a filename constant + a migrating reader + naming/default-dir helpers) plus a picker-default + a couple of frontend label/constant updates. The plan JSON embedded in the manifest is unchanged.

**Tech Stack:** Tauri 2 (Rust), React 19 + TS, Vitest, Playwright.

## Global Constraints

- Project = a folder containing a `.preshotproj` manifest file + `references/`. `.preshotproj` is today's `.preshot` manifest JSON, renamed (project metadata + embedded plan) — no plan-shape change.
- Legacy migration is ONE-WAY (`.preshot` → `.preshotproj`), atomic (temp + rename; delete legacy only after the new file commits).
- Default new-project location: `~/.preshot/projects/` (created on demand); the user may pick any parent.
- Name collisions in the same parent → first free ` (2)`, ` (3)`, … suffix.
- Rust changes keep `cargo test` green; TS changes keep the suite green. Chinese-only UI text. Commit trailer: `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

## File Structure

- `src-tauri/src/workspace.rs` — `MANIFEST_FILE_NAME = ".preshotproj"` + `LEGACY_MANIFEST_FILE_NAME = ".preshot"`; migrating `read_manifest`; `dedupe_project_name`; `default_projects_dir` (+ command); `create_project_in` dedup. + Rust tests.
- `src-tauri/src/lib.rs` — register `default_projects_dir` command.
- `src/infrastructure/workspace/workspaceDialog.ts` (+ adapters) — open the new-project folder dialog at `default_projects_dir` with Chinese labels.
- Any TS/UI string referencing `.preshot` as the project file → `.preshotproj`.
- `docs/design_docs/featurelist.json`.

---

### Task 1: Rust — `.preshotproj` filename + legacy `.preshot` migration

**Files:** Modify `src-tauri/src/workspace.rs`.

**Interfaces produced:** `read_manifest(project_path)` reads `.preshotproj`; if absent but `.preshot` exists, migrates (writes `.preshotproj` atomically, removes `.preshot`) and returns it; both absent → the existing `manifest_missing` error.

- [ ] **Step 1:** Write failing Rust tests: (a) a folder with only a legacy `.preshot` → `read_manifest` returns its manifest AND afterward `.preshotproj` exists and `.preshot` is gone; (b) a folder with a `.preshotproj` reads directly; (c) neither present → `manifest_missing`. Use temp dirs + the existing manifest writer. `cargo test --manifest-path src-tauri\Cargo.toml` → FAIL.
- [ ] **Step 2:** Implement: `const MANIFEST_FILE_NAME = ".preshotproj";` `const LEGACY_MANIFEST_FILE_NAME = ".preshot";`. In `read_manifest`: if `<path>/.preshotproj` exists → read/validate as today; else if `<path>/.preshot` exists → read/validate it, then `write_manifest_atomically(path, &manifest)` (writes `.preshotproj`) and `fs::remove_file(<path>/.preshot)` (ignore a remove error but keep the migration), return the manifest; else the `manifest_missing` error. `write_manifest_atomically` already targets `MANIFEST_FILE_NAME` (now `.preshotproj`). Keep `create_project_in`/`inspect_project_directory` calling the (now-migrating) `read_manifest`. Run → PASS.
- [ ] **Step 3:** Commit `feat(workspace): use .preshotproj manifest with one-way .preshot migration`.

---

### Task 2: Rust — name dedupe + default projects dir

**Files:** Modify `src-tauri/src/workspace.rs`, `src-tauri/src/lib.rs`.

**Interfaces produced:** pure `dedupe_project_name(parent: &Path, name: &str) -> String` (first free of `name`, `name (2)`, `name (3)`, …); `default_projects_dir() -> Result<PathBuf, CommandError>` (= `~/.preshot/projects`, created if missing) + `#[tauri::command] default_projects_dir() -> Result<String, CommandError>`.

- [ ] **Step 1:** Write failing Rust tests: `dedupe_project_name` in a temp parent → `name` when free; when `<parent>/name` exists → `name (2)`; when `name` and `name (2)` exist → `name (3)`; `default_projects_dir` ends with `.preshot/projects` and the dir exists after the call. `cargo test` → FAIL.
- [ ] **Step 2:** Implement `dedupe_project_name` (pure: try `name`, then `format!("{name} ({n})")` for n=2.. until `<parent>/<candidate>` doesn't exist, capped at e.g. 999). In `create_project_in(parent, name)`: after `validate_project_name`, `let resolved = dedupe_project_name(parent, name);` and create `<parent>/<resolved>/`. Add `default_projects_dir()` (home `.preshot/projects`, `create_dir_all`) + the `#[tauri::command]` returning its string path; register in `lib.rs`. Run → PASS.
- [ ] **Step 3:** Commit `feat(workspace): dedupe project names and default to ~/.preshot/projects`.

---

### Task 3: Frontend — picker default + `.preshotproj` labels

**Files:** Modify `src/infrastructure/workspace/workspaceDialog.ts` (+ its test), and any TS/UI referencing the `.preshot` project file (grep `\.preshot\b` under `src`, excluding the settings path). 

**Interfaces:** the new-project parent-folder dialog opens at `default_projects_dir()` (invoke the command) with Chinese title/labels.

- [ ] **Step 1:** Write/adjust failing tests: `workspaceDialog` opens the folder dialog with `defaultPath` = the `default_projects_dir` command result (mock invoke), and Chinese labels; any adapter/UI string that said `.preshot` (as the project file) now says `.preshotproj`.
- [ ] **Step 2:** Implement: in the new-project flow, call `invoke("default_projects_dir")` and pass it as the dialog `defaultPath` (fallback to no default if it errors); ensure the dialog title/labels are Chinese i18n. Update `.preshot`→`.preshotproj` references (NOT the `~/.preshot` home folder or `settings.json` path — only the per-project manifest filename references). Run → PASS.
- [ ] **Step 3:** Commit `feat(workspace): default new-project picker to ~/.preshot/projects (zh)`.

---

### Task 4: e2e, featurelist, full matrix

**Files:** `e2e/` (extend), `docs/design_docs/featurelist.json`.

- [ ] **Step 1:** Extend/confirm e2e (memory adapter): creating a project still opens it; the recent-projects/workspace flows stay green. (Filesystem migration is Rust-tested; e2e uses the memory adapter, so assert the create/open flow, not the on-disk file.)
- [ ] **Step 2:** Update `featurelist.json` (storage-model entry: `.preshotproj` + `~/.preshot/projects` default + naming dedupe + migration; `lastVerified`); validate JSON.
- [ ] **Step 3:** Full matrix: `pnpm typecheck`, `lint`, `test`, `test:e2e`, `cargo test --manifest-path src-tauri\Cargo.toml`, `pnpm build`. Commit `test(workspace): featurelist + matrix for storage model`.

## Self-Review

- Spec coverage: `.preshotproj` + migration (T1) ✓; dedupe + default dir (T2) ✓; picker default + labels (T3) ✓; e2e/featurelist (T4) ✓.
- Green-at-every-task: T1/T2 are Rust-additive (new consts/helpers, migrating reader); T3 updates the picker + string constants; T4 validates.
- Types/names consistent: `MANIFEST_FILE_NAME`/`LEGACY_MANIFEST_FILE_NAME`, `dedupe_project_name`, `default_projects_dir` used across tasks.
