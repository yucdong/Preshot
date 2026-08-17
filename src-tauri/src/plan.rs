use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::{SecondsFormat, Utc};

use crate::error::CommandError;
use crate::workspace::{
    canonicalize_directory, read_manifest, write_manifest_atomically, ProjectManifest,
};

const REFERENCES_DIR: &str = "references";
const MEDIA_DIR: &str = "media";
const MAX_REFERENCE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_AUDIO_BYTES: usize = 64 * 1024 * 1024;
const MAX_VIDEO_BYTES: usize = 128 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedImage {
    pub file: String,
    pub data_url: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedPlanMedia {
    pub file: String,
    pub data_url: String,
    pub name: String,
    pub mime_type: String,
}

struct MediaKind {
    extension: &'static str,
    mime_type: &'static str,
    max_bytes: usize,
}

fn media_kind(file_name: &str, mime_type: &str) -> Option<MediaKind> {
    let extension = Path::new(file_name)
        .extension()?
        .to_str()?
        .to_ascii_lowercase();
    let kind = match extension.as_str() {
        "jpg" | "jpeg" => MediaKind {
            extension: "jpg",
            mime_type: "image/jpeg",
            max_bytes: MAX_REFERENCE_BYTES as usize,
        },
        "png" => MediaKind {
            extension: "png",
            mime_type: "image/png",
            max_bytes: MAX_REFERENCE_BYTES as usize,
        },
        "gif" => MediaKind {
            extension: "gif",
            mime_type: "image/gif",
            max_bytes: MAX_REFERENCE_BYTES as usize,
        },
        "webp" => MediaKind {
            extension: "webp",
            mime_type: "image/webp",
            max_bytes: MAX_REFERENCE_BYTES as usize,
        },
        "mp3" => MediaKind {
            extension: "mp3",
            mime_type: "audio/mpeg",
            max_bytes: MAX_AUDIO_BYTES,
        },
        "wav" => MediaKind {
            extension: "wav",
            mime_type: "audio/wav",
            max_bytes: MAX_AUDIO_BYTES,
        },
        "ogg" if mime_type.starts_with("audio/") => MediaKind {
            extension: "ogg",
            mime_type: "audio/ogg",
            max_bytes: MAX_AUDIO_BYTES,
        },
        "m4a" => MediaKind {
            extension: "m4a",
            mime_type: "audio/mp4",
            max_bytes: MAX_AUDIO_BYTES,
        },
        "mp4" => MediaKind {
            extension: "mp4",
            mime_type: "video/mp4",
            max_bytes: MAX_VIDEO_BYTES,
        },
        "webm" => MediaKind {
            extension: "webm",
            mime_type: "video/webm",
            max_bytes: MAX_VIDEO_BYTES,
        },
        "mov" => MediaKind {
            extension: "mov",
            mime_type: "video/quicktime",
            max_bytes: MAX_VIDEO_BYTES,
        },
        _ => return None,
    };
    if !mime_type.is_empty() && mime_type != kind.mime_type {
        return None;
    }
    Some(kind)
}

fn reference_extension(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => Some("jpg"),
        "png" => Some("png"),
        _ => None,
    }
}

fn mime_for_reference(file_name: &str) -> &'static str {
    if file_name.to_ascii_lowercase().ends_with(".png") {
        "image/png"
    } else {
        "image/jpeg"
    }
}

fn reference_path_error() -> CommandError {
    CommandError::new(
        "reference_invalid_path",
        "Reference path is not inside references/",
    )
}

fn next_reference_number(references_dir: &Path) -> u32 {
    let mut max = 0u32;
    if let Ok(entries) = fs::read_dir(references_dir) {
        for entry in entries.flatten() {
            if let Some(stem) = entry.path().file_stem().and_then(|stem| stem.to_str()) {
                if let Ok(number) = stem.parse::<u32>() {
                    max = max.max(number);
                }
            }
        }
    }
    max + 1
}

fn resolve_reference_path(project_path: &Path, file: &str) -> Result<PathBuf, CommandError> {
    let relative = Path::new(file);
    if relative.is_absolute() {
        return Err(reference_path_error());
    }

    let mut components = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(segment) => components.push(
                segment
                    .to_str()
                    .ok_or_else(reference_path_error)?
                    .to_string(),
            ),
            _ => return Err(reference_path_error()),
        }
    }
    if components.len() != 2 || components[0] != REFERENCES_DIR {
        return Err(reference_path_error());
    }
    let absolute = project_path.join(&components[0]).join(&components[1]);
    let canonical = absolute.canonicalize().map_err(|error| {
        CommandError::new(
            "reference_missing",
            format!("Unable to access the reference image: {error}"),
        )
    })?;
    if !canonical.starts_with(project_path) {
        return Err(reference_path_error());
    }
    Ok(canonical)
}

