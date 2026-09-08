use std::{
    collections::HashSet,
    fs,
    io::Cursor,
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::{ImageFormat, ImageReader};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{error, files, models::*, now, search, validation, Result, Store};

// Undo retains original and staged images, including images removed from the draft.
// This session-wide budget is separate from the 128-image / 256-MiB committed limit.
const MAX_DRAFT_IMAGES: usize = 512;
const MAX_DRAFT_BYTES: u64 = 512 * 1024 * 1024;
const EDIT_DRAFT_VERSION: u32 = 1;
const CREATE_DRAFT_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Draft {
    version: u32,
    session_id: String,
    material: MaterialDetail,
    staged: Vec<MaterialImage>,
    // Write-ahead ownership: an interrupted batch is never an editable image.
    pending: Vec<MaterialImage>,
}

fn validate_image(image: &MaterialImage) -> Result<()> {
    if !matches!(image.mime_type.as_str(), "image/png" | "image/jpeg")
        || image.blob_id.len() != 64
        || !image
            .blob_id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || image.byte_length == 0
        || image.byte_length > files::MAX_IMAGE_BYTES as u64
        || image.width == 0
        || image.height == 0
        || image.width > 8192
        || image.height > 8192
        || u64::from(image.width) * u64::from(image.height) > 32_000_000
    {
        return Err(error(
            "edit_corrupt",
            "Invalid draft image metadata; preserve this session",
        ));
    }
    Ok(())
}

fn budget<'a>(
    images: impl Iterator<Item = &'a MaterialImage>,
    count_cap: usize,
    byte_cap: u64,
) -> Result<()> {
    let mut count = 0usize;
    let mut bytes = 0u64;
    for image in images {
        validate_image(image)?;
        count += 1;
        bytes = bytes
            .checked_add(image.byte_length)
            .ok_or_else(|| error("edit_limit", "Image byte budget overflow"))?;
        if count > count_cap || bytes > byte_cap {
            return Err(error("edit_limit", format!(
                "Image ownership exceeds {count_cap} images or {} MiB; save or cancel and reopen the material",
                byte_cap / (1024 * 1024)
            )));
        }
    }
    Ok(())
}

fn image_filename(image: &MaterialImage) -> Result<String> {
    files::uuid(&image.local_image_id)?;
    validate_image(image)?;
    Ok(format!(
        "{}.{}",
        image.local_image_id,
        if image.mime_type == "image/png" {
            "png"
        } else {
            "jpg"
        }
    ))
}

fn data_url(image: &MaterialImage, bytes: &[u8]) -> String {
    format!("data:{};base64,{}", image.mime_type, STANDARD.encode(bytes))
}

