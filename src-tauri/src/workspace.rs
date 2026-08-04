use std::{
    collections::HashMap,
    fs,
    io::ErrorKind,
    path::{Component, Path, PathBuf},
    sync::{Mutex, MutexGuard},
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::{SecondsFormat, Utc};
use uuid::Uuid;

use crate::error::CommandError;

const MANIFEST_FILE_NAME: &str = ".preshotproj";
const LEGACY_MANIFEST_FILE_NAME: &str = ".preshot";
const MANIFEST_TEMP_FILE_NAME: &str = ".preshotproj.tmp";
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
    created_at: Instant,
}

#[derive(Debug, Default)]
pub struct PendingProjectRollbacks {
    entries: Mutex<HashMap<String, PendingProjectRollback>>,
}

impl PendingProjectRollbacks {
    fn register(&self, project_path: PathBuf, project_id: String) -> String {
        self.register_with_instant(project_path, project_id, Instant::now())
    }

    fn register_with_instant(
        &self,
        project_path: PathBuf,
        project_id: String,
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
fn preshot_home() -> Result<PathBuf, CommandError> {
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

/// Returns `~/.preshot/projects`, creating it if missing.
fn default_projects_path() -> Result<PathBuf, CommandError> {
    default_projects_path_in(&preshot_home()?)
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
        name: resolved,
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
    let manifest_bytes = serde_json::to_vec_pretty(manifest).map_err(|error| {
        CommandError::new(
            "manifest_encode_failed",
            format!("Unable to encode project manifest: {error}"),
        )
    })?;

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
                    let manifest: ProjectManifest =
                        serde_json::from_slice(&manifest_bytes).map_err(|error| {
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
) -> Result<(), CommandError> {
    rollback_created_project_directory_with_hook(path, project_id, &|_| {})
}

fn rollback_created_project_directory_with_hook<F>(
    path: &Path,
    project_id: &str,
    after_quarantine: &F,
) -> Result<(), CommandError>
where
    F: Fn(&Path),
{
    let project_path = canonicalize_directory(path, "project_not_found", "project_not_directory")?;
    let inspected = inspect_project_directory(&project_path)?;

    if inspected.manifest.id != project_id {
        return Err(rollback_id_mismatch());
    }

    ensure_marker_only_directory(&project_path)?;

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
    rollback_created_project_directory(&pending.project_path, &pending.project_id)
}

#[tauri::command]
pub fn create_project(
    pending_rollbacks: tauri::State<'_, PendingProjectRollbacks>,
    parent_path: String,
    name: String,
) -> Result<CreatedProject, CommandError> {
    let project = create_project_in(Path::new(&parent_path), &name)?;
    let rollback_token =
        pending_rollbacks.register(PathBuf::from(&project.path), project.manifest.id.clone());

    Ok(CreatedProject {
        project,
        rollback_token,
    })
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
        assert_eq!(created.manifest.name, "Editorial (2)");
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

        rollback_created_project_directory(&project_path, &created.manifest.id).unwrap();

        assert!(!project_path.exists());
    }

    #[test]
    fn rollback_refuses_id_mismatch_and_any_additional_file() {
        let parent = tempfile::tempdir().unwrap();
        let created = create_project_in(parent.path(), "Protected").unwrap();
        let project_path = parent.path().join("Protected");

        let error = rollback_created_project_directory(
            &project_path,
            "00000000-0000-0000-0000-000000000000",
        )
        .unwrap_err();
        assert_eq!(error.code, "rollback_id_mismatch");

        fs::write(project_path.join("notes.txt"), "keep me").unwrap();
        let error =
            rollback_created_project_directory(&project_path, &created.manifest.id).unwrap_err();
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
            Instant::now(),
        );

        let authorized = pending.take(&token).unwrap();
        assert_eq!(authorized.project_path, project_path);
        assert_eq!(authorized.project_id, "project-1");

        let reused = pending.take(&token).unwrap_err();
        assert_eq!(reused.code, "rollback_not_authorized");

        let expired_token = pending.register_with_instant(
            PathBuf::from(r"C:\projects\Preshot\expired"),
            "project-expired".to_string(),
            Instant::now() - PENDING_ROLLBACK_TTL - Duration::from_secs(1),
        );
        let expired = pending.take(&expired_token).unwrap_err();
        assert_eq!(expired.code, "rollback_not_authorized");
    }

    #[test]
    fn token_rollback_refuses_an_inspected_project_id_without_the_matching_token() {
        let parent = tempfile::tempdir().unwrap();
        let created = create_project_in(parent.path(), "Protected").unwrap();
        let pending = PendingProjectRollbacks::default();
        let token = pending.register_with_instant(
            PathBuf::from(&created.path),
            created.manifest.id.clone(),
            Instant::now(),
        );

        let error =
            rollback_created_project_with_token(&pending, &created.manifest.id).unwrap_err();

        assert_eq!(error.code, "rollback_not_authorized");
        assert!(Path::new(&created.path).exists());

        let stored = pending.take(&token).unwrap();
        assert_eq!(stored.project_id, created.manifest.id);
    }

    #[test]
    fn rollback_restores_the_original_directory_when_a_file_appears_after_quarantine() {
        let parent = tempfile::tempdir().unwrap();
        let created = create_project_in(parent.path(), "Protected").unwrap();
        let project_path = parent.path().join("Protected");

        let error = rollback_created_project_directory_with_hook(
            &project_path,
            &created.manifest.id,
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
            Instant::now(),
        );

        rollback_created_project_with_token(&pending, &token).unwrap();

        assert!(!Path::new(&created.path).exists());
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
        assert_eq!(plan["referenceGroups"][0]["images"][0]["file"], "references/0001.jpg");
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
