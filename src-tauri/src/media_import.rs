//! Bounded IPC chunks for browser-selected originals. Each upload owns a private
//! staging file; only a validated, complete image may publish into project media.
use std::{fs::{self, OpenOptions}, io::Write, path::{Path, PathBuf}};
use serde::{Deserialize, Serialize};
use crate::{error::CommandError, library::files, original_image, plan::ImportedPlanMedia};
type Result<T> = std::result::Result<T, CommandError>;
fn error(e: impl std::fmt::Display) -> CommandError { CommandError::new("image_import", format!("Unable to import original image: {e}")) }

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Receipt { name: String, size: u64, file: Option<String>, hash: Option<String> }
fn paths(project: &str, id: &str) -> Result<(PathBuf, PathBuf, PathBuf)> {
    files::uuid(id)?;
    let project = files::directory(Path::new(project))?;
    crate::workspace::read_manifest(&project)?;
    let root = files::child_dir(&project, ".preshot-media-import")?;
    Ok((project, root.join(format!("{id}.json")), root.join(format!("{id}.part"))))
}
fn read(path: &Path) -> Result<Receipt> { serde_json::from_slice(&files::read_limited(path, 16 * 1024)?).map_err(error) }
fn write(path: &Path, receipt: &Receipt) -> Result<()> { files::atomic(path, &serde_json::to_vec(receipt).map_err(error)?) }

#[tauri::command]
pub fn begin_image_import(project_path: String, id: String, name: String, size: u64) -> Result<()> {
    if size == 0 || name.len() > 4096 { return Err(error("Empty file or invalid filename")); }
    let extension = Path::new(&name).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !matches!(extension.as_str(), "jpg" | "jpeg" | "png") { return Err(error("Select a JPG or PNG original")); }
    let (project, manifest, part) = paths(&project_path, &id)?;
    let _lock = files::project_lock(&project)?;
    if manifest.exists() || part.exists() { return Err(error("Upload identity is already in use")); }
    write(&manifest, &Receipt { name, size, file: None, hash: None })?;
    OpenOptions::new().write(true).create_new(true).open(part).map_err(error)?;
    Ok(())
}

#[tauri::command]
pub fn append_image_import(project_path: String, id: String, offset: u64, bytes: Vec<u8>) -> Result<()> {
    if bytes.is_empty() || bytes.len() > 1024 * 1024 { return Err(error("Invalid transfer chunk")); }
    let (project, manifest, part) = paths(&project_path, &id)?;
    let _lock = files::project_lock(&project)?;
    let receipt = read(&manifest)?;
    files::no_links(&part)?;
    if receipt.file.is_some() || fs::metadata(&part).map_err(error)?.len() != offset ||
        offset.checked_add(bytes.len() as u64).is_none_or(|end| end > receipt.size) { return Err(error("Upload changed; retry import")); }
    OpenOptions::new().append(true).open(part).map_err(error)?.write_all(&bytes).map_err(error)
}

fn finish(project_path: &str, id: &str) -> Result<ImportedPlanMedia> {
    let (project, manifest, part) = paths(project_path, id)?;
    let _lock = files::project_lock(&project)?;
    crate::image_paste::before_regular_mutation(&project)?;
    crate::library::before_regular_mutation(&project)?;
    let mut receipt = read(&manifest)?;
    if receipt.file.is_none() {
        let (mime, _, _) = original_image::info(&part)?;
        let (size, hash) = original_image::fingerprint(&part)?;
        if size != receipt.size { return Err(error("Incomplete original; retry import")); }
        files::child_dir(&project, "media")?;
        receipt.file = Some(format!("media/{id}.{}", if mime == "image/png" { "png" } else { "jpg" }));
        receipt.hash = Some(hash);
        write(&manifest, &receipt)?;
    }
    let file = receipt.file.as_ref().unwrap();
    // Reconstruct the only permissible destination; the receipt is not a path capability.
    if file != &format!("media/{id}.png") && file != &format!("media/{id}.jpg") { return Err(error("Invalid upload receipt")); }
    let destination = project.join(file);
    let hash = receipt.hash.as_deref().ok_or_else(|| error("Incomplete publication receipt"))?;
    if !destination.exists() {
        original_image::verify(&part, receipt.size, hash)?;
        files::publish_new(&part, &destination)?;
    }
    original_image::verify(&destination, receipt.size, hash)?;
    let (mime, _, _) = original_image::info(&destination)?;
    // Preview failure is separate from the durable original. Retrying finish is exact.
    let presentation_axes = original_image::import_axes(&destination)?;
    let (display_width, display_height) = original_image::display_dimensions(&destination, presentation_axes.unwrap_or_default())?;
    let (data_url, preview_error) = original_image::preview_result_with_axes(&destination, 2048, presentation_axes.unwrap_or_default());
    Ok(ImportedPlanMedia { file: file.clone(), name: receipt.name, mime_type: mime.into(), data_url, preview_error,
        presentation_axes, display_width: Some(display_width), display_height: Some(display_height) })
}

