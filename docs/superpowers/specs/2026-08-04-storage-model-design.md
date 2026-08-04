# Project Storage Model (`.preshotproj` + `~/.preshot`) — Design

PRD sub-project 3. Converges project files on a `.preshotproj` manifest, adds a
global `~/.preshot/` home (config + default `projects/`), a Chinese directory
picker, and name-collision suffixes — auto-migrating existing `.preshot`
projects.

## Goal

Creating a project prompts (in Chinese) for a parent directory, defaulting to
`~/.preshot/projects/`, and writes the project as a folder containing a
`.preshotproj` manifest (project metadata + the embedded canvas plan JSON) plus
`references/` images. Duplicate names in the same parent get ` (2)`, ` (3)`
suffixes. Opening a legacy `.preshot` project auto-migrates it to `.preshotproj`.

## Decisions (from brainstorming)

- **Per-project file:** `.preshotproj` = today's `.preshot` manifest, renamed
  (same JSON: project metadata + embedded plan). Project stays a folder with
  `.preshotproj` + `references/`.
- **Global home:** `~/.preshot/` holds `settings.json` (theming) and the default
  `projects/` directory. The app creates `~/.preshot` (and `~/.preshot/projects`)
  on demand.
- **Create flow:** a native folder picker (Chinese prompt/labels) defaults to
  `~/.preshot/projects/`; the user may pick any parent.
- **Name collisions:** if `<parent>/<name>` exists, use `<name> (2)`, `(3)`, …
  (first free suffix).
- **Migration:** opening/inspecting a folder that has `.preshot` but no
  `.preshotproj` rewrites it to `.preshotproj` (atomic), leaving the old file
  removed. New projects only write `.preshotproj`.

## Architecture & Data Flow

Rust owns the filesystem/format; TS keeps the opaque plan JSON. The change is a
filename + default-location + naming + migration layer over the existing
`workspace.rs`.

### Rust (`src-tauri/src/workspace.rs`)

- `const MANIFEST_FILE_NAME = ".preshotproj"` (was `.preshot`); keep
  `LEGACY_MANIFEST_FILE_NAME = ".preshot"`.
- `read_manifest(project_path)`: read `.preshotproj`; if absent but `.preshot`
  exists, read it, **migrate** (write `.preshotproj` atomically, delete
  `.preshot`), and return it. Missing both → the existing "manifest_missing"
  error.
- `create_project_in(parent, name)`: after `validate_project_name`, resolve the
  first free `dedupe_project_name(parent, name)` (`name`, `name (2)`, …) — a pure,
  unit-tested helper — then create `<parent>/<resolved>/` + `.preshotproj` +
  `references/`.
- `default_projects_dir() -> PathBuf` = `~/.preshot/projects` (created if
  missing); a `#[tauri::command] default_projects_dir()` returns it for the
  picker default. Pure `dedupe_project_name` + `default_projects_dir` helpers
  with unit tests.
- `inspect_project_directory` uses the migrating `read_manifest` (so recent
  legacy projects migrate on open).

### Infrastructure / picker

- The new-project folder dialog opens at `default_projects_dir()` with Chinese
  title/labels (`workspaceDialog.ts` / the Rust dialog), instead of an arbitrary
  default.
- Recent-projects entries already store the project folder path — unchanged;
  they resolve via the migrating `read_manifest`.

### Domain / TS

- No plan-shape change (the plan JSON is unchanged; only its container file is
  renamed). The `ProjectManifest`/inspect types are unchanged apart from the
  filename constant.
- Where the frontend references `.preshot` (e.g. copy/labels/save-targets),
  update to `.preshotproj`; keep reading legacy via the Rust migration.

## Error Handling

- Migration is atomic (temp + rename; delete legacy only after the new file is
  committed); a failure leaves `.preshot` intact and surfaces the existing
  manifest error. `dedupe_project_name` never collides (scans until free, capped
  to avoid infinite loops on pathological dirs). Creating `~/.preshot/projects`
  failures surface an actionable error.

## Testing

- **Rust:** `dedupe_project_name` (no collision → name; one/two collisions →
  `(2)`/`(3)`); `read_manifest` migrates a `.preshot`-only folder to
  `.preshotproj` (and removes the legacy file) and reads a `.preshotproj` folder
  directly; `create_project_in` writes `.preshotproj` + `references/` and
  dedupes; `default_projects_dir` path shape.
- **TS:** adapters/labels reference `.preshotproj`; recent-project open of a
  migrated folder works (mocked commands).
- **E2E:** create a project (memory adapter) → it opens; existing workspace/
  recent flows stay green.

## Documented Limitations

- One-way migration (`.preshot` → `.preshotproj`); no downgrade. The plan JSON
  stays embedded in `.preshotproj` (not split into a separate file this phase).