fn resolve_media_path(project_path: &Path, file: &str) -> Result<PathBuf, CommandError> {
    let relative = Path::new(file);
    if relative.is_absolute() {
        return Err(CommandError::new(
            "media_invalid_path",
            "Media path is not inside media/",
        ));
    }
    let components = relative
        .components()
        .map(|component| match component {
            Component::Normal(segment) => segment
                .to_str()
                .map(str::to_owned)
                .ok_or_else(|| CommandError::new("media_invalid_path", "Invalid media path")),
            _ => Err(CommandError::new(
                "media_invalid_path",
                "Invalid media path",
            )),
        })
        .collect::<Result<Vec<_>, _>>()?;
    if components.len() != 2 || components[0] != MEDIA_DIR {
        return Err(CommandError::new(
            "media_invalid_path",
            "Media path is not inside media/",
        ));
    }
    let absolute = project_path.join(&components[0]).join(&components[1]);
    let canonical = absolute.canonicalize().map_err(|error| {
        CommandError::new(
            "media_missing",
            format!("Unable to access the media file: {error}"),
        )
    })?;
    if !canonical.starts_with(project_path) {
        return Err(CommandError::new(
            "media_invalid_path",
            "Media path is not inside the project",
        ));
    }
    Ok(canonical)
}

fn copy_file(source: &Path, destination: &Path) -> Result<(), CommandError> {
    fs::copy(source, destination).map_err(|error| {
        CommandError::new(
            "reference_copy_failed",
            format!("Unable to copy the image into the project: {error}"),
        )
    })?;
    Ok(())
}

pub fn import_reference_image_into(
    project_path: &Path,
    source_path: &Path,
) -> Result<ImportedImage, CommandError> {
    let project_path =
        canonicalize_directory(project_path, "project_not_found", "project_not_directory")?;
    let extension = reference_extension(source_path).ok_or_else(|| {
        CommandError::new(
            "reference_unsupported_type",
            "Only JPG and PNG images are supported",
        )
    })?;
    let source = source_path.canonicalize().map_err(|error| {
        CommandError::new(
            "reference_source_missing",
            format!("Unable to access the selected image: {error}"),
        )
    })?;
    let metadata = fs::metadata(&source).map_err(|error| {
        CommandError::new(
            "reference_source_missing",
            format!("Unable to read the selected image: {error}"),
        )
    })?;
    if !metadata.is_file() {
        return Err(CommandError::new(
            "reference_source_not_file",
            "The selected path is not a file",
        ));
    }
    if metadata.len() > MAX_REFERENCE_BYTES {
        return Err(CommandError::new(
            "reference_too_large",
            "The selected image exceeds the 16 MiB limit",
        ));
    }

    let references_dir = project_path.join(REFERENCES_DIR);
    fs::create_dir_all(&references_dir).map_err(|error| {
        CommandError::new(
            "references_dir_failed",
            format!("Unable to create the references directory: {error}"),
        )
    })?;

    let file_name = format!("{:04}.{extension}", next_reference_number(&references_dir));
    let destination = references_dir.join(&file_name);
    copy_file(&source, &destination)?;

    let bytes = fs::read(&destination).map_err(|error| {
        CommandError::new(
            "reference_read_failed",
            format!("Unable to read the imported image: {error}"),
        )
    })?;
    Ok(ImportedImage {
        file: format!("{REFERENCES_DIR}/{file_name}"),
        data_url: format!(
            "data:{};base64,{}",
            mime_for_reference(&file_name),
            STANDARD.encode(bytes)
        ),
    })
}

pub fn load_reference_image_from(project_path: &Path, file: &str) -> Result<String, CommandError> {
    let project_path =
        canonicalize_directory(project_path, "project_not_found", "project_not_directory")?;
    let absolute = resolve_reference_path(&project_path, file)?;
    let metadata = fs::metadata(&absolute).map_err(|error| {
        CommandError::new(
            "reference_missing",
            format!("Unable to read the reference image: {error}"),
        )
    })?;
    if metadata.len() > MAX_REFERENCE_BYTES {
        return Err(CommandError::new(
            "reference_too_large",
            "The reference image exceeds the 16 MiB limit",
        ));
    }
    let bytes = fs::read(&absolute).map_err(|error| {
        CommandError::new(
            "reference_read_failed",
            format!("Unable to read the reference image: {error}"),
        )
    })?;
    let name = absolute
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    Ok(format!(
        "data:{};base64,{}",
        mime_for_reference(name),
        STANDARD.encode(bytes)
    ))
}

