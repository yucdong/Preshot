use std::{
    collections::HashMap,
    fs,
    io::ErrorKind,
    path::{Component, Path, PathBuf},
    sync::{Mutex, MutexGuard},
    thread,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::{SecondsFormat, Utc};
use uuid::Uuid;

use crate::error::CommandError;

const MANIFEST_FILE_NAME: &str = ".preshotproj";
const LEGACY_MANIFEST_FILE_NAME: &str = ".preshot";
const MANIFEST_TEMP_FILE_NAME: &str = ".preshotproj.tmp";
const STARTER_PROJECT_NAME: &str = "Preshot 入门示例";
const STARTER_CONTENTION_ATTEMPTS: usize = 100;
const STARTER_CONTENTION_DELAY: Duration = Duration::from_millis(10);
const MAX_COVER_BYTES: u64 = 16 * 1024 * 1024;
const PENDING_ROLLBACK_TTL: Duration = Duration::from_secs(60);
const RESERVED_WINDOWS_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

#[derive(Debug, Clone, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, deserialize_with = "deserialize_cover_image")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectedProject {
    pub path: String,
    pub manifest: ProjectManifest,
    pub resolved_cover_image: Option<String>,
    pub cover_data_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedProject {
    pub project: InspectedProject,
    pub rollback_token: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredProjectIdentity {
    pub project_id: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserDataRoots {
    pub user_root: String,
    pub projects_root: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserDataBootstrapResult {
    pub roots: UserDataRoots,
    pub project: Option<InspectedProject>,
    pub rollback_token: Option<String>,
}

#[derive(Debug)]
struct StarterProject {
    project: InspectedProject,
    created: bool,
}

#[derive(Debug, Clone)]
struct ResolvedCover {
    absolute_path: PathBuf,
    relative_path: String,
    mime: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PendingProjectRollback {
    project_path: PathBuf,
    project_id: String,
    manifest_bytes: Vec<u8>,
    created_at: Instant,
}

#[derive(Debug, Default)]
pub struct PendingProjectRollbacks {
    entries: Mutex<HashMap<String, PendingProjectRollback>>,
}

impl PendingProjectRollbacks {
    fn register(
        &self,
        project_path: PathBuf,
        project_id: String,
        manifest_bytes: Vec<u8>,
    ) -> String {
        self.register_with_instant(project_path, project_id, manifest_bytes, Instant::now())
    }

    fn register_with_instant(
        &self,
        project_path: PathBuf,
        project_id: String,
        manifest_bytes: Vec<u8>,
        created_at: Instant,
    ) -> String {
        let token = Uuid::new_v4().to_string();
        let mut entries = self.lock_entries();
        purge_expired_rollbacks(&mut entries, Instant::now());
        entries.insert(
            token.clone(),
            PendingProjectRollback {
                project_path,
                project_id,
                manifest_bytes,
                created_at,
            },
        );
        token
    }

    fn take(&self, rollback_token: &str) -> Result<PendingProjectRollback, CommandError> {
        let mut entries = self.lock_entries();
        purge_expired_rollbacks(&mut entries, Instant::now());
        entries
            .remove(rollback_token)
            .ok_or_else(rollback_not_authorized)
    }

    fn forget(&self, rollback_token: &str) -> Result<(), CommandError> {
        let mut entries = self.lock_entries();
        purge_expired_rollbacks(&mut entries, Instant::now());
        entries
            .remove(rollback_token)
            .map(|_| ())
            .ok_or_else(rollback_not_authorized)
    }

    fn lock_entries(&self) -> MutexGuard<'_, HashMap<String, PendingProjectRollback>> {
        match self.entries.lock() {
            Ok(entries) => entries,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

fn deserialize_cover_image<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct CoverImageVisitor;

    impl<'de> serde::de::Visitor<'de> for CoverImageVisitor {
        type Value = Option<String>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("an optional string cover image path")
        }

        fn visit_some<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
        where
            D: serde::Deserializer<'de>,
        {
            Ok(Some(<String as serde::Deserialize>::deserialize(
                deserializer,
            )?))
        }

        fn visit_none<E>(self) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            Err(E::custom(
                "invalid type: null, expected an optional string cover image path",
            ))
        }

        fn visit_unit<E>(self) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            Err(E::custom(
                "invalid type: null, expected an optional string cover image path",
            ))
        }
    }

    deserializer.deserialize_option(CoverImageVisitor)
}

fn validate_project_name(name: &str) -> Result<(), CommandError> {
    let trimmed = name.trim();
    let stem = trimmed
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    let has_invalid_character = name.chars().any(|character| {
        matches!(
            character,
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
        )
    });

    if trimmed.is_empty()
        || trimmed != name
        || name.ends_with(['.', ' '])
        || has_invalid_character
        || RESERVED_WINDOWS_NAMES.contains(&stem.as_str())
    {
        return Err(CommandError::new(
            "invalid_project_name",
            "Project name is not valid on Windows",
        ));
    }

    Ok(())
}

pub fn create_project_in(parent: &Path, name: &str) -> Result<InspectedProject, CommandError> {
    create_project_in_with_manifest_writer(parent, name, &write_manifest_atomically)
}

/// Returns the first non-colliding project folder name in `parent`.
/// Tries `name`, then `name (2)`, `name (3)`, … up to a safety cap; on the
/// (pathological) chance every candidate is taken, falls back to a UUID suffix
/// so the result is always free.
pub(crate) fn dedupe_project_name(parent: &Path, name: &str) -> String {
    if !parent.join(name).exists() {
        return name.to_string();
    }

    for suffix in 2..=999 {
        let candidate = format!("{name} ({suffix})");
        if !parent.join(&candidate).exists() {
            return candidate;
        }
    }

    format!("{name} ({})", Uuid::new_v4())
}

/// Resolves the `~/.preshot` home directory for the current OS.
pub(crate) fn preshot_home() -> Result<PathBuf, CommandError> {
    #[cfg(windows)]
    let home_var = "USERPROFILE";
    #[cfg(not(windows))]
    let home_var = "HOME";

    let home = std::env::var(home_var).map_err(|_| {
        CommandError::new(
            "home_unresolved",
            format!("Unable to resolve home directory (missing {home_var})"),
        )
    })?;

    Ok(PathBuf::from(home).join(".preshot"))
}

/// Returns `<home>/projects`, creating it (and any missing parents) if absent.
fn default_projects_path_in(home: &Path) -> Result<PathBuf, CommandError> {
    let dir = home.join("projects");
    fs::create_dir_all(&dir).map_err(|error| {
        CommandError::new(
            "projects_dir_create_failed",
            format!("Unable to create the default projects directory: {error}"),
        )
    })?;
    Ok(dir)
}

fn ensure_user_data_roots_in(user_root: &Path) -> Result<UserDataRoots, CommandError> {
    fs::create_dir_all(user_root).map_err(|error| {
        CommandError::new(
            "user_root_create_failed",
            format!("Unable to create the Preshot user data directory: {error}"),
        )
    })?;
    let projects_root = default_projects_path_in(user_root)?;
    let user_root = user_root.canonicalize().map_err(|error| {
        CommandError::new(
            "user_root_access_failed",
            format!("Unable to access the Preshot user data directory: {error}"),
        )
    })?;
    let projects_root = projects_root.canonicalize().map_err(|error| {
        CommandError::new(
            "projects_root_access_failed",
            format!("Unable to access the Preshot projects directory: {error}"),
        )
    })?;
    Ok(UserDataRoots {
        user_root: path_to_string(&user_root),
        projects_root: path_to_string(&projects_root),
    })
}

pub(crate) fn ensure_user_data_roots_for_current_user() -> Result<UserDataRoots, CommandError> {
    ensure_user_data_roots_in(&preshot_home()?)
}

/// Returns `~/.preshot/projects`, creating it if missing.
fn default_projects_path() -> Result<PathBuf, CommandError> {
    default_projects_path_in(&preshot_home()?)
}

fn starter_project_plan() -> serde_json::Value {
    let intro = [
        "欢迎使用 Preshot。这是一份可以直接编辑的入门拍摄方案。",
        "在这里写下拍摄目标、镜头清单、时间安排和现场提醒。",
        "你可以修改或删除这些文字，也可以继续添加图片、表格和更多内容。",
    ];
    let blocks = intro
        .into_iter()
        .map(|text| {
            serde_json::json!({
                "id": Uuid::new_v4().to_string(),
                "type": "paragraph",
                "props": {},
                "content": [{
                    "type": "text",
                    "text": text,
                    "styles": {}
                }],
                "children": []
            })
        })
        .collect::<Vec<_>>();

    serde_json::json!({
        "schemaVersion": 14,
        "title": STARTER_PROJECT_NAME,
        "document": {
            "format": "preshot-blocks",
            "version": 2,
            "blocks": blocks
        },
        "imageGroups": []
    })
}

fn create_starter_project_in(projects_root: &Path) -> Result<StarterProject, CommandError> {
    create_starter_project_in_with_manifest_writer(projects_root, &write_manifest_atomically)
}

fn create_starter_project_in_with_manifest_writer<F>(
    projects_root: &Path,
    manifest_writer: &F,
) -> Result<StarterProject, CommandError>
where
    F: Fn(&Path, &ProjectManifest) -> Result<(), CommandError>,
{
    let projects_root = canonicalize_directory(
        projects_root,
        "projects_root_not_found",
        "projects_root_not_directory",
    )?;
    let project_path = projects_root.join(STARTER_PROJECT_NAME);

    match fs::create_dir(&project_path) {
        Ok(()) => {
            let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
            let manifest = ProjectManifest {
                schema_version: 1,
                id: Uuid::new_v4().to_string(),
                name: STARTER_PROJECT_NAME.to_string(),
                created_at: now.clone(),
                updated_at: now,
                cover_image: None,
                plan: Some(starter_project_plan()),
            };
            if let Err(error) = manifest_writer(&project_path, &manifest) {
                remove_dir_if_empty(&project_path);
                return Err(error);
            }
            Ok(StarterProject {
                project: inspect_project_directory(&project_path)?,
                created: true,
            })
        }
        Err(error) if error.kind() == ErrorKind::AlreadyExists => {
            for _ in 0..STARTER_CONTENTION_ATTEMPTS {
                if let Ok(project) = inspect_project_directory(&project_path) {
                    return Ok(StarterProject {
                        project,
                        created: false,
                    });
                }
                thread::sleep(STARTER_CONTENTION_DELAY);
            }
            Err(CommandError::new(
                "starter_project_conflict",
                format!(
                    "The starter project path already exists but is not a valid Preshot project: {}",
                    path_to_string(&project_path)
                ),
            ))
        }
        Err(error) => Err(CommandError::new(
            "starter_directory_create_failed",
            format!("Unable to create the starter project directory: {error}"),
        )),
    }
}

fn discover_valid_project(projects_root: &Path) -> Result<Option<InspectedProject>, CommandError> {
    let mut paths = fs::read_dir(projects_root)
        .map_err(|error| {
            CommandError::new(
                "projects_root_read_failed",
                format!("Unable to enumerate the default projects directory: {error}"),
            )
        })?
        .map(|entry| {
            entry.map(|entry| entry.path()).map_err(|error| {
                CommandError::new(
                    "projects_root_read_failed",
                    format!("Unable to enumerate the default projects directory: {error}"),
                )
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    paths.sort();

    for path in paths {
        if path.is_dir() {
            if let Ok(project) = inspect_project_directory(&path) {
                return Ok(Some(project));
            }
        }
    }
    Ok(None)
}

fn has_available_registered_project(registered_projects: &[RegisteredProjectIdentity]) -> bool {
    registered_projects.iter().any(|registered| {
        inspect_project_directory(Path::new(&registered.path))
            .map(|project| project.manifest.id == registered.project_id)
            .unwrap_or(false)
    })
}

fn bootstrap_user_data_in(
    user_root: &Path,
    registered_projects: &[RegisteredProjectIdentity],
    pending_rollbacks: &PendingProjectRollbacks,
) -> Result<UserDataBootstrapResult, CommandError> {
    let roots = ensure_user_data_roots_in(user_root)?;
    if has_available_registered_project(registered_projects) {
        return Ok(UserDataBootstrapResult {
            roots,
            project: None,
            rollback_token: None,
        });
    }

    let projects_root = PathBuf::from(&roots.projects_root);
    if let Some(project) = discover_valid_project(&projects_root)? {
        return Ok(UserDataBootstrapResult {
            roots,
            project: Some(project),
            rollback_token: None,
        });
    }

    let starter = create_starter_project_in(&projects_root)?;
    let rollback_token = if starter.created {
        Some(pending_rollbacks.register(
            PathBuf::from(&starter.project.path),
            starter.project.manifest.id.clone(),
            encode_manifest(&starter.project.manifest)?,
        ))
    } else {
        None
    };
    Ok(UserDataBootstrapResult {
        roots,
        project: Some(starter.project),
        rollback_token,
    })
}

fn create_project_in_with_manifest_writer<F>(
    parent: &Path,
    name: &str,
    manifest_writer: &F,
) -> Result<InspectedProject, CommandError>
where
    F: Fn(&Path, &ProjectManifest) -> Result<(), CommandError>,
{
    validate_project_name(name)?;

    let parent = canonicalize_directory(parent, "parent_not_found", "parent_not_directory")?;
    let resolved = dedupe_project_name(&parent, name);
    let project = parent.join(&resolved);

    fs::create_dir(&project).map_err(|error| {
        CommandError::new(
            "create_directory_failed",
            format!("Unable to create project directory: {error}"),
        )
    })?;

    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let manifest = ProjectManifest {
        schema_version: 1,
        id: Uuid::new_v4().to_string(),
        name: name.to_string(),
        created_at: now.clone(),
        updated_at: now,
        cover_image: None,
        plan: None,
    };

    if let Err(error) = manifest_writer(&project, &manifest) {
        remove_dir_if_empty(&project);
        return Err(error);
    }

    inspect_project_directory(&project)
}

pub(crate) fn write_manifest_atomically(
    project: &Path,
    manifest: &ProjectManifest,
) -> Result<(), CommandError> {
    let temporary_path = project.join(MANIFEST_TEMP_FILE_NAME);
    let manifest_path = project.join(MANIFEST_FILE_NAME);
    let manifest_bytes = encode_manifest(manifest)?;

    if let Err(error) = fs::write(&temporary_path, manifest_bytes) {
        remove_file_if_exists(&temporary_path);
        return Err(CommandError::new(
            "manifest_write_failed",
            format!("Unable to write project manifest: {error}"),
        ));
    }

    if let Err(error) = fs::rename(&temporary_path, &manifest_path) {
        remove_file_if_exists(&temporary_path);
        return Err(CommandError::new(
            "manifest_commit_failed",
            format!("Unable to finalize project manifest: {error}"),
        ));
    }

    Ok(())
}

fn encode_manifest(manifest: &ProjectManifest) -> Result<Vec<u8>, CommandError> {
    serde_json::to_vec_pretty(manifest).map_err(|error| {
        CommandError::new(
            "manifest_encode_failed",
            format!("Unable to encode project manifest: {error}"),
        )
    })
}

pub(crate) fn read_manifest(project_path: &Path) -> Result<ProjectManifest, CommandError> {
    let manifest_path = project_path.join(MANIFEST_FILE_NAME);
    let legacy_manifest_path = project_path.join(LEGACY_MANIFEST_FILE_NAME);

    // Try to read the new .preshotproj file first
    match fs::metadata(&manifest_path) {
        Ok(metadata) => {
            if !metadata.is_file() {
                return Err(CommandError::new(
                    "manifest_not_file",
                    "The .preshotproj manifest must be a regular file",
                ));
            }
            let manifest_bytes = fs::read(&manifest_path).map_err(|error| {
                CommandError::new(
                    "manifest_read_failed",
                    format!("Unable to read the project manifest: {error}"),
                )
            })?;
            let manifest: ProjectManifest =
                serde_json::from_slice(&manifest_bytes).map_err(|error| {
                    CommandError::new(
                        "manifest_decode_failed",
                        format!("Unable to decode the project manifest: {error}"),
                    )
                })?;
            validate_manifest(&manifest)?;
            Ok(manifest)
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {
            // .preshotproj not found, try legacy .preshot
            match fs::metadata(&legacy_manifest_path) {
                Ok(metadata) => {
                    if !metadata.is_file() {
                        return Err(CommandError::new(
                            "manifest_not_file",
                            "The .preshot manifest must be a regular file",
                        ));
                    }
                    let manifest_bytes = fs::read(&legacy_manifest_path).map_err(|error| {
                        CommandError::new(
                            "manifest_read_failed",
                            format!("Unable to read the project manifest: {error}"),
                        )
                    })?;
                    let manifest: ProjectManifest = serde_json::from_slice(&manifest_bytes)
                        .map_err(|error| {
                            CommandError::new(
                                "manifest_decode_failed",
                                format!("Unable to decode the project manifest: {error}"),
                            )
                        })?;
                    validate_manifest(&manifest)?;

                    // Migrate: write the new .preshotproj and remove the old .preshot
                    write_manifest_atomically(project_path, &manifest)?;
                    // Ignore errors when removing the legacy file; the migration still succeeded
                    let _ = fs::remove_file(&legacy_manifest_path);

                    Ok(manifest)
                }
                Err(error) if error.kind() == ErrorKind::NotFound => {
                    // Neither file exists
                    Err(CommandError::new(
                        "manifest_missing",
                        "Preshot projects must contain a .preshotproj or .preshot manifest",
                    ))
                }
                Err(error) => Err(CommandError::new(
                    "manifest_read_failed",
                    format!("Unable to access the project manifest: {error}"),
                )),
            }
        }
        Err(error) => Err(CommandError::new(
            "manifest_read_failed",
            format!("Unable to access the project manifest: {error}"),
        )),
    }
}

pub fn inspect_project_directory(path: &Path) -> Result<InspectedProject, CommandError> {
    let project_path = canonicalize_directory(path, "project_not_found", "project_not_directory")?;
    let manifest = read_manifest(&project_path)?;

    let resolved_cover = resolve_cover_path(&project_path, &manifest)?;
    let cover_data_url = match &resolved_cover {
        Some(cover) => Some(encode_cover_data_url(cover)?),
        None => None,
    };

    Ok(InspectedProject {
        path: path_to_string(&project_path),
        manifest,
        resolved_cover_image: resolved_cover
            .as_ref()
            .map(|cover| cover.relative_path.clone()),
        cover_data_url,
    })
}

fn validate_manifest(manifest: &ProjectManifest) -> Result<(), CommandError> {
    if manifest.schema_version != 1 {
        return Err(CommandError::new(
            "manifest_schema_unsupported",
            format!(
                "Unsupported project manifest schema version: {}",
                manifest.schema_version
            ),
        ));
    }

    Uuid::parse_str(&manifest.id).map_err(|error| {
        CommandError::new(
            "manifest_invalid_id",
            format!("Project manifest ID is invalid: {error}"),
        )
    })?;
    validate_project_name(&manifest.name)?;

    chrono::DateTime::parse_from_rfc3339(&manifest.created_at).map_err(|error| {
        CommandError::new(
            "manifest_invalid_timestamp",
            format!("Project manifest createdAt is invalid: {error}"),
        )
    })?;
    chrono::DateTime::parse_from_rfc3339(&manifest.updated_at).map_err(|error| {
        CommandError::new(
            "manifest_invalid_timestamp",
            format!("Project manifest updatedAt is invalid: {error}"),
        )
    })?;

    Ok(())
}

fn resolve_cover_path(
    project_path: &Path,
    manifest: &ProjectManifest,
) -> Result<Option<ResolvedCover>, CommandError> {
    if let Some(explicit_cover) = manifest
        .cover_image
        .as_deref()
        .and_then(|cover_image| resolve_explicit_cover_path(project_path, cover_image))
    {
        return Ok(Some(explicit_cover));
    }

    resolve_root_cover_path(project_path)
}

fn resolve_explicit_cover_path(project_path: &Path, cover_image: &str) -> Option<ResolvedCover> {
    if cover_image.trim().is_empty() {
        return None;
    }

    let relative_path = Path::new(cover_image);
    if relative_path.is_absolute()
        || relative_path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return None;
    }

    let absolute_path = project_path.join(relative_path).canonicalize().ok()?;
    if !absolute_path.starts_with(project_path) {
        return None;
    }

    build_cover_candidate(project_path, absolute_path)
}

fn resolve_root_cover_path(project_path: &Path) -> Result<Option<ResolvedCover>, CommandError> {
    let entries = fs::read_dir(project_path).map_err(|error| {
        CommandError::new(
            "project_read_failed",
            format!("Unable to enumerate the project directory: {error}"),
        )
    })?;

    let mut candidates = Vec::new();
    for entry_result in entries {
        let entry = match entry_result {
            Ok(entry) => entry,
            Err(_) => continue,
        };

        let file_type = match entry.file_type() {
            Ok(file_type) if file_type.is_file() => file_type,
            _ => continue,
        };
        let _ = file_type;

        let file_name = entry.file_name().to_string_lossy().into_owned();
        let candidate = match build_cover_candidate(project_path, entry.path()) {
            Some(candidate) => candidate,
            None => continue,
        };

        candidates.push((file_name.to_ascii_lowercase(), file_name, candidate));
    }

    candidates.sort_by(|left, right| left.0.cmp(&right.0).then(left.1.cmp(&right.1)));

    Ok(candidates
        .into_iter()
        .map(|(_, _, candidate)| candidate)
        .next())
}

fn build_cover_candidate(project_path: &Path, absolute_path: PathBuf) -> Option<ResolvedCover> {
    let metadata = absolute_path.metadata().ok()?;
    if !metadata.is_file() || metadata.len() > MAX_COVER_BYTES {
        return None;
    }

    let mime = mime_for_path(&absolute_path)?;
    let canonical_path = absolute_path.canonicalize().ok()?;
    if !canonical_path.starts_with(project_path) {
        return None;
    }

    let relative_path = canonical_path.strip_prefix(project_path).ok()?;
    let relative_path = normalize_relative_path(relative_path)?;

    Some(ResolvedCover {
        absolute_path: canonical_path,
        relative_path,
        mime,
    })
}

fn encode_cover_data_url(cover: &ResolvedCover) -> Result<String, CommandError> {
    let metadata = fs::metadata(&cover.absolute_path).map_err(|error| {
        CommandError::new(
            "cover_read_failed",
            format!("Unable to access the selected cover image: {error}"),
        )
    })?;
    if metadata.len() > MAX_COVER_BYTES {
        return Err(CommandError::new(
            "cover_too_large",
            "The selected cover image exceeds the 16 MiB limit",
        ));
    }

    let cover_bytes = fs::read(&cover.absolute_path).map_err(|error| {
        CommandError::new(
            "cover_read_failed",
            format!("Unable to read the selected cover image: {error}"),
        )
    })?;

    Ok(format!(
        "data:{};base64,{}",
        cover.mime,
        STANDARD.encode(cover_bytes)
    ))
}

pub fn rollback_created_project_directory(
    path: &Path,
    project_id: &str,
    expected_manifest_bytes: &[u8],
) -> Result<(), CommandError> {
    rollback_created_project_directory_with_hooks(
        path,
        project_id,
        expected_manifest_bytes,
        &|_| {},
        &|_| {},
    )
}

fn rollback_created_project_directory_with_hooks<F, G>(
    path: &Path,
    project_id: &str,
    expected_manifest_bytes: &[u8],
    before_quarantine: &F,
    after_quarantine: &G,
) -> Result<(), CommandError>
where
    F: Fn(&Path),
    G: Fn(&Path),
{
    let project_path = canonicalize_directory(path, "project_not_found", "project_not_directory")?;
    let manifest_bytes = read_manifest_bytes(&project_path)?;
    ensure_manifest_matches_project_id(&manifest_bytes, project_id)?;
    ensure_manifest_is_unchanged(&manifest_bytes, expected_manifest_bytes)?;
    ensure_marker_only_directory(&project_path)?;
    before_quarantine(&project_path);

    let quarantine_path = unique_quarantine_path(&project_path);
    fs::rename(&project_path, &quarantine_path).map_err(|error| {
        CommandError::new(
            "rollback_quarantine_failed",
            format!("Unable to move the project directory into rollback quarantine: {error}"),
        )
    })?;

    after_quarantine(&quarantine_path);

    let mut manifest_bytes = None;
    let rollback_result = (|| {
        let bytes = read_manifest_bytes(&quarantine_path)?;
        ensure_manifest_matches_project_id(&bytes, project_id)?;
        ensure_manifest_is_unchanged(&bytes, expected_manifest_bytes)?;
        ensure_marker_only_directory(&quarantine_path)?;
        manifest_bytes = Some(bytes);

        fs::remove_file(quarantine_path.join(MANIFEST_FILE_NAME)).map_err(|error| {
            CommandError::new(
                "remove_manifest_failed",
                format!("Unable to remove the project manifest: {error}"),
            )
        })?;
        fs::remove_dir(&quarantine_path).map_err(|error| {
            CommandError::new(
                "remove_directory_failed",
                format!("Unable to remove the project directory: {error}"),
            )
        })
    })();

    match rollback_result {
        Ok(()) => Ok(()),
        Err(error) => restore_quarantined_project(
            &project_path,
            &quarantine_path,
            manifest_bytes.as_deref(),
            error,
        ),
    }
}

fn rollback_created_project_with_token(
    pending_rollbacks: &PendingProjectRollbacks,
    rollback_token: &str,
) -> Result<(), CommandError> {
    let pending = pending_rollbacks.take(rollback_token)?;
    rollback_created_project_directory(
        &pending.project_path,
        &pending.project_id,
        &pending.manifest_bytes,
    )
}

#[tauri::command]
pub fn create_project(
    pending_rollbacks: tauri::State<'_, PendingProjectRollbacks>,
    parent_path: String,
    name: String,
) -> Result<CreatedProject, CommandError> {
    let project = create_project_in(Path::new(&parent_path), &name)?;
    let rollback_token = pending_rollbacks.register(
        PathBuf::from(&project.path),
        project.manifest.id.clone(),
        encode_manifest(&project.manifest)?,
    );

    Ok(CreatedProject {
        project,
        rollback_token,
    })
}

#[tauri::command]
pub fn ensure_user_data_roots() -> Result<UserDataRoots, CommandError> {
    ensure_user_data_roots_for_current_user()
}

#[tauri::command]
pub fn bootstrap_user_data(
    pending_rollbacks: tauri::State<'_, PendingProjectRollbacks>,
    registered_projects: Vec<RegisteredProjectIdentity>,
) -> Result<UserDataBootstrapResult, CommandError> {
    bootstrap_user_data_in(&preshot_home()?, &registered_projects, &pending_rollbacks)
}

#[tauri::command]
pub fn inspect_project(path: String) -> Result<InspectedProject, CommandError> {
    inspect_project_directory(Path::new(&path))
}

#[tauri::command]
pub fn default_projects_dir() -> Result<String, CommandError> {
    Ok(default_projects_path()?.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn rollback_created_project(
    pending_rollbacks: tauri::State<'_, PendingProjectRollbacks>,
    rollback_token: String,
) -> Result<(), CommandError> {
    rollback_created_project_with_token(&pending_rollbacks, &rollback_token)
}

#[tauri::command]
pub fn forget_created_project(
    pending_rollbacks: tauri::State<'_, PendingProjectRollbacks>,
    rollback_token: String,
) -> Result<(), CommandError> {
    pending_rollbacks.forget(&rollback_token)
}

fn purge_expired_rollbacks(entries: &mut HashMap<String, PendingProjectRollback>, now: Instant) {
    entries.retain(|_, pending| {
        now.checked_duration_since(pending.created_at)
            .map(|age| age <= PENDING_ROLLBACK_TTL)
            .unwrap_or(true)
    });
}

fn rollback_not_authorized() -> CommandError {
    CommandError::new(
        "rollback_not_authorized",
        "Rollback is not authorized for this project",
    )
}

fn rollback_id_mismatch() -> CommandError {
    CommandError::new(
        "rollback_id_mismatch",
        "The project ID does not match the requested rollback target",
    )
}

fn rollback_manifest_changed() -> CommandError {
    CommandError::new(
        "rollback_manifest_changed",
        "The project manifest changed after rollback authorization was issued",
    )
}

fn ensure_marker_only_directory(project_path: &Path) -> Result<(), CommandError> {
    let mut entries = fs::read_dir(project_path).map_err(|error| {
        CommandError::new(
            "project_read_failed",
            format!("Unable to enumerate the project directory: {error}"),
        )
    })?;

    while let Some(entry_result) = entries.next() {
        let entry = entry_result.map_err(|error| {
            CommandError::new(
                "project_read_failed",
                format!("Unable to enumerate the project directory: {error}"),
            )
        })?;
        if entry.file_name() != MANIFEST_FILE_NAME {
            return Err(CommandError::new(
                "rollback_not_empty",
                "Rollback only removes projects that still contain only the .preshotproj manifest",
            ));
        }
    }

    Ok(())
}

fn unique_quarantine_path(project_path: &Path) -> PathBuf {
    let parent = project_path
        .parent()
        .expect("canonical project path should always have a parent directory");
    let project_name = project_path
        .file_name()
        .expect("canonical project path should always have a terminal component")
        .to_string_lossy();

    parent.join(format!(
        ".preshot-rollback-{project_name}-{}",
        Uuid::new_v4()
    ))
}

fn read_manifest_bytes(project_path: &Path) -> Result<Vec<u8>, CommandError> {
    fs::read(project_path.join(MANIFEST_FILE_NAME)).map_err(|error| {
        CommandError::new(
            "manifest_read_failed",
            format!("Unable to read the project manifest: {error}"),
        )
    })
}

fn ensure_manifest_matches_project_id(
    manifest_bytes: &[u8],
    project_id: &str,
) -> Result<(), CommandError> {
    let manifest: ProjectManifest = serde_json::from_slice(manifest_bytes).map_err(|error| {
        CommandError::new(
            "manifest_decode_failed",
            format!("Unable to decode the project manifest: {error}"),
        )
    })?;
    validate_manifest(&manifest)?;

    if manifest.id != project_id {
        return Err(rollback_id_mismatch());
    }

    Ok(())
}

fn ensure_manifest_is_unchanged(
    manifest_bytes: &[u8],
    expected_manifest_bytes: &[u8],
) -> Result<(), CommandError> {
    if manifest_bytes != expected_manifest_bytes {
        return Err(rollback_manifest_changed());
    }

    Ok(())
}

fn restore_quarantined_project(
    project_path: &Path,
    quarantine_path: &Path,
    manifest_bytes: Option<&[u8]>,
    rollback_error: CommandError,
) -> Result<(), CommandError> {
    if let Some(manifest_bytes) = manifest_bytes {
        let manifest_path = quarantine_path.join(MANIFEST_FILE_NAME);
        if !manifest_path.exists() {
            fs::write(&manifest_path, manifest_bytes).map_err(|error| {
                CommandError::new(
                    "rollback_restore_failed",
                    format!(
                        "{}; restoration failed: unable to restore the project manifest: {error}",
                        rollback_error.message
                    ),
                )
            })?;
        }
    }

    fs::rename(quarantine_path, project_path).map_err(|error| {
        CommandError::new(
            "rollback_restore_failed",
            format!(
                "{}; restoration failed: unable to restore the project directory: {error}",
                rollback_error.message
            ),
        )
    })?;

    Err(rollback_error)
}

pub(crate) fn canonicalize_directory(
    path: &Path,
    not_found_code: &str,
    not_directory_code: &str,
) -> Result<PathBuf, CommandError> {
    let canonical_path = path.canonicalize().map_err(|error| match error.kind() {
        ErrorKind::NotFound => {
            CommandError::new(not_found_code, format!("Path does not exist: {path:?}"))
        }
        _ => CommandError::new(
            not_found_code,
            format!("Unable to access path {path:?}: {error}"),
        ),
    })?;

    if !canonical_path.is_dir() {
        return Err(CommandError::new(
            not_directory_code,
            format!(
                "Expected a directory path: {}",
                path_to_string(&canonical_path)
            ),
        ));
    }

    Ok(canonical_path)
}

fn mime_for_path(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    match extension.as_str() {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

fn normalize_relative_path(path: &Path) -> Option<String> {
    let mut components = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(segment) => components.push(segment.to_str()?.to_string()),
            _ => return None,
        }
    }

    if components.is_empty() {
        None
    } else {
        Some(components.join("\\"))
    }
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn remove_dir_if_empty(path: &Path) {
    if path.is_dir() {
        let _ = fs::remove_dir(path);
    }
}

fn remove_file_if_exists(path: &Path) {
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(_) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::DateTime;
    use serde_json::json;
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::{Arc, Barrier},
        time::{Duration, Instant},
    };
    use tempfile::TempDir;
    use uuid::Uuid;

    const SMALL_PNG: &[u8] = b"small-png";
    const SMALL_JPG: &[u8] = b"small-jpg";

    #[test]
    fn creates_a_versioned_manifest_in_a_named_child_directory() {
        let parent = tempfile::tempdir().unwrap();

        let created = create_project_in(parent.path(), "Editorial").unwrap();
        let project_path = parent.path().join("Editorial");
        let manifest_path = project_path.join(".preshotproj");

        assert!(manifest_path.is_file());
        assert_eq!(created.path, canonical_string(&project_path));
        assert_eq!(created.manifest.schema_version, 1);
        assert_eq!(created.manifest.name, "Editorial");
        assert_eq!(created.manifest.cover_image, None);
        Uuid::parse_str(&created.manifest.id).unwrap();
        DateTime::parse_from_rfc3339(&created.manifest.created_at).unwrap();
        DateTime::parse_from_rfc3339(&created.manifest.updated_at).unwrap();
    }

    #[test]
    fn rejects_reserved_and_invalid_project_names() {
        let parent = tempfile::tempdir().unwrap();

        for name in [
            "",
            " ",
            " Editorial",
            "Editorial ",
            "Editorial.",
            "A/B",
            "A\\B",
            "A:B",
            "A*B",
            "A?B",
            "A\"B",
            "A<B",
            "A>B",
            "A|B",
            "CON",
            "con.txt",
            "LPT9",
        ] {
            let error = create_project_in(parent.path(), name).unwrap_err();
            assert_eq!(error.code, "invalid_project_name", "{name}");
        }
    }

    #[test]
    fn dedupes_when_destination_name_is_taken() {
        let parent = tempfile::tempdir().unwrap();
        fs::create_dir(parent.path().join("Editorial")).unwrap();

        let created = create_project_in(parent.path(), "Editorial").unwrap();

        let deduped = parent.path().join("Editorial (2)");
        assert_eq!(created.path, canonical_string(&deduped));
        assert_eq!(created.manifest.name, "Editorial");
        assert_eq!(
            Path::new(&created.path)
                .file_name()
                .and_then(|value| value.to_str()),
            Some("Editorial (2)")
        );
        assert!(deduped.join(".preshotproj").is_file());
    }

    #[test]
    fn dedupe_project_name_returns_name_when_free() {
        let parent = tempfile::tempdir().unwrap();
        assert_eq!(dedupe_project_name(parent.path(), "山景"), "山景");
    }

    #[test]
    fn dedupe_project_name_appends_suffix_on_collision() {
        let parent = tempfile::tempdir().unwrap();
        fs::create_dir(parent.path().join("山景")).unwrap();
        assert_eq!(dedupe_project_name(parent.path(), "山景"), "山景 (2)");
    }

    #[test]
    fn dedupe_project_name_finds_first_free_suffix() {
        let parent = tempfile::tempdir().unwrap();
        fs::create_dir(parent.path().join("山景")).unwrap();
        fs::create_dir(parent.path().join("山景 (2)")).unwrap();
        assert_eq!(dedupe_project_name(parent.path(), "山景"), "山景 (3)");
    }

    #[test]
    fn preshot_home_ends_with_dot_preshot() {
        assert!(preshot_home().unwrap().ends_with(".preshot"));
    }

    #[test]
    fn default_projects_path_in_creates_projects_dir() {
        let home = tempfile::tempdir().unwrap();
        let dir = default_projects_path_in(home.path()).unwrap();
        assert_eq!(dir, home.path().join("projects"));
        assert!(dir.is_dir());
    }

    #[test]
    fn bootstrap_creates_absent_roots_and_one_schema_14_starter() {
        let profile = tempfile::tempdir().unwrap();
        let user_root = profile.path().join(".preshot");
        let pending = PendingProjectRollbacks::default();

        let result = bootstrap_user_data_in(&user_root, &[], &pending).unwrap();
        let project = result.project.unwrap();
        let plan = project.manifest.plan.unwrap();

        assert!(user_root.is_dir());
        assert!(user_root.join("projects").is_dir());
        assert_eq!(project.manifest.name, STARTER_PROJECT_NAME);
        assert_eq!(plan["schemaVersion"], 14);
        assert_eq!(plan["document"]["version"], 2);
        assert_eq!(plan["imageGroups"], serde_json::json!([]));
        assert_eq!(plan["document"]["blocks"].as_array().unwrap().len(), 3);
        assert!(result.rollback_token.is_some());
        assert_eq!(fs::read_dir(user_root.join("projects")).unwrap().count(), 1);
    }

    #[test]
    fn bootstrap_uses_an_empty_existing_root_without_overwriting_settings() {
        let profile = tempfile::tempdir().unwrap();
        let user_root = profile.path().join(".preshot");
        fs::create_dir_all(user_root.join("projects")).unwrap();
        let settings = br#"{"theme":"dark","keep":true}"#;
        fs::write(user_root.join("settings.json"), settings).unwrap();

        let result =
            bootstrap_user_data_in(&user_root, &[], &PendingProjectRollbacks::default()).unwrap();

        assert!(result.project.is_some());
        assert_eq!(fs::read(user_root.join("settings.json")).unwrap(), settings);
    }

    #[test]
    fn bootstrap_skips_creation_for_an_available_registered_project() {
        let profile = tempfile::tempdir().unwrap();
        let user_root = profile.path().join(".preshot");
        let elsewhere = tempfile::tempdir().unwrap();
        let registered = create_project_in(elsewhere.path(), "Authoritative").unwrap();
        let identities = [RegisteredProjectIdentity {
            project_id: registered.manifest.id,
            path: registered.path,
        }];

        let result =
            bootstrap_user_data_in(&user_root, &identities, &PendingProjectRollbacks::default())
                .unwrap();

        assert!(result.project.is_none());
        assert!(result.rollback_token.is_none());
        assert_eq!(fs::read_dir(user_root.join("projects")).unwrap().count(), 0);
    }

    #[test]
    fn bootstrap_adopts_a_valid_unregistered_default_root_project() {
        let profile = tempfile::tempdir().unwrap();
        let user_root = profile.path().join(".preshot");
        let roots = ensure_user_data_roots_in(&user_root).unwrap();
        let existing = create_project_in(Path::new(&roots.projects_root), "Existing").unwrap();

        let result =
            bootstrap_user_data_in(&user_root, &[], &PendingProjectRollbacks::default()).unwrap();

        assert_eq!(result.project.unwrap().manifest.id, existing.manifest.id);
        assert!(result.rollback_token.is_none());
        assert!(!Path::new(&roots.projects_root)
            .join(STARTER_PROJECT_NAME)
            .exists());
    }

    #[test]
    fn second_bootstrap_reuses_the_registered_starter() {
        let profile = tempfile::tempdir().unwrap();
        let user_root = profile.path().join(".preshot");
        let pending = PendingProjectRollbacks::default();
        let first = bootstrap_user_data_in(&user_root, &[], &pending).unwrap();
        let first_project = first.project.unwrap();
        let identities = [RegisteredProjectIdentity {
            project_id: first_project.manifest.id.clone(),
            path: first_project.path.clone(),
        }];

        let second = bootstrap_user_data_in(&user_root, &identities, &pending).unwrap();

        assert!(second.project.is_none());
        assert!(second.rollback_token.is_none());
        assert_eq!(fs::read_dir(user_root.join("projects")).unwrap().count(), 1);
    }

    #[test]
    fn concurrent_bootstrap_creates_exactly_one_starter() {
        let profile = tempfile::tempdir().unwrap();
        let user_root = Arc::new(profile.path().join(".preshot"));
        let barrier = Arc::new(Barrier::new(2));
        let handles = (0..2)
            .map(|_| {
                let user_root = Arc::clone(&user_root);
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    bootstrap_user_data_in(&user_root, &[], &PendingProjectRollbacks::default())
                        .unwrap()
                })
            })
            .collect::<Vec<_>>();
        let results = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>();

        let ids = results
            .iter()
            .map(|result| result.project.as_ref().unwrap().manifest.id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(ids[0], ids[1]);
        assert_eq!(
            results
                .iter()
                .filter(|result| result.rollback_token.is_some())
                .count(),
            1
        );
        assert_eq!(fs::read_dir(user_root.join("projects")).unwrap().count(), 1);
    }

    #[test]
    fn root_creation_failure_is_actionable_and_preserves_the_existing_file() {
        let profile = tempfile::tempdir().unwrap();
        let user_root = profile.path().join(".preshot");
        fs::write(&user_root, "authoritative").unwrap();

        let error = ensure_user_data_roots_in(&user_root).unwrap_err();

        assert_eq!(error.code, "user_root_create_failed");
        assert_eq!(fs::read_to_string(user_root).unwrap(), "authoritative");
    }

    #[test]
    fn starter_manifest_write_failure_removes_only_the_new_empty_attempt() {
        let projects_root = tempfile::tempdir().unwrap();
        fs::write(projects_root.path().join("existing.txt"), "keep").unwrap();

        let error =
            create_starter_project_in_with_manifest_writer(projects_root.path(), &|_, _| {
                Err(CommandError::new(
                    "manifest_write_failed",
                    "simulated permission failure",
                ))
            })
            .unwrap_err();

        assert_eq!(error.code, "manifest_write_failed");
        assert!(!projects_root.path().join(STARTER_PROJECT_NAME).exists());
        assert_eq!(
            fs::read_to_string(projects_root.path().join("existing.txt")).unwrap(),
            "keep"
        );
    }

    #[test]
    fn bootstrap_adopts_and_migrates_a_legacy_default_root_manifest() {
        let profile = tempfile::tempdir().unwrap();
        let user_root = profile.path().join(".preshot");
        let roots = ensure_user_data_roots_in(&user_root).unwrap();
        let legacy_path = Path::new(&roots.projects_root).join("Legacy");
        fs::create_dir(&legacy_path).unwrap();
        fs::write(
            legacy_path.join(LEGACY_MANIFEST_FILE_NAME),
            serde_json::to_vec_pretty(&json!({
                "schemaVersion": 1,
                "id": "487cbc59-e196-4900-80d3-7221e64eb181",
                "name": "Legacy",
                "createdAt": "2026-07-27T17:00:00.000Z",
                "updatedAt": "2026-07-27T17:00:00.000Z"
            }))
            .unwrap(),
        )
        .unwrap();

        let result =
            bootstrap_user_data_in(&user_root, &[], &PendingProjectRollbacks::default()).unwrap();

        assert_eq!(result.project.unwrap().manifest.name, "Legacy");
        assert!(result.rollback_token.is_none());
        assert!(legacy_path.join(MANIFEST_FILE_NAME).is_file());
    }

    #[test]
    fn rejects_missing_malformed_unsupported_and_invalid_id_manifests_with_stable_codes() {
        let missing = tempfile::tempdir().unwrap();
        let error = inspect_project_directory(missing.path()).unwrap_err();
        assert_eq!(error.code, "manifest_missing");

        let malformed = project_fixture("Malformed", None);
        fs::write(malformed.path().join(".preshot"), "{not json").unwrap();
        let error = inspect_project_directory(malformed.path()).unwrap_err();
        assert_eq!(error.code, "manifest_decode_failed");

        let unsupported = project_fixture("Unsupported", None);
        write_manifest(
            unsupported.path(),
            json!({
                "schemaVersion": 2,
                "id": "487cbc59-e196-4900-80d3-7221e64eb181",
                "name": "Unsupported",
                "createdAt": "2026-07-27T17:00:00.000Z",
                "updatedAt": "2026-07-27T17:00:00.000Z"
            }),
        );
        let error = inspect_project_directory(unsupported.path()).unwrap_err();
        assert_eq!(error.code, "manifest_schema_unsupported");

        let invalid_id = project_fixture("Invalid Id", None);
        write_manifest(
            invalid_id.path(),
            json!({
                "schemaVersion": 1,
                "id": "not-a-uuid",
                "name": "Invalid Id",
                "createdAt": "2026-07-27T17:00:00.000Z",
                "updatedAt": "2026-07-27T17:00:00.000Z"
            }),
        );
        let error = inspect_project_directory(invalid_id.path()).unwrap_err();
        assert_eq!(error.code, "manifest_invalid_id");
    }

    #[test]
    fn rejects_explicit_null_cover_image_with_a_stable_decode_error() {
        let project = project_fixture("Null Cover", None);
        write_manifest(
            project.path(),
            json!({
                "schemaVersion": 1,
                "id": "487cbc59-e196-4900-80d3-7221e64eb181",
                "name": "Null Cover",
                "createdAt": "2026-07-27T17:00:00.000Z",
                "updatedAt": "2026-07-27T17:00:00.000Z",
                "coverImage": null
            }),
        );

        let error = inspect_project_directory(project.path()).unwrap_err();

        assert_eq!(error.code, "manifest_decode_failed");
    }

    #[test]
    fn explicit_valid_cover_wins() {
        let project = project_fixture("Explicit Cover", Some("z.jpg"));
        write_file(project.path(), "a.png", SMALL_PNG);
        write_file(project.path(), "z.jpg", SMALL_JPG);

        let inspected = inspect_project_directory(project.path()).unwrap();

        assert_eq!(inspected.resolved_cover_image.as_deref(), Some("z.jpg"));
        assert!(inspected
            .cover_data_url
            .as_deref()
            .unwrap()
            .starts_with("data:image/jpeg;base64,"));
    }

    #[test]
    fn invalid_explicit_cover_falls_back_to_deterministic_first_root_image() {
        let project = project_fixture("Fallback Cover", Some("missing.png"));
        write_file(project.path(), "b.jpg", SMALL_JPG);
        write_file(project.path(), "A.png", SMALL_PNG);

        let inspected = inspect_project_directory(project.path()).unwrap();

        assert_eq!(inspected.resolved_cover_image.as_deref(), Some("A.png"));
        assert!(inspected
            .cover_data_url
            .as_deref()
            .unwrap()
            .starts_with("data:image/png;base64,"));
    }

    #[test]
    fn fallback_cover_scan_is_nonrecursive() {
        let project = project_fixture("Nonrecursive", None);
        fs::create_dir(project.path().join("nested")).unwrap();
        write_file(project.path(), "nested\\a.png", SMALL_PNG);
        write_file(project.path(), "z.jpg", SMALL_JPG);

        let inspected = inspect_project_directory(project.path()).unwrap();

        assert_eq!(inspected.resolved_cover_image.as_deref(), Some("z.jpg"));
    }

    #[test]
    fn traversal_and_absolute_cover_paths_are_rejected_without_escaping_the_root() {
        let outside = tempfile::tempdir().unwrap();
        let outside_image = outside.path().join("escape.png");
        fs::write(&outside_image, SMALL_PNG).unwrap();

        let traversal = project_fixture("Traversal", Some("..\\escape.png"));
        let inspected = inspect_project_directory(traversal.path()).unwrap();
        assert_eq!(inspected.resolved_cover_image, None);
        assert_eq!(inspected.cover_data_url, None);

        let absolute = project_fixture("Absolute", Some(outside_image.to_string_lossy().as_ref()));
        let inspected = inspect_project_directory(absolute.path()).unwrap();
        assert_eq!(inspected.resolved_cover_image, None);
        assert_eq!(inspected.cover_data_url, None);
    }

    #[test]
    fn encodes_supported_cover_mime_types_as_data_urls() {
        for (file_name, expected_prefix) in [
            ("cover.jpg", "data:image/jpeg;base64,"),
            ("cover.jpeg", "data:image/jpeg;base64,"),
            ("cover.png", "data:image/png;base64,"),
            ("cover.webp", "data:image/webp;base64,"),
            ("cover.gif", "data:image/gif;base64,"),
            ("cover.bmp", "data:image/bmp;base64,"),
        ] {
            let project = project_fixture("Mime", Some(file_name));
            write_file(project.path(), file_name, b"cover-bytes");

            let inspected = inspect_project_directory(project.path()).unwrap();

            assert_eq!(inspected.resolved_cover_image.as_deref(), Some(file_name));
            assert!(
                inspected
                    .cover_data_url
                    .as_deref()
                    .unwrap()
                    .starts_with(expected_prefix),
                "{file_name}"
            );
        }
    }

    #[test]
    fn oversized_cover_is_skipped_without_blocking_other_candidates() {
        let project = project_fixture("Oversized", Some("cover.png"));
        let oversized_path = project.path().join("cover.png");
        let oversized_file = fs::File::create(&oversized_path).unwrap();
        oversized_file.set_len(16 * 1024 * 1024 + 1).unwrap();
        write_file(project.path(), "fallback.jpg", SMALL_JPG);

        let inspected = inspect_project_directory(project.path()).unwrap();

        assert_eq!(
            inspected.resolved_cover_image.as_deref(),
            Some("fallback.jpg")
        );
        assert!(inspected
            .cover_data_url
            .as_deref()
            .unwrap()
            .starts_with("data:image/jpeg;base64,"));
    }

    #[test]
    fn rollback_removes_a_marker_only_project_directory() {
        let parent = tempfile::tempdir().unwrap();
        let created = create_project_in(parent.path(), "Rollback").unwrap();
        let project_path = parent.path().join("Rollback");
        let manifest_bytes = read_manifest_bytes(&project_path).unwrap();

        rollback_created_project_directory(&project_path, &created.manifest.id, &manifest_bytes)
            .unwrap();

        assert!(!project_path.exists());
    }

    #[test]
    fn rollback_refuses_id_mismatch_and_any_additional_file() {
        let parent = tempfile::tempdir().unwrap();
        let created = create_project_in(parent.path(), "Protected").unwrap();
        let project_path = parent.path().join("Protected");
        let manifest_bytes = read_manifest_bytes(&project_path).unwrap();

        let error = rollback_created_project_directory(
            &project_path,
            "00000000-0000-0000-0000-000000000000",
            &manifest_bytes,
        )
        .unwrap_err();
        assert_eq!(error.code, "rollback_id_mismatch");

        fs::write(project_path.join("notes.txt"), "keep me").unwrap();
        let error = rollback_created_project_directory(
            &project_path,
            &created.manifest.id,
            &manifest_bytes,
        )
        .unwrap_err();
        assert_eq!(error.code, "rollback_not_empty");
    }

    #[test]
    fn pending_rollbacks_refuse_unknown_reused_and_expired_tokens_and_take_once() {
        let pending = PendingProjectRollbacks::default();
        let unknown = pending.take("missing").unwrap_err();
        assert_eq!(unknown.code, "rollback_not_authorized");

        let project_path = PathBuf::from(r"C:\projects\Preshot\workspace");
        let token = pending.register_with_instant(
            project_path.clone(),
            "project-1".to_string(),
            b"original manifest".to_vec(),
            Instant::now(),
        );

        let authorized = pending.take(&token).unwrap();
        assert_eq!(authorized.project_path, project_path);
        assert_eq!(authorized.project_id, "project-1");
        assert_eq!(authorized.manifest_bytes, b"original manifest");

        let reused = pending.take(&token).unwrap_err();
        assert_eq!(reused.code, "rollback_not_authorized");

        let expired_token = pending.register_with_instant(
            PathBuf::from(r"C:\projects\Preshot\expired"),
            "project-expired".to_string(),
            b"expired manifest".to_vec(),
            Instant::now() - PENDING_ROLLBACK_TTL - Duration::from_secs(1),
        );
        let expired = pending.take(&expired_token).unwrap_err();
        assert_eq!(expired.code, "rollback_not_authorized");
    }

    #[test]
    fn token_rollback_refuses_tampering_and_an_id_used_as_a_token() {
        let parent = tempfile::tempdir().unwrap();
        let created = create_project_in(parent.path(), "Protected").unwrap();
        let pending = PendingProjectRollbacks::default();
        let token = pending.register_with_instant(
            PathBuf::from(&created.path),
            created.manifest.id.clone(),
            read_manifest_bytes(Path::new(&created.path)).unwrap(),
            Instant::now(),
        );

        let id_error =
            rollback_created_project_with_token(&pending, &created.manifest.id).unwrap_err();
        let tampered_error =
            rollback_created_project_with_token(&pending, &format!("{token}-tampered"))
                .unwrap_err();

        assert_eq!(id_error.code, "rollback_not_authorized");
        assert_eq!(tampered_error.code, "rollback_not_authorized");
        assert!(Path::new(&created.path).exists());

        let stored = pending.take(&token).unwrap();
        assert_eq!(stored.project_id, created.manifest.id);
    }

    #[test]
    fn rollback_restores_the_original_directory_when_a_file_appears_after_quarantine() {
        let parent = tempfile::tempdir().unwrap();
        let created = create_project_in(parent.path(), "Protected").unwrap();
        let project_path = parent.path().join("Protected");
        let manifest_bytes = read_manifest_bytes(&project_path).unwrap();

        let error = rollback_created_project_directory_with_hooks(
            &project_path,
            &created.manifest.id,
            &manifest_bytes,
            &|_| {},
            &|quarantine_path| {
                fs::write(quarantine_path.join("notes.txt"), "keep me").unwrap();
            },
        )
        .unwrap_err();

        assert_eq!(error.code, "rollback_not_empty");
        let restored = inspect_project_directory(&project_path).unwrap();
        assert_eq!(restored.manifest.id, created.manifest.id);
        assert_eq!(
            fs::read_to_string(project_path.join("notes.txt")).unwrap(),
            "keep me"
        );
    }

    #[test]
    fn successful_token_rollback_removes_a_marker_only_project() {
        let parent = tempfile::tempdir().unwrap();
        let created = create_project_in(parent.path(), "Rollback").unwrap();
        let pending = PendingProjectRollbacks::default();
        let token = pending.register_with_instant(
            PathBuf::from(&created.path),
            created.manifest.id.clone(),
            read_manifest_bytes(Path::new(&created.path)).unwrap(),
            Instant::now(),
        );

        rollback_created_project_with_token(&pending, &token).unwrap();

        assert!(!Path::new(&created.path).exists());
    }

    fn assert_bootstrap_manifest_mutation_is_preserved(mutate: impl FnOnce(&mut ProjectManifest)) {
        let profile = tempfile::tempdir().unwrap();
        let user_root = profile.path().join(".preshot");
        let pending = PendingProjectRollbacks::default();
        let result = bootstrap_user_data_in(&user_root, &[], &pending).unwrap();
        let project = result.project.unwrap();
        let token = result.rollback_token.unwrap();
        let project_path = PathBuf::from(&project.path);
        let mut manifest = read_manifest(&project_path).unwrap();
        mutate(&mut manifest);
        write_manifest_atomically(&project_path, &manifest).unwrap();
        let mutated_bytes = read_manifest_bytes(&project_path).unwrap();

        let error = rollback_created_project_with_token(&pending, &token).unwrap_err();

        assert_eq!(error.code, "rollback_manifest_changed");
        assert_eq!(read_manifest_bytes(&project_path).unwrap(), mutated_bytes);
        assert_eq!(read_manifest(&project_path).unwrap(), manifest);
    }

    #[test]
    fn bootstrap_rollback_refuses_plan_title_and_timestamp_mutations() {
        assert_bootstrap_manifest_mutation_is_preserved(|manifest| {
            manifest.plan.as_mut().unwrap()["document"]["blocks"][0]["content"][0]["text"] =
                json!("Edited after bootstrap");
        });
        assert_bootstrap_manifest_mutation_is_preserved(|manifest| {
            manifest.plan.as_mut().unwrap()["title"] = json!("Edited title");
        });
        assert_bootstrap_manifest_mutation_is_preserved(|manifest| {
            manifest.updated_at = "2026-08-20T00:42:57.306Z".to_string();
        });
    }

    #[test]
    fn concurrent_plan_save_after_bootstrap_prevents_rollback_without_data_loss() {
        let profile = tempfile::tempdir().unwrap();
        let user_root = profile.path().join(".preshot");
        let pending = PendingProjectRollbacks::default();
        let result = bootstrap_user_data_in(&user_root, &[], &pending).unwrap();
        let token = result.rollback_token.unwrap();
        let authorization = pending.take(&token).unwrap();
        let saved_plan = json!({
            "schemaVersion": 14,
            "title": "Saved concurrently",
            "document": {
                "format": "preshot-blocks",
                "version": 2,
                "blocks": []
            },
            "imageGroups": []
        });

        let error = rollback_created_project_directory_with_hooks(
            &authorization.project_path,
            &authorization.project_id,
            &authorization.manifest_bytes,
            &|project_path| {
                let project_path = project_path.to_path_buf();
                let saved_plan = saved_plan.clone();
                thread::spawn(move || crate::plan::save_project_plan_in(&project_path, saved_plan))
                    .join()
                    .unwrap()
                    .unwrap();
            },
            &|_| {},
        )
        .unwrap_err();

        assert_eq!(error.code, "rollback_manifest_changed");
        assert!(authorization.project_path.is_dir());
        assert_eq!(
            crate::plan::read_project_plan_in(&authorization.project_path).unwrap(),
            saved_plan
        );
    }

    #[test]
    fn unchanged_bootstrap_manifest_rolls_back_successfully() {
        let profile = tempfile::tempdir().unwrap();
        let user_root = profile.path().join(".preshot");
        let pending = PendingProjectRollbacks::default();
        let result = bootstrap_user_data_in(&user_root, &[], &pending).unwrap();
        let project_path = PathBuf::from(result.project.unwrap().path);

        rollback_created_project_with_token(&pending, &result.rollback_token.unwrap()).unwrap();

        assert!(!project_path.exists());
    }

    #[test]
    fn creation_cleans_up_the_new_directory_when_manifest_creation_fails() {
        let parent = tempfile::tempdir().unwrap();
        let error = create_project_in_with_manifest_writer(
            parent.path(),
            "WriteFail",
            &|project, _manifest| {
                let marker = project.join("placeholder.txt");
                fs::write(&marker, "x").unwrap();
                fs::remove_file(marker).unwrap();
                Err(CommandError::new(
                    "manifest_write_failed",
                    "simulated manifest write failure",
                ))
            },
        )
        .unwrap_err();

        assert_eq!(error.code, "manifest_write_failed");
        assert!(!parent.path().join("WriteFail").exists());
    }

    fn project_fixture(name: &str, cover_image: Option<&str>) -> TempDir {
        let project = tempfile::tempdir().unwrap();
        let mut manifest = serde_json::Map::from_iter([
            ("schemaVersion".to_string(), json!(1)),
            (
                "id".to_string(),
                json!("487cbc59-e196-4900-80d3-7221e64eb181"),
            ),
            ("name".to_string(), json!(name)),
            ("createdAt".to_string(), json!("2026-07-27T17:00:00.000Z")),
            ("updatedAt".to_string(), json!("2026-07-27T17:00:00.000Z")),
        ]);
        if let Some(cover_image) = cover_image {
            manifest.insert("coverImage".to_string(), json!(cover_image));
        }
        write_manifest(project.path(), serde_json::Value::Object(manifest));
        project
    }

    fn write_manifest(project: &Path, manifest: serde_json::Value) {
        fs::write(
            project.join(".preshot"),
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();
    }

    fn write_file(project: &Path, relative_path: &str, bytes: &[u8]) {
        let path = project.join(relative_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, bytes).unwrap();
    }

    fn canonical_string(path: &Path) -> String {
        path.canonicalize().unwrap().to_string_lossy().into_owned()
    }

    #[test]
    fn inspect_reads_a_plan_from_the_manifest() {
        let project = tempfile::tempdir().unwrap();
        let manifest = concat!(
            "{\"schemaVersion\":1,\"id\":\"3f8d1c2e-0000-4000-8000-000000000001\",",
            "\"name\":\"Planned\",\"createdAt\":\"2026-07-29T00:00:00.000Z\",",
            "\"updatedAt\":\"2026-07-29T00:00:00.000Z\",",
            "\"plan\":{\"referenceGroups\":[{\"id\":\"g1\",\"title\":\"Lookbook\",",
            "\"columnsPerRow\":3,\"images\":[{\"id\":\"i1\",\"file\":\"references/0001.jpg\"}]}]}}"
        );
        fs::write(project.path().join(".preshot"), manifest).unwrap();

        let inspected = inspect_project_directory(project.path()).unwrap();
        let plan = inspected.manifest.plan.unwrap();

        assert_eq!(plan["referenceGroups"][0]["id"], "g1");
        assert_eq!(plan["referenceGroups"][0]["title"], "Lookbook");
        assert_eq!(
            plan["referenceGroups"][0]["images"][0]["file"],
            "references/0001.jpg"
        );
    }

    #[test]
    fn read_manifest_migrates_legacy_preshot_to_preshotproj() {
        let project = tempfile::tempdir().unwrap();
        let legacy_manifest = json!({
            "schemaVersion": 1,
            "id": "487cbc59-e196-4900-80d3-7221e64eb181",
            "name": "Legacy",
            "createdAt": "2026-07-27T17:00:00.000Z",
            "updatedAt": "2026-07-27T17:00:00.000Z"
        });
        fs::write(
            project.path().join(".preshot"),
            serde_json::to_vec_pretty(&legacy_manifest).unwrap(),
        )
        .unwrap();

        let manifest = read_manifest(project.path()).unwrap();

        assert_eq!(manifest.id, "487cbc59-e196-4900-80d3-7221e64eb181");
        assert_eq!(manifest.name, "Legacy");
        assert!(project.path().join(".preshotproj").exists());
        assert!(!project.path().join(".preshot").exists());
    }

    #[test]
    fn read_manifest_reads_preshotproj_directly() {
        let project = tempfile::tempdir().unwrap();
        let manifest_value = json!({
            "schemaVersion": 1,
            "id": "487cbc59-e196-4900-80d3-7221e64eb181",
            "name": "Modern",
            "createdAt": "2026-07-27T17:00:00.000Z",
            "updatedAt": "2026-07-27T17:00:00.000Z"
        });
        fs::write(
            project.path().join(".preshotproj"),
            serde_json::to_vec_pretty(&manifest_value).unwrap(),
        )
        .unwrap();

        let manifest = read_manifest(project.path()).unwrap();

        assert_eq!(manifest.id, "487cbc59-e196-4900-80d3-7221e64eb181");
        assert_eq!(manifest.name, "Modern");
    }

    #[test]
    fn read_manifest_returns_manifest_missing_when_neither_file_exists() {
        let project = tempfile::tempdir().unwrap();

        let error = read_manifest(project.path()).unwrap_err();

        assert_eq!(error.code, "manifest_missing");
    }
}
