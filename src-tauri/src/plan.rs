use std::{
    fs,
    io::{Cursor, Write},
    path::{Component, Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::{SecondsFormat, Utc};
use image::{GenericImageView, ImageFormat};
use uuid::Uuid;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceCropBounds {
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CroppedReferenceImage {
    pub file: String,
    pub data_url: String,
    pub width: u32,
    pub height: u32,
    pub transaction_id: String,
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

fn format_for_reference(path: &Path) -> Option<ImageFormat> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => Some(ImageFormat::Jpeg),
        "png" => Some(ImageFormat::Png),
        _ => None,
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

#[cfg(windows)]
fn replace_file_atomically(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let temporary = temporary
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            temporary.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file_atomically(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(temporary, destination)
}

fn write_reference_atomically(destination: &Path, bytes: &[u8]) -> Result<(), CommandError> {
    let parent = destination.parent().ok_or_else(|| {
        CommandError::new(
            "reference_crop_write_failed",
            "Reference image has no parent directory",
        )
    })?;
    let file_name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(reference_path_error)?;
    let temporary = parent.join(format!(".{file_name}.crop-{}.tmp", Uuid::new_v4()));
    let write_result = (|| {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary);
        return Err(CommandError::new(
            "reference_crop_write_failed",
            format!("Unable to write the cropped reference image: {error}"),
        ));
    }
    if let Err(error) = replace_file_atomically(&temporary, destination) {
        let _ = fs::remove_file(&temporary);
        return Err(CommandError::new(
            "reference_crop_commit_failed",
            format!("Unable to replace the reference image atomically: {error}"),
        ));
    }
    Ok(())
}

fn reference_crop_backup_path(
    destination: &Path,
    transaction_id: Uuid,
) -> Result<PathBuf, CommandError> {
    let parent = destination.parent().ok_or_else(|| {
        CommandError::new(
            "reference_crop_backup_failed",
            "Reference image has no parent directory",
        )
    })?;
    let file_name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(reference_path_error)?;
    Ok(parent.join(format!(".{file_name}.crop-backup-{transaction_id}")))
}

fn write_reference_crop_backup(
    destination: &Path,
    bytes: &[u8],
    transaction_id: Uuid,
) -> Result<PathBuf, CommandError> {
    let backup = reference_crop_backup_path(destination, transaction_id)?;
    let write_result = (|| {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&backup)?;
        file.write_all(bytes)?;
        file.sync_all()
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&backup);
        return Err(CommandError::new(
            "reference_crop_backup_failed",
            format!("Unable to back up the reference image before cropping: {error}"),
        ));
    }
    Ok(backup)
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

pub fn crop_reference_image_in(
    project_path: &Path,
    file: &str,
    bounds: ReferenceCropBounds,
) -> Result<CroppedReferenceImage, CommandError> {
    let project_path =
        canonicalize_directory(project_path, "project_not_found", "project_not_directory")?;
    let absolute = resolve_reference_path(&project_path, file)?;
    let format = format_for_reference(&absolute).ok_or_else(|| {
        CommandError::new(
            "reference_crop_unsupported_type",
            "Only project JPG and PNG reference images can be cropped",
        )
    })?;
    let original = fs::read(&absolute).map_err(|error| {
        CommandError::new(
            "reference_crop_read_failed",
            format!("Unable to read the reference image for cropping: {error}"),
        )
    })?;
    if original.len() as u64 > MAX_REFERENCE_BYTES {
        return Err(CommandError::new(
            "reference_too_large",
            "The reference image exceeds the 16 MiB limit",
        ));
    }
    let decoded = image::load_from_memory_with_format(&original, format).map_err(|error| {
        CommandError::new(
            "reference_crop_decode_failed",
            format!("Unable to decode the reference image for cropping: {error}"),
        )
    })?;
    let (source_width, source_height) = decoded.dimensions();
    let converted = (
        u32::try_from(bounds.x),
        u32::try_from(bounds.y),
        u32::try_from(bounds.width),
        u32::try_from(bounds.height),
    );
    let (x, y, width, height) = match converted {
        (Ok(x), Ok(y), Ok(width), Ok(height)) if width > 0 && height > 0 => (x, y, width, height),
        _ => {
            return Err(CommandError::new(
                "reference_crop_invalid_bounds",
                format!(
                    "Crop bounds must be positive integers inside the {source_width}x{source_height} reference image"
                ),
            ));
        }
    };
    let right = x.checked_add(width);
    let bottom = y.checked_add(height);
    if right.is_none_or(|value| value > source_width)
        || bottom.is_none_or(|value| value > source_height)
    {
        return Err(CommandError::new(
            "reference_crop_invalid_bounds",
            format!(
                "Crop bounds must fit inside the {source_width}x{source_height} reference image"
            ),
        ));
    }

    let cropped = decoded.crop_imm(x, y, width, height);
    let mut encoded = Cursor::new(Vec::new());
    cropped.write_to(&mut encoded, format).map_err(|error| {
        CommandError::new(
            "reference_crop_encode_failed",
            format!("Unable to encode the cropped reference image: {error}"),
        )
    })?;
    let encoded = encoded.into_inner();
    if encoded.len() as u64 > MAX_REFERENCE_BYTES {
        return Err(CommandError::new(
            "reference_crop_too_large",
            "The cropped reference image exceeds the 16 MiB limit",
        ));
    }
    let transaction_id = Uuid::new_v4();
    let backup = write_reference_crop_backup(&absolute, &original, transaction_id)?;
    if let Err(error) = write_reference_atomically(&absolute, &encoded) {
        let _ = fs::remove_file(backup);
        return Err(error);
    }

    Ok(CroppedReferenceImage {
        file: file.to_owned(),
        data_url: format!(
            "data:{};base64,{}",
            mime_for_reference(file),
            STANDARD.encode(encoded)
        ),
        width,
        height,
        transaction_id: transaction_id.to_string(),
    })
}

fn crop_transaction_id(value: &str) -> Result<Uuid, CommandError> {
    Uuid::parse_str(value).map_err(|_| {
        CommandError::new(
            "reference_crop_invalid_transaction",
            "Reference crop transaction identifier is invalid",
        )
    })
}

pub fn commit_reference_image_crop_in(
    project_path: &Path,
    file: &str,
    transaction_id: &str,
) -> Result<(), CommandError> {
    let project_path =
        canonicalize_directory(project_path, "project_not_found", "project_not_directory")?;
    let absolute = resolve_reference_path(&project_path, file)?;
    let backup = reference_crop_backup_path(&absolute, crop_transaction_id(transaction_id)?)?;
    match fs::remove_file(backup) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(CommandError::new(
            "reference_crop_commit_cleanup_failed",
            format!("Unable to finalize the reference image crop: {error}"),
        )),
    }
}

pub fn rollback_reference_image_crop_in(
    project_path: &Path,
    file: &str,
    transaction_id: &str,
) -> Result<(), CommandError> {
    let project_path =
        canonicalize_directory(project_path, "project_not_found", "project_not_directory")?;
    let absolute = resolve_reference_path(&project_path, file)?;
    let backup = reference_crop_backup_path(&absolute, crop_transaction_id(transaction_id)?)?;
    replace_file_atomically(&backup, &absolute).map_err(|error| {
        CommandError::new(
            "reference_crop_rollback_failed",
            format!("Unable to restore the original reference image atomically: {error}"),
        )
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
pub fn crop_reference_image(
    project_path: String,
    file: String,
    bounds: ReferenceCropBounds,
) -> Result<CroppedReferenceImage, CommandError> {
    crop_reference_image_in(Path::new(&project_path), &file, bounds)
}

#[tauri::command]
pub fn commit_reference_image_crop(
    project_path: String,
    file: String,
    transaction_id: String,
) -> Result<(), CommandError> {
    commit_reference_image_crop_in(Path::new(&project_path), &file, &transaction_id)
}

#[tauri::command]
pub fn rollback_reference_image_crop(
    project_path: String,
    file: String,
    transaction_id: String,
) -> Result<(), CommandError> {
    rollback_reference_image_crop_in(Path::new(&project_path), &file, &transaction_id)
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

    fn image_bytes(format: ImageFormat) -> Vec<u8> {
        let image = image::RgbImage::from_fn(4, 3, |x, y| {
            image::Rgb([(x * 40) as u8, (y * 60) as u8, ((x + y) * 30) as u8])
        });
        let mut bytes = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(image)
            .write_to(&mut bytes, format)
            .unwrap();
        bytes.into_inner()
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
    fn crop_rewrites_the_same_project_file_and_preserves_the_external_source() {
        for (extension, format) in [("png", ImageFormat::Png), ("jpg", ImageFormat::Jpeg)] {
            let parent = project();
            let project_path = parent.path().join("Shoot");
            let src_dir = tempfile::tempdir().unwrap();
            let source_bytes = image_bytes(format);
            let source = write_source(src_dir.path(), &format!("photo.{extension}"), &source_bytes);
            let imported = import_reference_image_into(&project_path, &source).unwrap();
            let before = fs::read(project_path.join(&imported.file)).unwrap();

            let cropped = crop_reference_image_in(
                &project_path,
                &imported.file,
                ReferenceCropBounds {
                    x: 1,
                    y: 1,
                    width: 2,
                    height: 2,
                },
            )
            .unwrap();

            assert_eq!(cropped.file, imported.file);
            assert_eq!((cropped.width, cropped.height), (2, 2));
            assert!(cropped.data_url.starts_with(&format!(
                "data:{};base64,",
                mime_for_reference(&cropped.file)
            )));
            assert_eq!(fs::read(&source).unwrap(), source_bytes);
            let rewritten = fs::read(project_path.join(&cropped.file)).unwrap();
            assert_ne!(rewritten, before);
            assert_eq!(
                image::load_from_memory_with_format(&rewritten, format)
                    .unwrap()
                    .dimensions(),
                (2, 2)
            );
            commit_reference_image_crop_in(&project_path, &cropped.file, &cropped.transaction_id)
                .unwrap();
            commit_reference_image_crop_in(&project_path, &cropped.file, &cropped.transaction_id)
                .unwrap();
            assert!(fs::read_dir(project_path.join("references"))
                .unwrap()
                .flatten()
                .all(|entry| !entry.file_name().to_string_lossy().contains(".crop-")));
        }
    }

    #[test]
    fn crop_rollback_atomically_restores_exact_original_bytes() {
        let parent = project();
        let project_path = parent.path().join("Shoot");
        let references = project_path.join("references");
        fs::create_dir_all(&references).unwrap();
        let destination = references.join("0001.png");
        let original = image_bytes(ImageFormat::Png);
        fs::write(&destination, &original).unwrap();

        let cropped = crop_reference_image_in(
            &project_path,
            "references/0001.png",
            ReferenceCropBounds {
                x: 1,
                y: 1,
                width: 2,
                height: 2,
            },
        )
        .unwrap();
        assert_ne!(fs::read(&destination).unwrap(), original);

        rollback_reference_image_crop_in(&project_path, &cropped.file, &cropped.transaction_id)
            .unwrap();

        assert_eq!(fs::read(&destination).unwrap(), original);
        assert_eq!(fs::read_dir(references).unwrap().count(), 1);
    }

    #[test]
    fn crop_transaction_commands_reject_untrusted_identifiers() {
        let parent = project();
        let project_path = parent.path().join("Shoot");
        let references = project_path.join("references");
        fs::create_dir_all(&references).unwrap();
        fs::write(references.join("0001.png"), image_bytes(ImageFormat::Png)).unwrap();

        let error =
            rollback_reference_image_crop_in(&project_path, "references/0001.png", "..\\outside")
                .unwrap_err();

        assert_eq!(error.code, "reference_crop_invalid_transaction");
    }

    #[test]
    fn crop_rejects_out_of_bounds_without_changing_original_bytes() {
        let parent = project();
        let project_path = parent.path().join("Shoot");
        let references = project_path.join("references");
        fs::create_dir_all(&references).unwrap();
        let destination = references.join("0001.png");
        fs::write(&destination, image_bytes(ImageFormat::Png)).unwrap();
        let before = fs::read(&destination).unwrap();

        for bounds in [
            ReferenceCropBounds {
                x: 3,
                y: 1,
                width: 2,
                height: 2,
            },
            ReferenceCropBounds {
                x: -1,
                y: 0,
                width: 1,
                height: 1,
            },
            ReferenceCropBounds {
                x: 0,
                y: 0,
                width: 0,
                height: 1,
            },
            ReferenceCropBounds {
                x: 0,
                y: 0,
                width: 1,
                height: 0,
            },
            ReferenceCropBounds {
                x: 0,
                y: 2,
                width: 1,
                height: 2,
            },
        ] {
            let error =
                crop_reference_image_in(&project_path, "references/0001.png", bounds).unwrap_err();
            assert_eq!(error.code, "reference_crop_invalid_bounds");
            assert_eq!(fs::read(&destination).unwrap(), before);
        }
    }

    #[test]
    fn atomic_reference_write_replaces_bytes_without_leaving_temporary_files() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("0001.png");
        fs::write(&destination, b"before").unwrap();

        write_reference_atomically(&destination, b"after").unwrap();

        assert_eq!(fs::read(&destination).unwrap(), b"after");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn crop_rejects_invalid_images_and_paths_without_replacing_files() {
        let parent = project();
        let project_path = parent.path().join("Shoot");
        let references = project_path.join("references");
        fs::create_dir_all(&references).unwrap();
        let destination = references.join("0001.png");
        fs::write(&destination, b"not-an-image").unwrap();

        let decode_error = crop_reference_image_in(
            &project_path,
            "references/0001.png",
            ReferenceCropBounds {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
            },
        )
        .unwrap_err();
        assert_eq!(decode_error.code, "reference_crop_decode_failed");
        assert_eq!(fs::read(&destination).unwrap(), b"not-an-image");

        let path_error = crop_reference_image_in(
            &project_path,
            "../outside.png",
            ReferenceCropBounds {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
            },
        )
        .unwrap_err();
        assert_eq!(path_error.code, "reference_invalid_path");
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
