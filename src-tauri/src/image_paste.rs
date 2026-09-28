use std::{
    fs,
    path::{Path, PathBuf},
};

use image::ImageFormat;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{error::CommandError, library::files, workspace::ProjectManifest};

#[cfg(test)]
#[path = "image_paste_tests.rs"]
mod tests;
#[path = "image_paste_validation.rs"]
mod validation;

type Result<T> = std::result::Result<T, CommandError>;
const JOURNAL_DIR: &str = ".preshot-image-paste";
const MAX_IMAGE_BYTES: usize = 16 * 1024 * 1024;
static IMAGE_DECODE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn error(code: &str, message: impl Into<String>) -> CommandError {
    CommandError::new(&format!("image_paste_{code}"), message)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Destination {
    Media,
    References,
}

impl Destination {
    fn directory(self) -> &'static str {
        match self {
            Self::Media => "media",
            Self::References => "references",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PasteImage {
    pub name: String,
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedImagePaste {
    pub operation_id: String,
    pub file: String,
    pub name: String,
    pub mime_type: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PasteStatus {
    Prepared,
    Committed,
    Aborted,
    Missing,
}

#[derive(Debug, Serialize)]
pub struct ImagePasteStatus {
    pub status: PasteStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Phase {
    Preparing,
    Prepared,
    Committing,
    Committed,
    Aborting,
    Aborted,
    Conflict,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Journal {
    version: u32,
    project_id: String,
    phase: Phase,
    destination: Destination,
    base_plan: Value,
    next_plan: Option<Value>,
    prepared: PreparedImagePaste,
    hash: String,
    byte_length: usize,
    published: bool,
    publishing: bool,
    #[serde(default)]
    cleanup_staged: bool,
}

fn manifest(project: &Path) -> Result<ProjectManifest> {
    let bytes = files::read_limited(&project.join(".preshotproj"), 34 * 1024 * 1024)?;
    let manifest: ProjectManifest = serde_json::from_slice(&bytes).map_err(|_| {
        error(
            "manifest",
            "Preserve the project and paste journal; the current manifest cannot be read",
        )
    })?;
    if manifest.schema_version != 1
        || uuid::Uuid::parse_str(&manifest.id).is_err()
        || manifest.name.trim().is_empty()
        || chrono::DateTime::parse_from_rfc3339(&manifest.created_at).is_err()
        || chrono::DateTime::parse_from_rfc3339(&manifest.updated_at).is_err()
    {
        return Err(error(
            "manifest",
            "Image paste requires a valid current .preshotproj manifest",
        ));
    }
    Ok(manifest)
}

fn check_base(project: &Path, project_id: &str, expected: &Value) -> Result<ProjectManifest> {
    let current = manifest(project)?;
    if current.id != project_id || current.plan.as_ref() != Some(expected) {
        return Err(error(
            "stale_plan",
            "The committed project changed; refresh before pasting again",
        ));
    }
    Ok(current)
}

fn image_kind(
    name: &str,
    mime: &str,
    destination: Destination,
) -> Result<(&'static str, ImageFormat)> {
    if name.is_empty()
        || name.encode_utf16().count() > 255
        || name
            .chars()
            .any(|c| c.is_control() || "\\/:<>\"|?*%".contains(c))
        || name.ends_with([' ', '.'])
    {
        return Err(error(
            "image_name",
            "Image name must be a portable filename, not a source path",
        ));
    }
    let extension = Path::new(name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match (extension.as_str(), mime, destination) {
        ("png", "image/png", _) => Ok(("png", ImageFormat::Png)),
        ("jpg" | "jpeg", "image/jpeg", _) => Ok(("jpg", ImageFormat::Jpeg)),
        ("gif", "image/gif", Destination::Media) => Ok(("gif", ImageFormat::Gif)),
        ("webp", "image/webp", Destination::Media) => Ok(("webp", ImageFormat::WebP)),
        _ => Err(error(
            "image_format",
            "Paste requires matching JPEG/PNG bytes; native media also supports GIF/WebP",
        )),
    }
}

fn validate_image(image: &PasteImage, destination: Destination) -> Result<&'static str> {
    let (extension, format) = image_kind(&image.name, &image.mime_type, destination)?;
    if image.bytes.is_empty() || image.bytes.len() > MAX_IMAGE_BYTES {
        return Err(error("image_size", "Paste one image of at most 16 MiB"));
    }
    if image::guess_format(&image.bytes).ok() != Some(format) {
        return Err(error(
            "image_format",
            "Image signature does not match its declared format",
        ));
    }
    let _decode = IMAGE_DECODE_LOCK.lock().map_err(|_| {
        error(
            "image_decode",
            "Image decoding is unavailable; restart before retrying",
        )
    })?;
    let (width, height) =
        crate::image_clipboard::validate_encoded_image_dimensions(&image.bytes, &image.mime_type)
            .map_err(|cause| {
            if cause.code == "image_clipboard_oversized" {
                error(
                "image_dimensions",
                "Image exceeds the dimension or bounded decoder-memory limits; use a smaller image",
            )
            } else {
                error(
                    "image_decode",
                    format!(
                        "Unable to safely validate the paste image: {}",
                        cause.message
                    ),
                )
            }
        })?;
    if width == 0
        || height == 0
        || width > 8192
        || height > 8192
        || u64::from(width) * u64::from(height) > 32_000_000
    {
        return Err(error(
            "image_dimensions",
            "Image exceeds the 8192px / 32-million-pixel limit",
        ));
    }
    Ok(extension)
}

fn owned_name(journal: &Journal) -> Result<&str> {
    let (extension, _) = image_kind(
        &journal.prepared.name,
        &journal.prepared.mime_type,
        journal.destination,
    )?;
    let prefix = format!("{}/", journal.destination.directory());
    let name = journal.prepared.file.strip_prefix(&prefix).ok_or_else(|| {
        error(
            "journal_corrupt",
            "Prepared image is outside its destination",
        )
    })?;
    let Some(stem) = name.strip_suffix(&format!(".{extension}")) else {
        return Err(error(
            "journal_corrupt",
            "Prepared image has an invalid extension",
        ));
    };
    if stem.is_empty()
        || !stem.bytes().all(|byte| byte.is_ascii_digit())
        || stem.parse::<u32>().ok().is_none_or(|number| number == 0)
    {
        return Err(error(
            "journal_corrupt",
            "Prepared image has an invalid allocated filename",
        ));
    }
    Ok(name)
}

fn owned_path(project: &Path, journal: &Journal) -> Result<PathBuf> {
    let path = project
        .join(journal.destination.directory())
        .join(owned_name(journal)?);
    files::check_leaf(&path)?;
    Ok(path)
}

fn read(project: &Path, operation: &str) -> Result<Option<Journal>> {
    files::uuid(operation)?;
    let root = project.join(JOURNAL_DIR);
    files::check_leaf(&root)?;
    if !root
        .try_exists()
        .map_err(|_| error("journal", "Unable to inspect paste journal"))?
    {
        return Ok(None);
    }
    let path = root.join(format!("{operation}.json"));
    files::check_leaf(&path)?;
    if !path
        .try_exists()
        .map_err(|_| error("journal", "Unable to inspect paste receipt"))?
    {
        return Ok(None);
    }
    let bytes = files::read_limited(&path, 68 * 1024 * 1024)?;
    let journal: Journal = serde_json::from_slice(&bytes).map_err(|_| {
        error(
            "journal_corrupt",
            "Preserve .preshot-image-paste; its recovery receipt is invalid",
        )
    })?;
    if journal.version != 1
        || journal.prepared.operation_id != operation
        || journal.project_id.is_empty()
        || journal.byte_length == 0
        || journal.byte_length > MAX_IMAGE_BYTES
        || journal.hash.len() != 64
        || !journal.hash.bytes().all(|b| b.is_ascii_hexdigit())
        || journal.published && journal.publishing
        || journal.phase == Phase::Aborting && journal.publishing
        || journal.cleanup_staged
            && (journal.published
                || !matches!(
                    journal.phase,
                    Phase::Aborting | Phase::Aborted | Phase::Conflict
                ))
        || matches!(
            journal.phase,
            Phase::Prepared | Phase::Committing | Phase::Committed
        ) && (!journal.published || journal.publishing)
        || matches!(journal.phase, Phase::Committing | Phase::Committed)
            && journal.next_plan.is_none()
        || matches!(journal.phase, Phase::Preparing | Phase::Prepared)
            && journal.next_plan.is_some()
    {
        return Err(error(
            "journal_corrupt",
            "Paste ownership and publication progress are inconsistent",
        ));
    }
    validation::plan(&journal.base_plan)?;
    owned_name(&journal)?;
    if contains_file(&journal.base_plan, &journal.prepared.file) {
        return Err(error(
            "journal_corrupt",
            "Prepared file was already referenced by its base",
        ));
    }
    if let Some(next) = &journal.next_plan {
        validation::insertion(
            &journal.base_plan,
            next,
            journal.destination,
            &journal.prepared,
        )?;
    }
    Ok(Some(journal))
}

fn write(project: &Path, journal: &Journal) -> Result<()> {
    files::uuid(&journal.prepared.operation_id)?;
    let root = files::child_dir(project, JOURNAL_DIR)?;
    files::atomic(
        &root.join(format!("{}.json", journal.prepared.operation_id)),
        &serde_json::to_vec(journal)
            .map_err(|_| error("journal", "Unable to encode paste recovery receipt"))?,
    )
}

fn journal_operations(project: &Path) -> Result<Vec<String>> {
    let root = project.join(JOURNAL_DIR);
    files::check_leaf(&root)?;
    if !root
        .try_exists()
        .map_err(|_| error("journal", "Unable to inspect paste journal"))?
    {
        return Ok(Vec::new());
    }
    files::directory(&root)?;
    let mut result = Vec::new();
    for entry in
        fs::read_dir(root).map_err(|_| error("journal", "Unable to enumerate paste receipts"))?
    {
        let path = entry
            .map_err(|_| error("journal", "Unable to inspect paste receipt"))?
            .path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let operation = path
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or_else(|| error("journal", "Invalid paste receipt name"))?;
        files::uuid(operation)?;
        result.push(operation.to_owned());
    }
    Ok(result)
}

fn read_required(project: &Path, operation: &str) -> Result<Journal> {
    read(project, operation)?.ok_or_else(|| error("journal", "Paste receipt disappeared"))
}

fn staging(project: &Path, operation: &str) -> PathBuf {
    project.join(JOURNAL_DIR).join(format!("{operation}.copy"))
}

fn contains_file(value: &Value, file: &str) -> bool {
    match value {
        Value::String(value) => value.replace('\\', "/").eq_ignore_ascii_case(file),
        Value::Array(values) => values.iter().any(|value| contains_file(value, file)),
        Value::Object(values) => values.values().any(|value| contains_file(value, file)),
        _ => false,
    }
}

fn conflict(project: &Path, journal: &mut Journal) -> Result<()> {
    journal.phase = Phase::Conflict;
    write(project, journal)?;
    Err(error("conflict", "Paste recovery conflicts with current project content. Nothing was overwritten; preserve .preshot-image-paste and resolve recovery before editing"))
}

fn verify_owned(project: &Path, journal: &Journal) -> Result<()> {
    let bytes = files::read_limited(&owned_path(project, journal)?, MAX_IMAGE_BYTES)?;
    if bytes.len() != journal.byte_length || files::hash(&bytes) != journal.hash {
        return Err(error(
            "image_changed",
            "Prepared image bytes changed; preserve the paste recovery receipt",
        ));
    }
    Ok(())
}

fn observe(
    project: &Path,
    journal: &mut Journal,
    current: &ProjectManifest,
) -> Result<PasteStatus> {
    if current.id != journal.project_id || journal.phase == Phase::Conflict {
        conflict(project, journal)?;
    }
    match journal.phase {
        Phase::Committed => {
            verify_owned(project, journal)?;
            return Ok(PasteStatus::Committed);
        }
        Phase::Aborted => return Ok(PasteStatus::Aborted),
        _ => (),
    }
    if journal.phase == Phase::Committing && journal.next_plan.as_ref() == current.plan.as_ref() {
        if verify_owned(project, journal).is_err() {
            conflict(project, journal)?;
        }
        journal.phase = Phase::Committed;
        write(project, journal)?;
        return Ok(PasteStatus::Committed);
    }
    if current.plan.as_ref() != Some(&journal.base_plan) {
        conflict(project, journal)?;
    }
    Ok(PasteStatus::Prepared)
}

fn cleanup(project: &Path, journal: &mut Journal, current: &ProjectManifest) -> Result<()> {
    cleanup_with_writer(project, journal, current, write)
}

fn cleanup_with_writer(
    project: &Path,
    journal: &mut Journal,
    current: &ProjectManifest,
    mut write_journal: impl FnMut(&Path, &Journal) -> Result<()>,
) -> Result<()> {
    if current.id != journal.project_id || current.plan.as_ref() != Some(&journal.base_plan) {
        return conflict(project, journal);
    }
    let staged = staging(project, &journal.prepared.operation_id);
    files::check_leaf(&staged)?;
    let staged_exists = staged
        .try_exists()
        .map_err(|_| error("cleanup", "Unable to inspect owned staged image"))?;
    let resuming_cleanup = journal.phase == Phase::Aborting;
    let owns_staging = if resuming_cleanup {
        journal.cleanup_staged
    } else {
        journal.publishing
    };
    if staged_exists && !owns_staging {
        // A crash before the publication receipt cannot distinguish a partial
        // app write from a pre-existing or externally replaced staging file.
        return conflict(project, journal);
    }
    if staged_exists {
        let bytes = files::read_limited(&staged, MAX_IMAGE_BYTES)?;
        if bytes.len() != journal.byte_length || files::hash(&bytes) != journal.hash {
            return conflict(project, journal);
        }
    }
    let published = journal.published || !resuming_cleanup && journal.publishing && !staged_exists;
    let owned = if published {
        let path = owned_path(project, journal)?;
        if path
            .try_exists()
            .map_err(|_| error("cleanup", "Unable to inspect owned image"))?
        {
            if verify_owned(project, journal).is_err() {
                return conflict(project, journal);
            }
            Some(path)
        } else {
            None
        }
    } else {
        None
    };
    if !resuming_cleanup {
        // Resolve publication while staging still proves whether a no-replace move
        // collided. Recovery must never treat cleanup's deletion as a successful move.
        journal.published = published;
        journal.publishing = false;
        journal.cleanup_staged = staged_exists;
        journal.phase = Phase::Aborting;
        write_journal(project, journal)?;
    }
    if let Some(path) = owned {
        fs::remove_file(path)
            .map_err(|_| error("cleanup", "Unable to remove the aborted paste image"))?;
    }
    if staged_exists {
        fs::remove_file(staged)
            .map_err(|_| error("cleanup", "Unable to remove the aborted staged image"))?;
    }
    journal.phase = Phase::Aborted;
    write_journal(project, journal)
}

pub(crate) fn before_regular_mutation(project: &Path) -> Result<()> {
    let all = journal_operations(project)?;
    if all.is_empty() {
        return Ok(());
    }
    let current = manifest(project)?;
    for operation in all {
        let mut journal = read_required(project, &operation)?;
        if observe(project, &mut journal, &current)? == PasteStatus::Prepared {
            cleanup(project, &mut journal, &current)?;
        }
    }
    Ok(())
}

pub(crate) fn reconcile_project(project: &Path) -> Result<()> {
    before_regular_mutation(project)
}

pub(crate) fn retain_file_for_history(project: &Path, file: &str) -> Result<bool> {
    let file = file.replace('\\', "/");
    for operation in journal_operations(project)? {
        let journal = read_required(project, &operation)?;
        if !journal.prepared.file.eq_ignore_ascii_case(&file) {
            continue;
        }
        match journal.phase {
            Phase::Committed => return Ok(true),
            Phase::Aborted => (),
            _ => return Err(error("reserved", "The image belongs to unresolved paste recovery; finish or abort it before modifying its file")),
        }
    }
    Ok(false)
}

fn allocate(
    project: &Path,
    destination: Destination,
    extension: &str,
    base: &Value,
) -> Result<String> {
    let root = files::child_dir(project, destination.directory())?;
    let mut number = 0u32;
    for entry in fs::read_dir(root)
        .map_err(|_| error("allocate", "Unable to inspect destination image filenames"))?
    {
        let path = entry
            .map_err(|_| error("allocate", "Unable to inspect destination image filename"))?
            .path();
        if let Some(value) = path
            .file_stem()
            .and_then(|s| s.to_str())
            .and_then(|s| s.parse::<u32>().ok())
        {
            number = number.max(value);
        }
    }
    for operation in journal_operations(project)? {
        let journal = read_required(project, &operation)?;
        if journal.destination == destination {
            let path = Path::new(&journal.prepared.file);
            if let Some(value) = path
                .file_stem()
                .and_then(|s| s.to_str())
                .and_then(|s| s.parse::<u32>().ok())
            {
                number = number.max(value);
            }
        }
    }
    loop {
        number = number
            .checked_add(1)
            .ok_or_else(|| error("allocate", "Destination image numbers are exhausted"))?;
        let file = format!("{}/{number:04}.{extension}", destination.directory());
        if !contains_file(base, &file) {
            return Ok(file);
        }
    }
}

fn prepare_in(
    project: &Path,
    operation: &str,
    expected: Value,
    destination: Destination,
    image: PasteImage,
) -> Result<PreparedImagePaste> {
    files::uuid(operation)?;
    validation::plan(&expected)?;
    let extension = validate_image(&image, destination)?;
    let project = files::directory(project)?;
    let _lock = files::project_lock(&project)?;
    let current = manifest(&project)?;
    if let Some(mut journal) = read(&project, operation)? {
        if journal.base_plan != expected
            || journal.destination != destination
            || journal.prepared.name != image.name
            || journal.prepared.mime_type != image.mime_type
            || journal.byte_length != image.bytes.len()
            || journal.hash != files::hash(&image.bytes)
        {
            return Err(error(
                "operation_conflict",
                "Operation ID was reused with a different image-paste request",
            ));
        }
        match observe(&project, &mut journal, &current)? {
            PasteStatus::Committed => return Ok(journal.prepared),
            PasteStatus::Prepared if journal.phase == Phase::Prepared => {
                verify_owned(&project, &journal)?;
                return Ok(journal.prepared);
            }
            PasteStatus::Prepared => {
                cleanup(&project, &mut journal, &current)?;
                return Err(error("interrupted", "Interrupted image preparation was aborted; paste again with a new operation ID"));
            }
            _ => {
                return Err(error(
                    "operation_conflict",
                    "Image paste was already aborted",
                ))
            }
        }
    }
    check_base(&project, &current.id, &expected)?;
    before_regular_mutation(&project)?;
    crate::library::before_regular_mutation(&project)?;
    let prepared = PreparedImagePaste {
        operation_id: operation.to_owned(),
        file: allocate(&project, destination, extension, &expected)?,
        name: image.name,
        mime_type: image.mime_type,
    };
    let mut journal = Journal {
        version: 1,
        project_id: current.id,
        phase: Phase::Preparing,
        destination,
        base_plan: expected,
        next_plan: None,
        prepared,
        hash: files::hash(&image.bytes),
        byte_length: image.bytes.len(),
        published: false,
        publishing: false,
        cleanup_staged: false,
    };
    write(&project, &journal)?;
    let publish = (|| {
        let staged = staging(&project, operation);
        files::write_new(&staged, &image.bytes)?;
        journal.publishing = true;
        write(&project, &journal)?;
        files::publish_new(&staged, &owned_path(&project, &journal)?)?;
        journal.publishing = false;
        journal.published = true;
        check_base(&project, &journal.project_id, &journal.base_plan)?;
        journal.phase = Phase::Prepared;
        write(&project, &journal)
    })();
    if let Err(cause) = publish {
        cleanup(&project, &mut journal, &manifest(&project)?)
            .map_err(|_| error("cleanup", "Image preparation and recovery failed; preserve the paste journal and retry recovery"))?;
        return Err(cause);
    }
    Ok(journal.prepared)
}

fn commit_in(project: &Path, operation: &str, expected: Value, next: Value) -> Result<()> {
    files::uuid(operation)?;
    let project = files::directory(project)?;
    let _lock = files::project_lock(&project)?;
    let mut journal = read(&project, operation)?
        .ok_or_else(|| error("missing", "Prepare the image paste before committing"))?;
    if journal.base_plan != expected
        || journal
            .next_plan
            .as_ref()
            .is_some_and(|saved| saved != &next)
    {
        return Err(error(
            "operation_conflict",
            "Commit base or retry intent differs from its durable prepared operation",
        ));
    }
    validation::insertion(
        &journal.base_plan,
        &next,
        journal.destination,
        &journal.prepared,
    )?;
    match observe(&project, &mut journal, &manifest(&project)?)? {
        PasteStatus::Committed => return Ok(()),
        PasteStatus::Prepared if matches!(journal.phase, Phase::Prepared | Phase::Committing) => (),
        _ => {
            return Err(error(
                "operation_conflict",
                "Image paste is not prepared for commit",
            ))
        }
    }
    for operation in journal_operations(&project)? {
        let other = read_required(&project, &operation)?;
        if other.phase == Phase::Conflict {
            return Err(error(
                "conflict",
                "Resolve retained image-paste recovery before committing",
            ));
        }
    }
    verify_owned(&project, &journal)?;
    crate::library::before_regular_mutation(&project)?;
    let mut current = check_base(&project, &journal.project_id, &expected)?;
    journal.next_plan = Some(next.clone());
    journal.phase = Phase::Committing;
    write(&project, &journal)?;
    current.plan = Some(next);
    current.updated_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    files::atomic(
        &project.join(".preshotproj"),
        &serde_json::to_vec_pretty(&current)
            .map_err(|_| error("manifest", "Unable to encode committed manifest"))?,
    )?;
    journal.phase = Phase::Committed;
    write(&project, &journal)
}

fn status_in(project: &Path, operation: &str) -> Result<ImagePasteStatus> {
    files::uuid(operation)?;
    let project = files::directory(project)?;
    let _lock = files::project_lock(&project)?;
    let current = manifest(&project)?;
    let Some(mut journal) = read(&project, operation)? else {
        return Ok(ImagePasteStatus {
            status: PasteStatus::Missing,
        });
    };
    let status = observe(&project, &mut journal, &current)?;
    if status == PasteStatus::Prepared {
        if matches!(journal.phase, Phase::Preparing | Phase::Aborting) {
            cleanup(&project, &mut journal, &current)?;
            return Ok(ImagePasteStatus {
                status: PasteStatus::Aborted,
            });
        }
        verify_owned(&project, &journal)?;
    }
    Ok(ImagePasteStatus { status })
}

fn abort_in(project: &Path, operation: &str) -> Result<()> {
    files::uuid(operation)?;
    let project = files::directory(project)?;
    let _lock = files::project_lock(&project)?;
    let current = manifest(&project)?;
    let Some(mut journal) = read(&project, operation)? else {
        return Ok(());
    };
    match observe(&project, &mut journal, &current)? {
        PasteStatus::Aborted => Ok(()),
        PasteStatus::Prepared => cleanup(&project, &mut journal, &current),
        _ => Err(error(
            "operation_conflict",
            "Cannot abort a committed image paste or delete its retained image",
        )),
    }
}

#[tauri::command]
pub fn prepare_image_paste(
    project_path: String,
    operation_id: String,
    expected_plan: Value,
    destination: Destination,
    image: PasteImage,
) -> Result<PreparedImagePaste> {
    prepare_in(
        Path::new(&project_path),
        &operation_id,
        expected_plan,
        destination,
        image,
    )
}

#[tauri::command]
pub fn commit_image_paste(
    project_path: String,
    operation_id: String,
    expected_plan: Value,
    next_plan: Value,
) -> Result<()> {
    commit_in(
        Path::new(&project_path),
        &operation_id,
        expected_plan,
        next_plan,
    )
}

#[tauri::command]
pub fn get_image_paste_status(
    project_path: String,
    operation_id: String,
) -> Result<ImagePasteStatus> {
    status_in(Path::new(&project_path), &operation_id)
}

#[tauri::command]
pub fn abort_image_paste(project_path: String, operation_id: String) -> Result<()> {
    abort_in(Path::new(&project_path), &operation_id)
}
