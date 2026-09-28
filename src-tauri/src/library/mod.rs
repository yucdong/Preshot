mod commands;
mod edit;
pub(crate) mod files;
mod insert;
mod insert_selection;
mod insert_gallery;
mod image_material;
mod instances;
pub mod models;
mod purge;
mod search;
mod validation;

pub use commands::*;

use std::{
    fs,
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use rusqlite::{params, Connection, OptionalExtension};

use crate::error::CommandError;
use models::*;

type Result<T> = std::result::Result<T, CommandError>;
fn error(code: &str, message: impl std::fmt::Display) -> CommandError {
    // Decoder and database diagnostics can quote stored user content. Preserve
    // operation-specific codes, but never send those raw diagnostics to the UI.
    let message = match code {
        "database" => "Unable to access the material library database. Retry or restore a known-good backup.".into(),
        "index" => "Unable to update the material search index. Content was preserved; retry library access.".into(),
        "corrupt" => "Stored material data is invalid. Preserve the library and restore a known-good backup.".into(),
        "journal_corrupt" => "The insertion recovery journal is invalid. Preserve .preshot-library and resolve recovery before editing.".into(),
        "image_decode" => "Unable to decode this image within the supported JPG/PNG safety limits.".into(),
        _ => message.to_string(),
    };
    CommandError::new(&format!("library_{code}"), message)
}
fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub(crate) struct Store {
    root: PathBuf,
    conn: Connection,
    // Held for the whole operation, including staging, publication, and DB commit.
    _lock: files::Lock,
}

impl Store {
    fn open(home: &Path) -> Result<Self> {
        if !home.exists() {
            let parent = home
                .parent()
                .ok_or_else(|| error("path", "Missing user root parent"))?;
            files::directory(parent)?;
            fs::create_dir(home).map_err(|e| error("directory", e))?;
        }
        let home = files::directory(home)?;
        let root = files::child_dir(&home, "library")?;
        let lock = files::Lock::acquire(&root.join(".library.lock"))?;
        for name in ["objects", "previews", "drafts"] {
            files::child_dir(&root, name)?;
        }
        for name in [
            "library.db",
            "library.db-wal",
            "library.db-shm",
            "library.db-journal",
        ] {
            files::check_leaf(&root.join(name))?;
        }
        let mut conn =
            Connection::open(root.join("library.db")).map_err(|e| error("database", e))?;
        let version: u32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|e| error("database", e))?;
        if version > 6 {
            return Err(error(
                "database_version",
                "Library was created by a newer application",
            ));
        }
        if version < 5 {
            conn.execute_batch(include_str!("schema.sql"))
                .map_err(|e| error("database", e))?;
            let tx = conn.transaction().map_err(|e| error("database", e))?;
            let has_storage: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM pragma_table_info('material_images') WHERE name='storage_id')",
                [], |r| r.get(0),
            ).map_err(|e| error("database", e))?;
            if !has_storage {
                tx.execute_batch("ALTER TABLE material_images ADD COLUMN storage_id TEXT REFERENCES image_instances(storage_id);")
                    .map_err(|e| error("database", e))?;
            }
            tx.execute_batch(include_str!("schema_v5.sql"))
                .map_err(|e| error("database", e))?;
            tx.commit().map_err(|e| error("database", e))?;
        } else {
            conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;")
                .map_err(|e| error("database", e))?;
        }
        if version < 6 {
            conn.pragma_update(None, "user_version", 6).map_err(|e| error("database", e))?;
        }
        files::child_dir(&root, "instances")?;
        search::rebuild_if_needed(&mut conn)?;
        let mut store = Self {
            root,
            conn,
            _lock: lock,
        };
        store.recover_instance_publications()?;
        store.recover_purges()?;
        Ok(store)
    }

    fn get(&self, id: &str) -> Result<MaterialDetail> {
        files::uuid(id)?;
        let row: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT kind,detail_json FROM materials WHERE id=?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|e| error("database", e))?;
        let (kind, json) = row.ok_or_else(|| error("not_found", "Material was not found"))?;
        let detail: MaterialDetail =
            serde_json::from_str(&json).map_err(|e| error("corrupt", e))?;
        validation::ready_payload(&detail.payload)?;
        if detail.summary.id != id
            || detail.summary.kind != detail.payload.kind
            || detail.summary.kind.as_str() != kind
            || detail.summary.revision == 0
            || detail.summary.metadata_version == 0
        {
            return Err(error("corrupt", "Material identity or revision is corrupt"));
        }
        let mut statement = self
            .conn
            .prepare(
                "SELECT i.local_image_id,b.hash,b.mime_type,b.byte_length,b.width,b.height,i.storage_id
            FROM material_images i JOIN blobs b ON b.hash=i.blob_hash
            WHERE i.material_id=?1 ORDER BY i.position",
            )
            .map_err(|e| error("database", e))?;
        let images = statement
            .query_map([id], |row| {
                Ok(MaterialImage {
                    local_image_id: row.get(0)?,
                    blob_id: row.get(1)?,
                    mime_type: row.get(2)?,
                    byte_length: row.get(3)?,
                    width: row.get(4)?,
                    height: row.get(5)?,
                    storage_id: row.get(6)?,
                })
            })
            .map_err(|e| error("database", e))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| error("database", e))?;
        let portable = validation::payload_images(&detail.payload)?;
        for image in &images {
            edit::validate_image(image)?;
            self.validate_instance_mapping(image)?;
        }
        if images != detail.images
            || portable.len() != images.len()
            || portable
                .iter()
                .zip(&images)
                .any(|(p, i)| p["localImageId"] != i.local_image_id)
            || detail.summary.image_count != images.len()
            || detail.summary.byte_length > files::MAX_BATCH_BYTES
            || detail.summary.byte_length != images.iter().map(|i| i.byte_length).sum::<u64>()
        {
            return Err(error(
                "corrupt",
                "Material payload and image references are inconsistent",
            ));
        }
        Ok(detail)
    }

    fn revision(&self, id: &str, revision: u32) -> Result<MaterialDetail> {
        let detail = self.get(id)?;
        if detail.summary.revision != revision {
            return Err(error("revision", "Material revision changed"));
        }
        Ok(detail)
    }

    fn object_path(&self, hash: &str, mime: &str) -> Result<PathBuf> {
        if hash.len() != 64
            || !hash
                .bytes()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        {
            return Err(error("corrupt", "Invalid content hash"));
        }
        let extension = match mime {
            "image/jpeg" => "jpg",
            "image/png" => "png",
            _ => return Err(error("corrupt", "Invalid blob MIME type")),
        };
        let bucket = files::child_dir(&self.root.join("objects"), &hash[..2])?;
        let path = bucket.join(format!("{hash}.{extension}"));
        files::check_leaf(&path)?;
        Ok(path)
    }

    fn blob(&self, image: &MaterialImage) -> Result<Vec<u8>> {
        self.validate_instance_mapping(image)?;
        let path = if let Some(storage_id) = &image.storage_id {
            self.instance_path(storage_id, &image.mime_type)?
        } else {
            self.object_path(&image.blob_id, &image.mime_type)?
        };
        let bytes = files::read_limited(&path, files::MAX_IMAGE_BYTES)?;
        if files::hash(&bytes) != image.blob_id || bytes.len() as u64 != image.byte_length {
            return Err(error(
                "image_corrupt",
                "Library image bytes no longer match their immutable hash",
            ));
        }
        let (mime, width, height) = files::image_info(&bytes, false)?;
        if mime != image.mime_type || width != image.width || height != image.height {
            return Err(error(
                "image_corrupt",
                "Library image metadata does not match decoded bytes",
            ));
        }
        Ok(bytes)
    }

    fn save(&mut self, mut input: MaterialSaveRequest) -> Result<MaterialDetail> {
        files::uuid(&input.operation_id)?;
        input.metadata = validation::metadata(input.metadata)?;
        validation::snapshot(&input.expected_plan, &input.snapshot)?;
        let intent = files::hash(&serde_json::to_vec(&input).map_err(|e| error("validation", e))?);
        self.check_purged_operation("save", &input.operation_id, &intent)?;
        let receipt: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT intent_hash,material_id FROM save_receipts WHERE operation_id=?1",
                [&input.operation_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|e| error("database", e))?;
        if let Some((hash, id)) = receipt {
            if hash != intent {
                return Err(error(
                    "operation_conflict",
                    "Operation ID was reused with a different save request",
                ));
            }
            return self.get(&id);
        }
        let project = files::directory(Path::new(&input.project_path))?;
        let _project_lock = files::project_lock(&project)?;
        insert::check_base(&project, &input.project_id, &input.expected_plan)?;
        insert::ensure_no_conflicts(&project)?;
        let (material_id, timestamp) = self.begin_snapshot_instance_save(&input.operation_id, &intent)?;
        let mut images = Vec::new();
        let mut byte_length = 0;
        for portable in validation::payload_images(&input.snapshot.payload)? {
            let local_id = portable["localImageId"].as_str().unwrap();
            let source = input
                .snapshot
                .sources
                .iter()
                .find(|s| s.local_image_id == local_id)
                .unwrap();
            let path = if input.snapshot.payload.kind == MaterialKind::Image {
                image_material::source_path(&project, &source.file)?
            } else { files::reference(&project, &source.file, true)? };
            let bytes = files::read_limited(&path, files::MAX_IMAGE_BYTES)?;
            let (mime, width, height) = files::image_info(&bytes, false)?;
            if input.snapshot.payload.kind == MaterialKind::Image && source.file.starts_with("media/") &&
                (portable["sourceWidth"] != width || portable["sourceHeight"] != height) {
                return Err(error("source", "Native image dimensions do not match the original file"));
            }
            let extension = path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if (mime == "image/png") != (extension == "png") {
                return Err(error(
                    "image_format",
                    "Source image extension does not match its actual bytes",
                ));
            }
            byte_length += bytes.len() as u64;
            if byte_length > files::MAX_BATCH_BYTES {
                return Err(error("size", "Material source images exceed 256 MiB"));
            }
            let image = self.snapshot_instance_image(&input.operation_id, MaterialImage {
                local_image_id: local_id.into(),
                blob_id: files::hash(&bytes),
                storage_id: None,
                mime_type: mime.into(),
                byte_length: bytes.len() as u64,
                width,
                height,
            })?;
            self.publish_instance(&input.operation_id, &image, &bytes)?;
            images.push(image);
        }
        insert::check_base(&project, &input.project_id, &input.expected_plan)?;
        let detail = MaterialDetail {
            summary: MaterialSummary {
                metadata: input.metadata,
                id: material_id,
                kind: input.snapshot.payload.kind.clone(),
                revision: 1,
                metadata_version: 1,
                created_at: timestamp,
                updated_at: timestamp,
                deleted_at: None,
                image_count: images.len(),
                byte_length,
                preview_state: PreviewState::Pending,
                preview_partial: None,
            },
            payload: input.snapshot.payload,
            images,
        };
        let tx = self.conn.transaction().map_err(|e| error("database", e))?;
        tx.execute(
            "INSERT INTO materials(id,kind,detail_json) VALUES(?1,?2,?3)",
            params![
                detail.summary.id,
                detail.summary.kind.as_str(),
                serde_json::to_string(&detail).map_err(|e| error("validation", e))?
            ],
        )
        .map_err(|e| error("database", e))?;
        let rowid = tx.last_insert_rowid();
        for (position, image) in detail.images.iter().enumerate() {
            instances::insert_blob_metadata(&tx, image)?;
            tx.execute(
                "INSERT INTO image_instances(storage_id,blob_hash,session_id,local_image_id) VALUES(?1,?2,?3,?4)",
                params![image.storage_id, image.blob_id, input.operation_id, image.local_image_id],
            ).map_err(|e| error("database", e))?;
            tx.execute("INSERT INTO material_images(material_id,local_image_id,blob_hash,position,storage_id) VALUES(?1,?2,?3,?4,?5)",
                params![detail.summary.id,image.local_image_id,image.blob_id,position,image.storage_id]).map_err(|e| error("database", e))?;
        }
        search::projection(&tx, rowid, &detail)?;
        tx.execute(
            "INSERT INTO save_receipts(operation_id,intent_hash,material_id) VALUES(?1,?2,?3)",
            params![input.operation_id, intent, detail.summary.id],
        )
        .map_err(|e| error("database", e))?;
        tx.execute("DELETE FROM instance_publications WHERE session_id=?1", [&input.operation_id])
            .map_err(|e| error("database", e))?;
        tx.execute("DELETE FROM snapshot_instance_saves WHERE operation_id=?1", [&input.operation_id])
            .map_err(|e| error("database", e))?;
        tx.commit().map_err(|e| error("database", e))?;
        Ok(detail)
    }

    fn search(&self, input: MaterialSearch) -> Result<MaterialSearchResult> {
        search::search(&self.conn, input)
    }

    fn update_metadata(
        &mut self,
        id: &str,
        expected: u32,
        metadata: MaterialMetadata,
    ) -> Result<MaterialSummary> {
        let mut detail = self.get(id)?;
        if detail.summary.deleted_at.is_some() {
            return Err(error(
                "deleted",
                "Restore this material before editing metadata",
            ));
        }
        detail.summary.metadata = validation::metadata(metadata)?;
        self.update_detail_cas(detail, expected)
    }

    fn set_deleted(&mut self, id: &str, expected: u32, deleted: bool) -> Result<MaterialSummary> {
        let mut detail = self.get(id)?;
        detail.summary.deleted_at = if deleted {
            Some(now().max(detail.summary.created_at))
        } else {
            None
        };
        self.update_detail_cas(detail, expected)
    }

    fn update_detail_cas(
        &mut self,
        mut detail: MaterialDetail,
        expected: u32,
    ) -> Result<MaterialSummary> {
        if detail.summary.metadata_version != expected {
            return Err(error(
                "metadata_conflict",
                "Material metadata changed; refresh and retry",
            ));
        }
        detail.summary.metadata_version = expected
            .checked_add(1)
            .ok_or_else(|| error("metadata_conflict", "Metadata version exhausted"))?;
        detail.summary.updated_at = now().max(detail.summary.updated_at);
        let tx = self.conn.transaction().map_err(|e| error("database", e))?;
        let changed = tx
            .execute(
                "UPDATE materials SET detail_json=?1 WHERE id=?2
            AND json_extract(detail_json,'$.metadataVersion')=?3",
                params![
                    serde_json::to_string(&detail).map_err(|e| error("validation", e))?,
                    detail.summary.id,
                    expected
                ],
            )
            .map_err(|e| error("database", e))?;
        if changed != 1 {
            return Err(error(
                "metadata_conflict",
                "Material metadata changed; refresh and retry",
            ));
        }
        let rowid: i64 = tx
            .query_row(
                "SELECT rowid FROM materials WHERE id=?1",
                [&detail.summary.id],
                |r| r.get(0),
            )
            .map_err(|e| error("database", e))?;
        search::projection(&tx, rowid, &detail)?;
        tx.commit().map_err(|e| error("database", e))?;
        Ok(detail.summary)
    }

    fn load_image(&self, id: &str, revision: u32, local_id: &str) -> Result<String> {
        let detail = self.revision(id, revision)?;
        let image = detail
            .images
            .iter()
            .find(|image| image.local_image_id == local_id)
            .ok_or_else(|| {
                error(
                    "image_not_found",
                    "Image does not belong to this material revision",
                )
            })?;
        Ok(format!(
            "data:{};base64,{}",
            image.mime_type,
            STANDARD.encode(self.blob(image)?)
        ))
    }

    fn preview_path(&self, hash: &str) -> Result<PathBuf> {
        if hash.len() != 64
            || !hash
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        {
            return Err(error("corrupt", "Invalid preview hash"));
        }
        Ok(self.root.join("previews").join(format!("{hash}.png")))
    }

    fn load_preview(&self, id: &str, revision: u32) -> Result<Option<String>> {
        let detail = self.revision(id, revision)?;
        if detail.summary.preview_state != PreviewState::Ready {
            return Ok(None);
        }
        let hash: String = self
            .conn
            .query_row(
                "SELECT preview_hash FROM materials WHERE id=?1",
                [id],
                |row| row.get(0),
            )
            .map_err(|e| error("preview", e))?;
        let bytes = files::read_limited(&self.preview_path(&hash)?, 2 * 1024 * 1024)?;
        if files::hash(&bytes) != hash {
            return Err(error("preview", "Cached preview is corrupt; regenerate it"));
        }
        files::image_info(&bytes, true)?;
        Ok(Some(format!(
            "data:image/png;base64,{}",
            STANDARD.encode(bytes)
        )))
    }

    fn save_preview(
        &mut self,
        id: &str,
        revision: u32,
        preview: MaterialPreviewInput,
    ) -> Result<()> {
        let mut detail = self.revision(id, revision)?;
        let (_, width, height) = files::image_info(&preview.bytes, true)?;
        if width != preview.width
            || height != preview.height
            || preview.render_key.is_empty()
            || preview.render_key.len() > 256
            || preview.render_key.chars().any(char::is_control)
        {
            return Err(error("preview", "Invalid preview dimensions or render key"));
        }
        let hash = files::hash(&preview.bytes);
        self.remember_asset(id, "preview", &hash, "image/png")?;
        files::atomic(&self.preview_path(&hash)?, &preview.bytes)?;
        detail.summary.preview_state = PreviewState::Ready;
        detail.summary.preview_partial = Some(preview.is_partial);
        self.conn.execute("UPDATE materials SET detail_json=?1,preview_hash=?2,preview_render_key=?3 WHERE id=?4",
            params![serde_json::to_string(&detail).map_err(|e| error("preview", e))?,hash,preview.render_key,id])
            .map_err(|e| error("database", e))?;
        Ok(())
    }

    fn mark_preview_failed(&mut self, id: &str, revision: u32) -> Result<()> {
        let mut detail = self.revision(id, revision)?;
        if detail.summary.preview_state == PreviewState::Ready {
            return Ok(());
        }
        detail.summary.preview_state = PreviewState::Failed;
        self.conn
            .execute(
                "UPDATE materials SET detail_json=?1 WHERE id=?2",
                params![
                    serde_json::to_string(&detail).map_err(|e| error("preview", e))?,
                    id
                ],
            )
            .map_err(|e| error("database", e))?;
        Ok(())
    }
}

pub(crate) use insert::{
    before_regular_mutation, reconcile_project, retain_reference_for_material_history,
};

#[cfg(test)]
mod tests;
