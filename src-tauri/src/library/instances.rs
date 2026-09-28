use std::{fs, path::PathBuf};

use rusqlite::{params, Connection, OptionalExtension};

use super::{edit, error, files, models::MaterialImage, now, Result, Store};

pub(super) fn insert_blob_metadata(conn: &Connection, image: &MaterialImage) -> Result<()> {
    conn.execute(
        "INSERT INTO blobs(hash,mime_type,byte_length,width,height) VALUES(?1,?2,?3,?4,?5)
         ON CONFLICT(hash) DO NOTHING",
        params![
            image.blob_id,
            image.mime_type,
            image.byte_length,
            image.width,
            image.height
        ],
    )
    .map_err(|e| error("database", e))?;
    let matches: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM blobs WHERE hash=?1 AND mime_type=?2 AND byte_length=?3 AND width=?4 AND height=?5)",
        params![image.blob_id, image.mime_type, image.byte_length, image.width, image.height],
        |r| r.get(0),
    ).map_err(|e| error("database", e))?;
    if !matches {
        return Err(error(
            "image_corrupt",
            "Shared integrity metadata differs from the validated image",
        ));
    }
    Ok(())
}

impl Store {
    pub(super) fn begin_snapshot_instance_save(
        &self,
        operation_id: &str,
        intent: &str,
    ) -> Result<(String, i64)> {
        files::uuid(operation_id)?;
        let draft = self.root.join("drafts").join(operation_id);
        files::check_leaf(&draft)?;
        if draft.try_exists().map_err(|e| error("path", e))? {
            return Err(error(
                "operation_conflict",
                "Snapshot save cannot reuse an edit-session publication identity",
            ));
        }
        let prior: Option<(String, String, i64)> = self.conn.query_row(
            "SELECT intent_hash,material_id,created_at FROM snapshot_instance_saves WHERE operation_id=?1",
            [operation_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        ).optional().map_err(|e| error("database", e))?;
        if let Some((prior, material_id, created_at)) = prior {
            if prior != intent {
                return Err(error(
                    "operation_conflict",
                    "Snapshot save operation was reused with different content",
                ));
            }
            files::uuid(&material_id)?;
            if created_at < 0 {
                return Err(error("corrupt", "Invalid snapshot publication timestamp"));
            }
            return Ok((material_id, created_at));
        }
        let owned: bool = self
            .conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM instance_publications WHERE session_id=?1)",
                [operation_id],
                |r| r.get(0),
            )
            .map_err(|e| error("database", e))?;
        if owned {
            return Err(error(
                "operation_conflict",
                "Snapshot publication identity is already owned",
            ));
        }
        let material_id = uuid::Uuid::new_v4().to_string();
        let timestamp = now();
        self.conn.execute(
            "INSERT INTO snapshot_instance_saves(operation_id,intent_hash,material_id,created_at) VALUES(?1,?2,?3,?4)",
            params![operation_id, intent, material_id, timestamp],
        ).map_err(|e| error("database", e))?;
        Ok((material_id, timestamp))
    }

    pub(super) fn snapshot_instance_image(
        &self,
        operation_id: &str,
        mut image: MaterialImage,
    ) -> Result<MaterialImage> {
        let prior: Option<String> = self.conn.query_row(
            "SELECT image_json FROM instance_publications WHERE session_id=?1 AND json_extract(image_json,'$.localImageId')=?2",
            params![operation_id, image.local_image_id], |r| r.get(0),
        ).optional().map_err(|e| error("database", e))?;
        if let Some(prior) = prior {
            let prior: MaterialImage =
                serde_json::from_str(&prior).map_err(|e| error("corrupt", e))?;
            edit::validate_image(&prior)?;
            image.storage_id = prior.storage_id.clone();
            if image != prior || image.storage_id.is_none() {
                return Err(error(
                    "operation_conflict",
                    "Snapshot source bytes changed during an owned save retry",
                ));
            }
        } else {
            image.storage_id = Some(uuid::Uuid::new_v4().to_string());
        }
        Ok(image)
    }

    pub(super) fn instance_path(&self, storage_id: &str, mime: &str) -> Result<PathBuf> {
        files::uuid(storage_id)?;
        let extension = match mime {
            "image/jpeg" => "jpg",
            "image/png" => "png",
            _ => return Err(error("corrupt", "Invalid instance MIME type")),
        };
        let bucket = files::child_dir(&self.root.join("instances"), &storage_id[..2])?;
        let path = bucket.join(format!("{storage_id}.{extension}"));
        files::check_leaf(&path)?;
        Ok(path)
    }

    pub(super) fn validate_instance_mapping(&self, image: &MaterialImage) -> Result<()> {
        edit::validate_image(image)?;
        if let Some(storage_id) = &image.storage_id {
            let matches: bool = self.conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM image_instances WHERE storage_id=?1 AND blob_hash=?2 AND local_image_id=?3)",
                params![storage_id, image.blob_id, image.local_image_id], |r| r.get(0),
            ).map_err(|e| error("database", e))?;
            if !matches {
                return Err(error(
                    "image_corrupt",
                    "Physical image instance integrity mapping is missing or corrupt",
                ));
            }
        }
        Ok(())
    }

    fn publication_images(&self, session_id: Option<&str>) -> Result<Vec<(String, MaterialImage)>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT storage_id,session_id,image_json FROM instance_publications
             WHERE ?1 IS NULL OR session_id=?1 ORDER BY session_id,storage_id",
            )
            .map_err(|e| error("database", e))?;
        let rows = stmt
            .query_map([session_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| error("database", e))?;
        let mut images = Vec::new();
        let mut last_session = String::new();
        let mut count = 0;
        let mut bytes = 0u64;
        for row in rows {
            let (storage_id, session, json) = row.map_err(|e| error("database", e))?;
            files::uuid(&session)?;
            let image: MaterialImage =
                serde_json::from_str(&json).map_err(|e| error("corrupt", e))?;
            edit::validate_image(&image)?;
            if image.storage_id.as_deref() != Some(&storage_id) {
                return Err(error("corrupt", "Instance publication identity differs"));
            }
            if last_session != session {
                last_session = session.clone();
                count = 0;
                bytes = 0;
            }
            count += 1;
            bytes += image.byte_length;
            if count > 512 || bytes > 512 * 1024 * 1024 {
                return Err(error(
                    "edit_limit",
                    "Instance recovery exceeds its owning draft budget",
                ));
            }
            images.push((session, image));
        }
        Ok(images)
    }

    fn verify_instance_file(&self, path: &std::path::Path, image: &MaterialImage) -> Result<()> {
        let bytes = files::read_limited(path, files::MAX_IMAGE_BYTES)?;
        if bytes.len() as u64 != image.byte_length || files::hash(&bytes) != image.blob_id {
            return Err(error(
                "image_corrupt",
                "Physical image instance was replaced or corrupted; preserve its recovery record",
            ));
        }
        Ok(())
    }

    fn pending_instance_bytes(
        &self,
        path: &std::path::Path,
        image: &MaterialImage,
    ) -> Result<Vec<u8>> {
        files::no_links(path)?;
        let metadata = fs::metadata(path).map_err(|e| error("path", e))?;
        if !metadata.is_file() || metadata.len() > image.byte_length {
            return Err(error(
                "image_corrupt",
                "Owned instance staging file exceeds its journal budget",
            ));
        }
        if metadata.len() == 0 {
            Ok(Vec::new())
        } else {
            files::read_limited(path, image.byte_length as usize)
        }
    }

    pub(super) fn publish_instance(
        &self,
        session_id: &str,
        image: &MaterialImage,
        bytes: &[u8],
    ) -> Result<()> {
        let storage_id = image
            .storage_id
            .as_deref()
            .ok_or_else(|| error("corrupt", "Missing instance identity"))?;
        files::uuid(session_id)?;
        edit::validate_image(image)?;
        let destination = self.instance_path(storage_id, &image.mime_type)?;
        let pending = destination.with_extension("pending");
        files::check_leaf(&pending)?;
        let published: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT session_id,local_image_id FROM image_instances WHERE storage_id=?1",
                [storage_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| error("database", e))?;
        if let Some(owner) = published {
            if owner != (session_id.to_string(), image.local_image_id.clone()) {
                return Err(error(
                    "image_corrupt",
                    "A staged paste cannot reuse another operation's physical file",
                ));
            }
            self.blob(image)?;
            return Ok(());
        }
        let prior: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT session_id,image_json FROM instance_publications WHERE storage_id=?1",
                [storage_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| error("database", e))?;
        if let Some((session, json)) = prior {
            let prior: MaterialImage =
                serde_json::from_str(&json).map_err(|e| error("corrupt", e))?;
            if session != session_id || prior != *image {
                return Err(error(
                    "image_corrupt",
                    "Instance publication belongs to another paste",
                ));
            }
        } else {
            if destination.try_exists().map_err(|e| error("path", e))?
                || pending.try_exists().map_err(|e| error("path", e))?
            {
                return Err(error(
                    "image_corrupt",
                    "Allocated instance filename is already occupied; preserve the existing file",
                ));
            }
            self.conn.execute(
                "INSERT INTO instance_publications(storage_id,session_id,image_json) VALUES(?1,?2,?3)",
                params![storage_id, session_id, serde_json::to_string(image).map_err(|e| error("validation", e))?],
            ).map_err(|e| error("database", e))?;
        }
        if destination.try_exists().map_err(|e| error("path", e))? {
            self.verify_instance_file(&destination, image)?;
        } else {
            if pending.try_exists().map_err(|e| error("path", e))? {
                let partial = self.pending_instance_bytes(&pending, image)?;
                if !bytes.starts_with(&partial) {
                    return Err(error(
                        "image_corrupt",
                        "Owned instance staging file differs from its retry source",
                    ));
                }
                if partial.len() != bytes.len() {
                    fs::remove_file(&pending).map_err(|e| error("edit_cleanup", e))?;
                }
            }
            if !pending.try_exists().map_err(|e| error("path", e))? {
                // The durable publication owns this exact pending filename,
                // including a short write. Never create unjournaled sibling files.
                files::write_new(&pending, bytes)?;
            }
            files::publish_new(&pending, &destination)?;
        }
        Ok(())
    }

    pub(super) fn cleanup_instance_publications(&self, session_id: &str) -> Result<()> {
        self.cleanup_instance_publication_files(session_id, false)
    }

    fn cleanup_instance_publication_files(
        &self,
        session_id: &str,
        retain_allocation: bool,
    ) -> Result<()> {
        for (_, image) in self.publication_images(Some(session_id))? {
            let storage_id = image.storage_id.as_deref().unwrap();
            let path = self.instance_path(storage_id, &image.mime_type)?;
            let committed: bool = self
                .conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM image_instances WHERE storage_id=?1)",
                    [storage_id],
                    |r| r.get(0),
                )
                .map_err(|e| error("database", e))?;
            let pending = path.with_extension("pending");
            for (candidate, partial) in
                [(Some(pending), true), ((!committed).then_some(path), false)]
            {
                let Some(candidate) = candidate else { continue };
                files::check_leaf(&candidate)?;
                if candidate.try_exists().map_err(|e| error("path", e))? {
                    if partial {
                        // A journal owns interrupted short writes as well as
                        // complete bytes; final immutable files still require SHA.
                        self.pending_instance_bytes(&candidate, &image)?;
                    } else {
                        self.verify_instance_file(&candidate, &image)?;
                    }
                    fs::remove_file(candidate).map_err(|e| error("edit_cleanup", e))?;
                }
            }
            if committed {
                self.validate_instance_mapping(&image)?;
            }
            if !retain_allocation {
                self.conn
                    .execute(
                        "DELETE FROM instance_publications WHERE storage_id=?1 AND session_id=?2",
                        params![storage_id, session_id],
                    )
                    .map_err(|e| error("database", e))?;
            }
        }
        Ok(())
    }

    pub(super) fn recover_instance_publications(&self) -> Result<()> {
        let mut recovered_snapshots = std::collections::HashSet::new();
        for (session, image) in self.publication_images(None)? {
            let snapshot: bool = self
                .conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM snapshot_instance_saves WHERE operation_id=?1)",
                    [&session],
                    |r| r.get(0),
                )
                .map_err(|e| error("database", e))?;
            if snapshot {
                // No receipt means these files are definitely uncommitted.
                // Reclaim crash leftovers, but retain the exact per-operation
                // allocation so retries cannot adopt another save's file.
                if recovered_snapshots.insert(session.clone()) {
                    self.cleanup_instance_publication_files(&session, true)?;
                }
                continue;
            }
            // Live drafts retain file-first work for the exact CAS retry. Only
            // journal-owned files with no surviving session may be reclaimed.
            if !self.instance_publication_is_pinned(&session, &image)? {
                self.cleanup_instance_publications(&session)?;
            }
        }
        Ok(())
    }
}