fn exposed(image: &MaterialImage, bytes: &[u8]) -> MaterialEditImage {
    MaterialEditImage {
        local_image_id: image.local_image_id.clone(),
        mime_type: image.mime_type.clone(),
        byte_length: image.byte_length,
        width: image.width,
        height: image.height,
        data_url: data_url(image, bytes),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn library_edit_image_budgets_bound_committed_and_undo_retained_images() {
        let image = MaterialImage {
            local_image_id: Uuid::new_v4().to_string(),
            blob_id: "a".repeat(64),
            mime_type: "image/png".into(),
            byte_length: files::MAX_IMAGE_BYTES as u64,
            width: 8192,
            height: 1,
        };
        assert!(budget(std::iter::repeat_n(&image, 16), 128, files::MAX_BATCH_BYTES).is_ok());
        assert!(budget(std::iter::repeat_n(&image, 17), 128, files::MAX_BATCH_BYTES).is_err());
        assert!(budget(
            std::iter::repeat_n(&image, 32),
            MAX_DRAFT_IMAGES,
            MAX_DRAFT_BYTES
        )
        .is_ok());
        assert!(budget(
            std::iter::repeat_n(&image, 33),
            MAX_DRAFT_IMAGES,
            MAX_DRAFT_BYTES
        )
        .is_err());
        let small = MaterialImage {
            byte_length: 1,
            ..image
        };
        assert!(budget(
            std::iter::repeat_n(&small, 128),
            128,
            files::MAX_BATCH_BYTES
        )
        .is_ok());
        assert!(budget(
            std::iter::repeat_n(&small, 129),
            128,
            files::MAX_BATCH_BYTES
        )
        .is_err());
        assert!(budget(
            std::iter::repeat_n(&small, 512),
            MAX_DRAFT_IMAGES,
            MAX_DRAFT_BYTES
        )
        .is_ok());
        assert!(budget(
            std::iter::repeat_n(&small, 513),
            MAX_DRAFT_IMAGES,
            MAX_DRAFT_BYTES
        )
        .is_err());
    }
}

impl Store {
    pub(super) fn begin_create(&self, payload: MaterialPayload) -> Result<MaterialEditSession> {
        validation::payload(&payload)?;
        if !validation::payload_images(&payload)?.is_empty() {
            return Err(error(
                "payload",
                "New material drafts must start without images; import images into the draft",
            ));
        }
        let timestamp = now();
        self.begin_draft(
            MaterialDetail {
                summary: MaterialSummary {
                    metadata: MaterialMetadata {
                        name: String::new(),
                        description: String::new(),
                        tags: Vec::new(),
                        favorite: false,
                    },
                    id: Uuid::new_v4().to_string(),
                    kind: payload.kind.clone(),
                    revision: 0,
                    metadata_version: 0,
                    created_at: timestamp,
                    updated_at: timestamp,
                    deleted_at: None,
                    image_count: 0,
                    byte_length: 0,
                    preview_state: PreviewState::Pending,
                    preview_partial: None,
                },
                payload,
                images: Vec::new(),
            },
            CREATE_DRAFT_VERSION,
        )
    }

    pub(super) fn purge_draft_references(&self) -> Result<(HashSet<String>, HashSet<String>)> {
        let root = files::directory(&self.root.join("drafts"))?;
        let mut materials = HashSet::new();
        let mut blobs = HashSet::new();
        for entry in fs::read_dir(root).map_err(|e| error("edit_read", e))? {
            let entry = entry.map_err(|e| error("edit_read", e))?;
            let name = entry.file_name();
            let session = name
                .to_str()
                .ok_or_else(|| error("edit_corrupt", "Invalid edit session name"))?;
            let draft = self.read_draft(session)?;
            materials.insert(draft.material.summary.id);
            blobs.extend(
                draft
                    .material
                    .images
                    .into_iter()
                    .chain(draft.staged)
                    .chain(draft.pending)
                    .map(|image| image.blob_id),
            );
        }
        Ok((materials, blobs))
    }

    fn draft_path(&self, session_id: &str) -> Result<PathBuf> {
        files::uuid(session_id)?;
        let path = self.root.join("drafts").join(session_id);
        files::check_leaf(&path)?;
        Ok(path)
    }

    fn read_draft(&self, session_id: &str) -> Result<Draft> {
        let path = self.draft_path(session_id)?;
        if !path.try_exists().map_err(|e| error("edit_read", e))? {
            return Err(error(
                "edit_not_found",
                "Material edit session was not found; reopen the editor",
            ));
        }
        files::directory(&path)?;
        let bytes = files::read_limited(&path.join("manifest.json"), 2 * 1024 * 1024)?;
        let draft: Draft = serde_json::from_slice(&bytes).map_err(|_| {
            error(
                "edit_corrupt",
                "Invalid material edit manifest; preserve this session",
            )
        })?;
        let creating = draft.version == CREATE_DRAFT_VERSION;
        if !matches!(draft.version, EDIT_DRAFT_VERSION | CREATE_DRAFT_VERSION)
            || draft.session_id != session_id
            || (!creating
                && (draft.material.summary.revision == 0
                    || draft.material.summary.metadata_version == 0))
            || draft.material.summary.kind != draft.material.payload.kind
            || draft.material.summary.deleted_at.is_some()
        {
            return Err(error(
                "edit_corrupt",
                "Invalid material edit identity; preserve this session",
            ));
        }
        // A v2 manifest is an immutable provisional snapshot, never a saved
        // material. Imports/crops live only in its separate staged/pending sets.
        if creating
            && (draft.material.summary.revision != 0
                || draft.material.summary.metadata_version != 0
                || !draft.material.summary.metadata.name.is_empty()
                || !draft.material.summary.metadata.description.is_empty()
                || !draft.material.summary.metadata.tags.is_empty()
                || draft.material.summary.metadata.favorite
                || !draft.material.images.is_empty()
                || draft.material.summary.preview_state != PreviewState::Pending
                || draft.material.summary.preview_partial.is_some()
                || draft.material.summary.created_at < 0
                || draft.material.summary.updated_at != draft.material.summary.created_at)
        {
            return Err(error(
                "edit_corrupt",
                "Invalid provisional material snapshot; preserve this creation session",
            ));
        }
        files::uuid(&draft.material.summary.id)?;
        validation::payload(&draft.material.payload)?;
        budget(draft.material.images.iter(), 128, files::MAX_BATCH_BYTES)?;
        let portable = validation::payload_images(&draft.material.payload)?;
        if portable.len() != draft.material.images.len()
            || portable
                .iter()
                .zip(&draft.material.images)
                .any(|(p, i)| p["localImageId"] != i.local_image_id)
            || draft.material.summary.image_count != draft.material.images.len()
            || draft.material.summary.byte_length
                != draft
                    .material
                    .images
                    .iter()
                    .map(|i| i.byte_length)
                    .sum::<u64>()
        {
            return Err(error(
                "edit_corrupt",
                "Draft snapshot image mappings are inconsistent",
            ));
        }
        let mut ids: HashSet<_> = draft
            .material
            .images
            .iter()
            .map(|i| i.local_image_id.as_str())
            .collect();
        for image in draft.staged.iter().chain(&draft.pending) {
            image_filename(image)?;
            if !ids.insert(&image.local_image_id) {
                return Err(error("edit_corrupt", "Draft has duplicate image ownership"));
            }
        }
        budget(
            draft
                .material
                .images
                .iter()
                .chain(&draft.staged)
                .chain(&draft.pending),
            MAX_DRAFT_IMAGES,
            MAX_DRAFT_BYTES,
        )?;
        Ok(draft)
    }

    fn write_draft(&self, draft: &Draft) -> Result<()> {
        let path = self.draft_path(&draft.session_id)?;
        files::directory(&path)?;
        files::atomic(
            &path.join("manifest.json"),
            &serde_json::to_vec(draft).map_err(|e| error("edit_write", e))?,
        )
    }

    fn stage_path(&self, draft: &Draft, image: &MaterialImage) -> Result<PathBuf> {
        let path = self
            .draft_path(&draft.session_id)?
            .join(image_filename(image)?);
        files::check_leaf(&path)?;
        Ok(path)
    }

    fn staged_bytes(&self, draft: &Draft, image: &MaterialImage) -> Result<Vec<u8>> {
        let bytes = files::read_limited(&self.stage_path(draft, image)?, files::MAX_IMAGE_BYTES)?;
        if bytes.len() as u64 != image.byte_length || files::hash(&bytes) != image.blob_id {
            return Err(error(
                "edit_image_corrupt",
                "Staged image was replaced or damaged; preserve this session",
            ));
        }
        let (mime, width, height) = files::image_info(&bytes, false)?;
        if mime != image.mime_type || width != image.width || height != image.height {
            return Err(error(
                "edit_image_corrupt",
                "Staged image metadata no longer matches its bytes",
            ));
        }
        Ok(bytes)
    }

    fn edit_image(&self, draft: &Draft, local_id: &str) -> Result<(MaterialImage, Vec<u8>)> {
        if let Some(image) = draft
            .material
            .images
            .iter()
            .find(|i| i.local_image_id == local_id)
        {
            return Ok((image.clone(), self.blob(image)?));
        }
        if let Some(image) = draft.staged.iter().find(|i| i.local_image_id == local_id) {
            return Ok((image.clone(), self.staged_bytes(draft, image)?));
        }
        Err(error(
            "image_not_found",
            "Image was not disclosed in this material edit session",
        ))
    }

    fn cleanup_stages(&self, draft: &Draft, images: &[MaterialImage]) -> Result<()> {
        let mut paths = Vec::new();
        for image in images {
            let path = self.stage_path(draft, image)?;
            if path.try_exists().map_err(|e| error("edit_cleanup", e))? {
                // Verify the entire batch before deleting any file, including on retry.
                self.staged_bytes(draft, image)?;
                paths.push(path);
            }
        }
        for path in paths {
            fs::remove_file(path).map_err(|e| error("edit_cleanup", e))?;
        }
        Ok(())
    }

    fn clear_pending(&self, draft: &mut Draft) -> Result<()> {
        if !draft.pending.is_empty() {
            self.cleanup_stages(draft, &draft.pending)?;
            draft.pending.clear();
            self.write_draft(draft)?;
        }
        Ok(())
    }

    fn verify_draft_entries(&self, draft: &Draft) -> Result<()> {
        let mut names = HashSet::from(["manifest.json".to_string()]);
        for image in draft.staged.iter().chain(&draft.pending) {
            names.insert(image_filename(image)?);
        }
        for entry in fs::read_dir(self.draft_path(&draft.session_id)?)
            .map_err(|e| error("edit_cleanup", e))?
        {
            let entry = entry.map_err(|e| error("edit_cleanup", e))?;
            files::no_links(&entry.path())?;
            if !entry
                .file_name()
                .to_str()
                .is_some_and(|name| names.contains(name))
            {
                return Err(error(
                    "edit_cleanup",
                    "Unrecognized files in the draft were retained; reopen the editor rather than adding images, and do not delete unrelated files",
                ));
            }
        }
        Ok(())
    }

    pub(super) fn begin_edit(
        &self,
        material_id: &str,
        revision: u32,
    ) -> Result<MaterialEditSession> {
        let material = self.revision(material_id, revision)?;
        if material.summary.deleted_at.is_some() {
            return Err(error(
                "deleted",
                "Restore this material before editing its content",
            ));
        }
        self.begin_draft(material, EDIT_DRAFT_VERSION)
    }

    fn begin_draft(&self, material: MaterialDetail, version: u32) -> Result<MaterialEditSession> {
        let draft = Draft {
            version,
            session_id: Uuid::new_v4().to_string(),
            material,
            staged: Vec::new(),
            pending: Vec::new(),
        };
        let path = self.draft_path(&draft.session_id)?;
        fs::create_dir(&path).map_err(|e| error("edit_create", e))?;
        if let Err(cause) = self.write_draft(&draft) {
            // Only an empty, just-created directory is eligible for cleanup.
            let _ = fs::remove_dir(&path);
            return Err(cause);
        }
        Ok(MaterialEditSession {
            session_id: draft.session_id,
            material: draft.material,
            is_new: (version == CREATE_DRAFT_VERSION).then_some(true),
        })
    }

    pub(super) fn load_edit_image(&self, session_id: &str, local_image_id: &str) -> Result<String> {
        let draft = self.read_draft(session_id)?;
        let (image, bytes) = self.edit_image(&draft, local_image_id)?;
        Ok(data_url(&image, &bytes))
    }

    fn stage_image(&self, draft: &mut Draft, bytes: &[u8]) -> Result<MaterialEditImage> {
        let (mime, width, height) = files::image_info(bytes, false)?;
        let image = MaterialImage {
            local_image_id: Uuid::new_v4().to_string(),
            blob_id: files::hash(bytes),
            mime_type: mime.into(),
            byte_length: bytes.len() as u64,
            width,
            height,
        };
        budget(
            draft
                .material
                .images
                .iter()
                .chain(&draft.staged)
                .chain(&draft.pending)
                .chain(std::iter::once(&image)),
            MAX_DRAFT_IMAGES,
            MAX_DRAFT_BYTES,
        )?;
        let path = self.stage_path(draft, &image)?;
        if path.try_exists().map_err(|e| error("edit_write", e))? {
            return Err(error(
                "edit_write",
                "Allocated draft image already exists; retry",
            ));
        }
        draft.pending.push(image.clone());
        self.write_draft(draft)?;
        files::atomic(&path, bytes)?;
        Ok(exposed(&image, bytes))
    }

    fn finish_batch(
        &self,
        draft: &mut Draft,
        result: Result<Vec<MaterialEditImage>>,
    ) -> Result<Vec<MaterialEditImage>> {
        match result {
            Ok(images) => {
                let mut committed = draft.clone();
                committed.staged.append(&mut committed.pending);
                if let Err(cause) = self.write_draft(&committed) {
                    self.clear_pending(draft)?;
                    return Err(cause);
                }
                Ok(images)
            }
            Err(cause) => {
                self.clear_pending(draft).map_err(|_| error("edit_cleanup",
                    "Image import failed and staged cleanup needs attention. No material content was saved; preserve or discard this session"))?;
                Err(cause)
            }
        }
    }

    pub(super) fn import_edit_images(
        &self,
        session_id: &str,
        source_paths: Vec<String>,
    ) -> Result<Vec<MaterialEditImage>> {
        if source_paths.is_empty() || source_paths.len() > 128 {
            return Err(error(
                "edit_limit",
                "Select between 1 and 128 JPG/PNG images per import",
            ));
        }
        let mut draft = self.read_draft(session_id)?;
        self.verify_draft_entries(&draft)?;
        self.clear_pending(&mut draft)?;
        let result = (|| {
            let mut images = Vec::new();
            let mut byte_length = 0u64;
            for source in source_paths {
                let source =
                    std::path::absolute(Path::new(&source)).map_err(|e| error("path", e))?;
                files::no_links(&source)?;
                let extension = source
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if !matches!(extension.as_str(), "jpg" | "jpeg" | "png") {
                    return Err(error(
                        "image_format",
                        "Only selected JPG/PNG files may be imported",
                    ));
                }
                let bytes = files::read_limited(&source, files::MAX_IMAGE_BYTES)?;
                let (mime, _, _) = files::image_info(&bytes, false)?;
                if (mime == "image/png") != (extension == "png") {
                    return Err(error(
                        "image_format",
                        "Selected image extension does not match its bytes",
                    ));
                }
                byte_length += bytes.len() as u64;
                if byte_length > files::MAX_BATCH_BYTES {
                    return Err(error(
                        "edit_limit",
                        "Imported images exceed 256 MiB per batch",
                    ));
                }
                images.push(self.stage_image(&mut draft, &bytes)?);
            }
            Ok(images)
        })();
        self.finish_batch(&mut draft, result)
    }

    pub(super) fn crop_edit_image(
        &self,
        session_id: &str,
        local_image_id: &str,
        bounds: MaterialEditCropBounds,
    ) -> Result<MaterialEditImage> {
        let mut draft = self.read_draft(session_id)?;
        self.verify_draft_entries(&draft)?;
        self.clear_pending(&mut draft)?;
        let (image, original) = self.edit_image(&draft, local_image_id)?;
        let converted = (
            u32::try_from(bounds.x),
            u32::try_from(bounds.y),
            u32::try_from(bounds.width),
            u32::try_from(bounds.height),
        );
        let (x, y, width, height) =
            match converted {
                (Ok(x), Ok(y), Ok(w), Ok(h))
                    if w > 0
                        && h > 0
                        && x.checked_add(w).is_some_and(|r| r <= image.width)
                        && y.checked_add(h).is_some_and(|b| b <= image.height) =>
                {
                    (x, y, w, h)
                }
                _ => return Err(error(
                    "crop_bounds",
                    "Crop bounds must be positive integer pixel dimensions inside the source image",
                )),
            };
        let format = if image.mime_type == "image/png" {
            ImageFormat::Png
        } else {
            ImageFormat::Jpeg
        };
        let mut reader = ImageReader::with_format(Cursor::new(&original), format);
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(8192);
        limits.max_image_height = Some(8192);
        limits.max_alloc = Some(128 * 1024 * 1024);
        reader.limits(limits);
        let decoded = reader.decode().map_err(|e| error("image_decode", e))?;
        let cropped = decoded.crop_imm(x, y, width, height);
        let mut encoded = Cursor::new(Vec::new());
        cropped
            .write_to(&mut encoded, format)
            .map_err(|e| error("image_encode", e))?;
        let result = self
            .stage_image(&mut draft, encoded.get_ref())
            .map(|i| vec![i]);
        self.finish_batch(&mut draft, result)
            .map(|mut images| images.remove(0))
    }

    pub(super) fn commit_edit(&mut self, input: MaterialContentUpdate) -> Result<MaterialDetail> {
        files::uuid(&input.operation_id)?;
        let serialized = serde_json::to_vec(&input).map_err(|e| error("validation", e))?;
        if serialized.len() > 2 * 1024 * 1024 {
            return Err(error(
                "payload",
                "Material content update exceeds its byte limit",
            ));
        }
        let intent = files::hash(&serialized);
        self.check_purged_operation("edit", &input.operation_id, &intent)?;
        let receipt: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT intent_hash,result_json FROM edit_receipts WHERE operation_id=?1",
                [&input.operation_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|e| error("database", e))?;
        if let Some((hash, result)) = receipt {
            if hash != intent {
                return Err(error(
                    "operation_conflict",
                    "Operation ID was reused with a different content update",
                ));
            }
            return serde_json::from_str(&result).map_err(|e| error("corrupt", e));
        }
        validation::payload(&input.payload)?;
        let draft = self.read_draft(&input.session_id)?;
        let creating = draft.version == CREATE_DRAFT_VERSION;
        let mut detail = if creating {
            let purged: bool = self
                .conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM purge_receipts WHERE material_id=?1)",
                    [&draft.material.summary.id],
                    |row| row.get(0),
                )
                .map_err(|e| error("database", e))?;
            if purged {
                return Err(error(
                    "purged",
                    "This creation draft's material was permanently deleted and cannot be recreated",
                ));
            }
            let created: bool = self
                .conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM materials WHERE id=?1)",
                    [&draft.material.summary.id],
                    |row| row.get(0),
                )
                .map_err(|e| error("database", e))?;
            if created {
                return Err(error(
                    "create_conflict",
                    "This creation draft was already saved. Reopen the saved material before making another edit",
                ));
            }
            if input.metadata_update.is_none() {
                return Err(error(
                    "metadata",
                    "The first material save requires metadata with expectedVersion 0",
                ));
            }
            draft.material.clone()
        } else {
            self.revision(&draft.material.summary.id, draft.material.summary.revision)?
        };
        if detail.summary.deleted_at.is_some() {
            return Err(error(
                "deleted",
                "Restore this material before saving its content",
            ));
        }
        if input.payload.kind != draft.material.summary.kind {
            return Err(error(
                "kind",
                "Content editing cannot change the material kind",
            ));
        }
        let expected_metadata_version = detail.summary.metadata_version;
        if let Some(update) = input.metadata_update {
            if update.expected_version != expected_metadata_version {
                return Err(error(
                    "metadata_conflict",
                    "Material metadata changed; reopen the editor before saving",
                ));
            }
            detail.summary.metadata = validation::metadata(update.metadata)?;
            detail.summary.metadata_version = expected_metadata_version
                .checked_add(1)
                .ok_or_else(|| error("metadata_conflict", "Metadata version exhausted"))?;
        }
        detail.summary.revision = detail
            .summary
            .revision
            .checked_add(1)
            .ok_or_else(|| error("revision", "Material content revision exhausted"))?;
        let mut images = Vec::new();
        let mut byte_length = 0u64;
        for portable in validation::payload_images(&input.payload)? {
            let (image, bytes) =
                self.edit_image(&draft, portable["localImageId"].as_str().unwrap())?;
            byte_length += image.byte_length;
            if byte_length > files::MAX_BATCH_BYTES {
                return Err(error("edit_limit", "Material images exceed 256 MiB"));
            }
            let destination = self.object_path(&image.blob_id, &image.mime_type)?;
            if destination.try_exists().map_err(|e| error("path", e))? {
                self.blob(&image)?;
            } else {
                // Objects become durable first. Rollback may retain orphan blobs, never missing ones.
                if !creating {
                    self.remember_asset(
                        &detail.summary.id,
                        "object",
                        &image.blob_id,
                        &image.mime_type,
                    )?;
                }
                files::atomic(&destination, &bytes)?;
            }
            images.push(image);
        }
        detail.summary.updated_at = now().max(detail.summary.updated_at);
        detail.summary.image_count = images.len();
        detail.summary.byte_length = byte_length;
        detail.summary.preview_state = PreviewState::Pending;
        detail.summary.preview_partial = None;
        detail.payload = input.payload;
        detail.images = images;
        let result_json = serde_json::to_string(&detail).map_err(|e| error("validation", e))?;
        let tx = self.conn.transaction().map_err(|e| error("database", e))?;
        if creating {
            tx.execute(
                "INSERT INTO materials(id,kind,detail_json) VALUES(?1,?2,?3)",
                params![detail.summary.id, detail.summary.kind.as_str(), result_json],
            )
            .map_err(|e| error("database", e))?;
        } else {
            let changed = tx
                .execute(
                    "UPDATE materials SET detail_json=?1,preview_hash=NULL,preview_render_key=NULL
             WHERE id=?2 AND json_extract(detail_json,'$.revision')=?3
               AND json_extract(detail_json,'$.metadataVersion')=?4
               AND json_extract(detail_json,'$.deletedAt') IS NULL",
                    params![
                        result_json,
                        detail.summary.id,
                        draft.material.summary.revision,
                        expected_metadata_version
                    ],
                )
                .map_err(|e| error("database", e))?;
            if changed != 1 {
                return Err(error(
                    "revision",
                    "Material changed; reopen the editor before saving",
                ));
            }
            tx.execute(
                "DELETE FROM material_images WHERE material_id=?1",
                [&detail.summary.id],
            )
            .map_err(|e| error("database", e))?;
        }
        for (position, image) in detail.images.iter().enumerate() {
            tx.execute("INSERT OR IGNORE INTO blobs(hash,mime_type,byte_length,width,height) VALUES(?1,?2,?3,?4,?5)",
                params![image.blob_id, image.mime_type, image.byte_length, image.width, image.height])
                .map_err(|e| error("database", e))?;
            tx.execute("INSERT INTO material_images(material_id,local_image_id,blob_hash,position) VALUES(?1,?2,?3,?4)",
                params![detail.summary.id, image.local_image_id, image.blob_id, position])
                .map_err(|e| error("database", e))?;
        }
        let rowid: i64 = tx
            .query_row(
                "SELECT rowid FROM materials WHERE id=?1",
                [&detail.summary.id],
                |r| r.get(0),
            )
            .map_err(|e| error("database", e))?;
        search::projection(&tx, rowid, &detail)?;
        tx.execute("INSERT INTO edit_receipts(operation_id,intent_hash,material_id,result_json) VALUES(?1,?2,?3,?4)",
            params![input.operation_id, intent, detail.summary.id, result_json]).map_err(|e| error("database", e))?;
        tx.commit().map_err(|e| error("database", e))?;
        // No post-commit staging/preview cleanup: a durable save must never report cleanup as save failure.
        Ok(detail)
    }

    pub(super) fn discard_edit(&self, session_id: &str) -> Result<()> {
        let path = self.draft_path(session_id)?;
        if !path.try_exists().map_err(|e| error("edit_cleanup", e))? {
            return Ok(());
        }
        let draft = self.read_draft(session_id)?;
        let images: Vec<_> = draft.staged.iter().chain(&draft.pending).cloned().collect();
        self.verify_draft_entries(&draft)?;
        self.cleanup_stages(&draft, &images)?;
        fs::remove_file(path.join("manifest.json")).map_err(|e| error("edit_cleanup", e))?;
        fs::remove_dir(path).map_err(|e| error("edit_cleanup", e))?;
        Ok(())
    }
}