pub fn remove_reference_image_from(project_path: &Path, file: &str) -> Result<(), CommandError> {
    let project_path =
        canonicalize_directory(project_path, "project_not_found", "project_not_directory")?;
    let absolute = resolve_reference_path(&project_path, file)?;
    fs::remove_file(&absolute).map_err(|error| {
        CommandError::new(
            "reference_remove_failed",
            format!("Unable to remove the reference image: {error}"),
        )
    })
}

pub fn import_plan_media_into(
    project_path: &Path,
    name: &str,
    mime_type: &str,
    bytes: &[u8],
) -> Result<ImportedPlanMedia, CommandError> {
    let project_path =
        canonicalize_directory(project_path, "project_not_found", "project_not_directory")?;
    let kind = media_kind(name, mime_type).ok_or_else(|| {
        CommandError::new(
            "media_unsupported_type",
            "Only supported image, audio, and video files can be inserted",
        )
    })?;
    if bytes.is_empty() || bytes.len() > kind.max_bytes {
        return Err(CommandError::new(
            "media_invalid_size",
            format!(
                "The selected media file has an invalid size (maximum {} MiB)",
                kind.max_bytes / 1024 / 1024
            ),
        ));
    }
    let media_dir = project_path.join(MEDIA_DIR);
    fs::create_dir_all(&media_dir).map_err(|error| {
        CommandError::new(
            "media_dir_failed",
            format!("Unable to create the media directory: {error}"),
        )
    })?;
    let file_name = format!(
        "{:04}.{}",
        next_reference_number(&media_dir),
        kind.extension
    );
    fs::write(media_dir.join(&file_name), bytes).map_err(|error| {
        CommandError::new(
            "media_write_failed",
            format!("Unable to write the media file: {error}"),
        )
    })?;
    Ok(ImportedPlanMedia {
        file: format!("{MEDIA_DIR}/{file_name}"),
        data_url: format!("data:{};base64,{}", kind.mime_type, STANDARD.encode(bytes)),
        name: name.to_owned(),
        mime_type: kind.mime_type.to_owned(),
    })
}

pub fn load_plan_media_from(project_path: &Path, file: &str) -> Result<String, CommandError> {
    let project_path =
        canonicalize_directory(project_path, "project_not_found", "project_not_directory")?;
    let absolute = resolve_media_path(&project_path, file)?;
    let bytes = fs::read(&absolute).map_err(|error| {
        CommandError::new(
            "media_read_failed",
            format!("Unable to read the media file: {error}"),
        )
    })?;
    let name = absolute
        .file_name()
        .and_then(|entry| entry.to_str())
        .unwrap_or_default();
    let kind = media_kind(name, "").ok_or_else(|| {
        CommandError::new("media_unsupported_type", "Unsupported stored media type")
    })?;
    if bytes.len() > kind.max_bytes {
        return Err(CommandError::new(
            "media_invalid_size",
            "The stored media file exceeds its size limit",
        ));
    }
    Ok(format!(
        "data:{};base64,{}",
        kind.mime_type,
        STANDARD.encode(bytes)
    ))
}

pub fn remove_plan_media_from(project_path: &Path, file: &str) -> Result<(), CommandError> {
    let project_path =
        canonicalize_directory(project_path, "project_not_found", "project_not_directory")?;
    let absolute = resolve_media_path(&project_path, file)?;
    fs::remove_file(&absolute).map_err(|error| {
        CommandError::new(
            "media_remove_failed",
            format!("Unable to remove the media file: {error}"),
        )
    })
}

pub fn save_project_plan_in(
    project_path: &Path,
    plan: serde_json::Value,
) -> Result<ProjectManifest, CommandError> {
    let project_path =
        canonicalize_directory(project_path, "project_not_found", "project_not_directory")?;
    let mut manifest = read_manifest(&project_path)?;
    manifest.plan = Some(plan);
    manifest.updated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    write_manifest_atomically(&project_path, &manifest)?;
    Ok(manifest)
}

pub fn read_project_plan_in(project_path: &Path) -> Result<serde_json::Value, CommandError> {
    let project_path =
        canonicalize_directory(project_path, "project_not_found", "project_not_directory")?;
    Ok(read_manifest(&project_path)?
        .plan
        .unwrap_or(serde_json::Value::Null))
}

#[tauri::command]
pub fn import_reference_image(
    project_path: String,
    source_path: String,
) -> Result<ImportedImage, CommandError> {
    import_reference_image_into(Path::new(&project_path), Path::new(&source_path))
}

#[tauri::command]
pub fn load_reference_image(project_path: String, file: String) -> Result<String, CommandError> {
    load_reference_image_from(Path::new(&project_path), &file)
}

#[tauri::command]
pub fn remove_reference_image(project_path: String, file: String) -> Result<(), CommandError> {
    remove_reference_image_from(Path::new(&project_path), &file)
}

