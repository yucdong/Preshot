use std::{
    fs,
    io::ErrorKind,
    path::{Component, Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::{SecondsFormat, Utc};
use uuid::Uuid;

use crate::error::CommandError;

const MANIFEST_FILE_NAME: &str = ".preshot";
const MANIFEST_TEMP_FILE_NAME: &str = ".preshot.tmp";
const MAX_COVER_BYTES: u64 = 16 * 1024 * 1024;
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
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectedProject {
    pub path: String,
    pub manifest: ProjectManifest,
    pub resolved_cover_image: Option<String>,
    pub cover_data_url: Option<String>,
}

#[derive(Debug, Clone)]
struct ResolvedCover {
    absolute_path: PathBuf,
    relative_path: String,
    mime: &'static str,
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
    let project = parent.join(name);

    if project.exists() {
        return Err(CommandError::new(
            "project_exists",
            "A file or folder with this project name already exists",
        ));
    }

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
    };

    if let Err(error) = manifest_writer(&project, &manifest) {
        remove_dir_if_empty(&project);
        return Err(error);
    }

    inspect_project_directory(&project)
}

fn write_manifest_atomically(
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

pub fn inspect_project_directory(path: &Path) -> Result<InspectedProject, CommandError> {
    let project_path = canonicalize_directory(path, "project_not_found", "project_not_directory")?;
    let manifest_path = project_path.join(MANIFEST_FILE_NAME);
    let manifest_metadata = fs::metadata(&manifest_path).map_err(|error| match error.kind() {
        ErrorKind::NotFound => CommandError::new(
            "manifest_missing",
            "Preshot projects must contain a .preshot manifest",
        ),
        _ => CommandError::new(
            "manifest_read_failed",
            format!("Unable to access the project manifest: {error}"),
        ),
    })?;

    if !manifest_metadata.is_file() {
        return Err(CommandError::new(
            "manifest_not_file",
            "The .preshot manifest must be a regular file",
        ));
    }

    let manifest_bytes = fs::read(&manifest_path).map_err(|error| {
        CommandError::new(
            "manifest_read_failed",
            format!("Unable to read the project manifest: {error}"),
        )
    })?;
    let manifest: ProjectManifest = serde_json::from_slice(&manifest_bytes).map_err(|error| {
        CommandError::new(
            "manifest_decode_failed",
            format!("Unable to decode the project manifest: {error}"),
        )
    })?;

    validate_manifest(&manifest)?;

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

pub fn remove_created_project_directory(path: &Path, project_id: &str) -> Result<(), CommandError> {
    let project_path = canonicalize_directory(path, "project_not_found", "project_not_directory")?;
    let inspected = inspect_project_directory(&project_path)?;

    if inspected.manifest.id != project_id {
        return Err(CommandError::new(
            "rollback_id_mismatch",
            "The project ID does not match the requested rollback target",
        ));
    }

    let mut entries = fs::read_dir(&project_path).map_err(|error| {
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
                "Rollback only removes projects that still contain only the .preshot manifest",
            ));
        }
    }

    fs::remove_file(project_path.join(MANIFEST_FILE_NAME)).map_err(|error| {
        CommandError::new(
            "remove_manifest_failed",
            format!("Unable to remove the project manifest: {error}"),
        )
    })?;
    fs::remove_dir(&project_path).map_err(|error| {
        CommandError::new(
            "remove_directory_failed",
            format!("Unable to remove the project directory: {error}"),
        )
    })
}

#[tauri::command]
pub fn create_project(parent_path: String, name: String) -> Result<InspectedProject, CommandError> {
    create_project_in(Path::new(&parent_path), &name)
}

#[tauri::command]
pub fn inspect_project(path: String) -> Result<InspectedProject, CommandError> {
    inspect_project_directory(Path::new(&path))
}

#[tauri::command]
pub fn remove_created_project(path: String, project_id: String) -> Result<(), CommandError> {
    remove_created_project_directory(Path::new(&path), &project_id)
}

fn canonicalize_directory(
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
    use std::{fs, path::Path};
    use tempfile::TempDir;
    use uuid::Uuid;

    const SMALL_PNG: &[u8] = b"small-png";
    const SMALL_JPG: &[u8] = b"small-jpg";

    #[test]
    fn creates_a_versioned_manifest_in_a_named_child_directory() {
        let parent = tempfile::tempdir().unwrap();

        let created = create_project_in(parent.path(), "Editorial").unwrap();
        let project_path = parent.path().join("Editorial");
        let manifest_path = project_path.join(".preshot");

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
    fn rejects_existing_destination() {
        let parent = tempfile::tempdir().unwrap();
        fs::create_dir(parent.path().join("Editorial")).unwrap();

        let error = create_project_in(parent.path(), "Editorial").unwrap_err();

        assert_eq!(error.code, "project_exists");
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

        remove_created_project_directory(&project_path, &created.manifest.id).unwrap();

        assert!(!project_path.exists());
    }

    #[test]
    fn rollback_refuses_id_mismatch_and_any_additional_file() {
        let parent = tempfile::tempdir().unwrap();
        let created = create_project_in(parent.path(), "Protected").unwrap();
        let project_path = parent.path().join("Protected");

        let error =
            remove_created_project_directory(&project_path, "00000000-0000-0000-0000-000000000000")
                .unwrap_err();
        assert_eq!(error.code, "rollback_id_mismatch");

        fs::write(project_path.join("notes.txt"), "keep me").unwrap();
        let error =
            remove_created_project_directory(&project_path, &created.manifest.id).unwrap_err();
        assert_eq!(error.code, "rollback_not_empty");
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
}