#[tauri::command]
pub async fn finish_image_import(project_path: String, id: String) -> Result<ImportedPlanMedia> {
    tauri::async_runtime::spawn_blocking(move || finish(&project_path, &id)).await.map_err(error)?
}

#[tauri::command]
pub fn abort_image_import(project_path: String, id: String) -> Result<()> {
    let (project, manifest, part) = paths(&project_path, &id)?;
    let _lock = files::project_lock(&project)?;
    if !manifest.exists() { return Ok(()); }
    let receipt = read(&manifest)?;
    // A committed/uncertain original is never removed by cancellation.
    if receipt.file.is_some() { return Ok(()); }
    files::check_leaf(&part)?;
    if part.exists() { fs::remove_file(&part).map_err(error)?; }
    fs::remove_file(manifest).map_err(error)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chunked_exif_original_keeps_bytes_and_returns_effective_display_metadata() {
        use base64::Engine;
        let root = tempfile::tempdir().unwrap();
        let project = crate::workspace::create_project_in(root.path(), "Camera").unwrap().path;
        let bytes = crate::original_image::test_jpeg_with_orientation(3, 2, 6);
        let id = uuid::Uuid::new_v4().to_string();
        begin_image_import(project.clone(), id.clone(), "camera.jpg".into(), bytes.len() as u64).unwrap();
        append_image_import(project.clone(), id.clone(), 0, bytes.clone()).unwrap();
        let saved = finish(&project, &id).unwrap();
        assert_eq!(saved.presentation_axes, Some(original_image::PresentationAxes::Exif));
        assert_eq!((saved.display_width, saved.display_height), (Some(2), Some(3)));
        let pixels = image::load_from_memory(&base64::engine::general_purpose::STANDARD.decode(saved.data_url.split_once(',').unwrap().1).unwrap()).unwrap();
        assert_eq!((pixels.width(), pixels.height()), (2, 3));
        assert_eq!(fs::read(Path::new(&project).join(&saved.file)).unwrap(), bytes);
        assert_eq!(finish(&project, &id).unwrap(), saved);
        abort_image_import(project.clone(), id).unwrap();
        let legacy = crate::plan::load_plan_media_from(Path::new(&project), &saved.file).unwrap();
        let pixels = image::load_from_memory(&base64::engine::general_purpose::STANDARD.decode(legacy.split_once(',').unwrap().1).unwrap()).unwrap();
        assert_eq!((pixels.width(), pixels.height()), (3, 2));
    }
    #[test]
    fn chunked_original_is_exact_and_abort_never_removes_a_published_image() {
        let root = tempfile::tempdir().unwrap();
        crate::workspace::create_project_in(root.path(), "Shoot").unwrap();
        let project = root.path().join("Shoot").to_string_lossy().into_owned();
        let id = uuid::Uuid::new_v4().to_string();
        let mut encoded = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(3, 2).write_to(&mut encoded, image::ImageFormat::Png).unwrap();
        let bytes = encoded.into_inner();
        begin_image_import(project.clone(), id.clone(), "original.png".into(), bytes.len() as u64).unwrap();
        append_image_import(project.clone(), id.clone(), 0, bytes[..20].to_vec()).unwrap();
        assert!(finish(&project, &id).is_err());
        assert!(append_image_import(project.clone(), id.clone(), 0, bytes[20..].to_vec()).is_err());
        append_image_import(project.clone(), id.clone(), 20, bytes[20..].to_vec()).unwrap();
        let saved = finish(&project, &id).unwrap();
        assert_eq!(finish(&project, &id).unwrap(), saved);
        abort_image_import(project.clone(), id).unwrap();
        assert_eq!(fs::read(Path::new(&project).join(saved.file)).unwrap(), bytes);
        let cancelled = uuid::Uuid::new_v4().to_string();
        begin_image_import(project.clone(), cancelled.clone(), "original.png".into(), 300 * 1024 * 1024).unwrap();
        append_image_import(project.clone(), cancelled.clone(), 0, bytes).unwrap();
        abort_image_import(project.clone(), cancelled.clone()).unwrap();
        assert!(!Path::new(&project).join(".preshot-media-import").join(format!("{cancelled}.part")).exists());
    }
}