#[tauri::command]
pub fn import_plan_media(
    project_path: String,
    name: String,
    mime_type: String,
    bytes: Vec<u8>,
) -> Result<ImportedPlanMedia, CommandError> {
    import_plan_media_into(Path::new(&project_path), &name, &mime_type, &bytes)
}

#[tauri::command]
pub fn load_plan_media(project_path: String, file: String) -> Result<String, CommandError> {
    load_plan_media_from(Path::new(&project_path), &file)
}

#[tauri::command]
pub fn remove_plan_media(project_path: String, file: String) -> Result<(), CommandError> {
    remove_plan_media_from(Path::new(&project_path), &file)
}

#[tauri::command]
pub fn save_project_plan(
    project_path: String,
    plan: serde_json::Value,
) -> Result<ProjectManifest, CommandError> {
    save_project_plan_in(Path::new(&project_path), plan)
}

#[tauri::command]
pub fn read_project_plan(project_path: String) -> Result<serde_json::Value, CommandError> {
    read_project_plan_in(Path::new(&project_path))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project() -> tempfile::TempDir {
        let parent = tempfile::tempdir().unwrap();
        crate::workspace::create_project_in(parent.path(), "Shoot").unwrap();
        parent
    }

    fn write_source(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn import_copies_renumbers_and_returns_a_data_url() {
        let parent = project();
        let project_path = parent.path().join("Shoot");
        let src_dir = tempfile::tempdir().unwrap();
        let source = write_source(src_dir.path(), "photo.PNG", b"png-bytes");

        let imported = import_reference_image_into(&project_path, &source).unwrap();

        assert_eq!(imported.file, "references/0001.png");
        assert!(imported.data_url.starts_with("data:image/png;base64,"));
        assert!(
            source.exists(),
            "source should remain in its original location"
        );
        assert_eq!(fs::read(&source).unwrap(), b"png-bytes");
        assert_eq!(
            fs::read(project_path.join("references").join("0001.png")).unwrap(),
            b"png-bytes"
        );
    }

    #[test]
    fn import_rejects_unsupported_types() {
        let parent = project();
        let src_dir = tempfile::tempdir().unwrap();
        let source = write_source(src_dir.path(), "clip.gif", b"gif");

        let error = import_reference_image_into(&parent.path().join("Shoot"), &source).unwrap_err();
        assert_eq!(error.code, "reference_unsupported_type");
    }

    #[test]
    fn imports_loads_and_removes_project_media() {
        let parent = project();
        let project_path = parent.path().join("Shoot");

        let imported =
            import_plan_media_into(&project_path, "clip.mp4", "video/mp4", b"video-bytes").unwrap();

        assert_eq!(imported.file, "media/0001.mp4");
        assert_eq!(imported.name, "clip.mp4");
        assert_eq!(imported.mime_type, "video/mp4");
        assert!(imported.data_url.starts_with("data:video/mp4;base64,"));
        assert!(project_path.join("media").join("0001.mp4").is_file());
        assert!(load_plan_media_from(&project_path, &imported.file)
            .unwrap()
            .starts_with("data:video/mp4;base64,"));
        remove_plan_media_from(&project_path, &imported.file).unwrap();
        assert!(!project_path.join("media").join("0001.mp4").exists());
    }

    #[test]
    fn rejects_mismatched_project_media_types() {
        let parent = project();
        let error = import_plan_media_into(
            &parent.path().join("Shoot"),
            "clip.mp4",
            "audio/mpeg",
            b"bytes",
        )
        .unwrap_err();

        assert_eq!(error.code, "media_unsupported_type");
    }

    #[test]
    fn load_rejects_paths_outside_references() {
        let parent = project();
        let project_path = parent.path().join("Shoot");
        for bad in [
            "../.preshot",
            "references/../.preshot",
            "C:\\evil.png",
            "other/0001.png",
        ] {
            assert_eq!(
                load_reference_image_from(&project_path, bad)
                    .unwrap_err()
                    .code,
                "reference_invalid_path",
                "expected rejection for {bad}"
            );
        }
    }

    #[test]
    fn save_then_read_round_trips_opaque_plan_json() {
        let parent = project();
        let project_path = parent.path().join("Shoot");
        let plan = serde_json::json!({
            "schemaVersion": 2,
            "components": [
                { "id": "a", "type": "plan", "widthFraction": "1", "height": 200, "html": "<p>hi</p>" }
            ]
        });
        let manifest = save_project_plan_in(&project_path, plan.clone()).unwrap();
        assert_eq!(manifest.plan.as_ref().unwrap(), &plan);
        assert_eq!(read_project_plan_in(&project_path).unwrap(), plan);
    }

    #[test]
    fn read_plan_defaults_to_null_when_absent() {
        let parent = project();
        assert!(read_project_plan_in(&parent.path().join("Shoot"))
            .unwrap()
            .is_null());
    }
}
