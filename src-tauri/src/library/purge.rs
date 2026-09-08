use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};

use super::{error, files, Result, Store};

struct Asset {
    kind: String,
    hash: String,
    mime: String,
}

fn cleanup_pending() -> crate::error::CommandError {
    error(
        "purge_cleanup_pending",
        "The material record is permanently deleted, but owned-file cleanup is incomplete. Close programs using library images and retry reading the material library, or retry permanent deletion with the same material ID and metadata version. Preserve the library if cleanup still fails; do not restore or recreate the material",
    )
}

fn validate_asset(kind: &str, hash: &str, mime: &str) -> Result<()> {
    if !matches!(kind, "object" | "preview")
        || hash.len() != 64
        || !hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || !matches!(mime, "image/png" | "image/jpeg")
        || kind == "preview" && mime != "image/png"
    {
        return Err(error("corrupt", "Invalid asset cleanup identity"));
    }
    Ok(())
}

fn owned_path(root: &Path, asset: &Asset) -> Result<Option<PathBuf>> {
    validate_asset(&asset.kind, &asset.hash, &asset.mime)?;
    let mut parent = files::directory(&root.join(if asset.kind == "object" {
        "objects"
    } else {
        "previews"
    }))?;
    if asset.kind == "object" {
        parent = parent.join(&asset.hash[..2]);
        match fs::symlink_metadata(&parent) {
            Ok(_) => {
                files::directory(&parent)?;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(error("path", e)),
        }
    }
    let path = parent.join(format!(
        "{}.{}",
        asset.hash,
        if asset.mime == "image/png" {
            "png"
        } else {
            "jpg"
        }
    ));
    files::check_leaf(&path)?;
    match fs::symlink_metadata(&path) {
        Ok(meta) if meta.is_file() => Ok(Some(path)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        _ => Err(error("path", "Cleanup target is not a regular owned file")),
    }
}

fn referenced(conn: &Connection, asset: &Asset, draft_blobs: &HashSet<String>) -> Result<bool> {
    validate_asset(&asset.kind, &asset.hash, &asset.mime)?;
    if asset.kind == "object" && draft_blobs.contains(&asset.hash) {
        return Ok(true);
    }
    conn.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM material_asset_owners WHERE kind=?1 AND hash=?2
            UNION ALL SELECT 1 FROM materials WHERE ?1='preview' AND preview_hash=?2
            UNION ALL SELECT 1 FROM material_images WHERE ?1='object' AND blob_hash=?2
            UNION ALL SELECT 1 FROM materials m,json_each(m.detail_json,'$.images') j
                WHERE ?1='object' AND json_extract(j.value,'$.blobId')=?2
            UNION ALL SELECT 1 FROM edit_receipts r,json_each(r.result_json,'$.images') j
                WHERE ?1='object' AND json_extract(j.value,'$.blobId')=?2
        )",
        params![asset.kind, asset.hash],
        |row| row.get(0),
    )
    .map_err(|e| error("database", e))
}

impl Store {
    pub(super) fn remember_asset(
        &self,
        material_id: &str,
        kind: &str,
        hash: &str,
        mime: &str,
    ) -> Result<()> {
        validate_asset(kind, hash, mime)?;
        self.conn
            .execute(
                "INSERT INTO material_asset_owners(material_id,kind,hash,mime_type)
             VALUES(?1,?2,?3,?4) ON CONFLICT(material_id,kind,hash,mime_type) DO NOTHING",
                params![material_id, kind, hash, mime],
            )
            .map_err(|e| error("database", e))?;
        Ok(())
    }

    pub(super) fn check_purged_operation(
        &self,
        kind: &str,
        operation_id: &str,
        intent: &str,
    ) -> Result<()> {
        let prior: Option<String> = self.conn.query_row(
            "SELECT intent_hash FROM purged_operations WHERE operation_kind=?1 AND operation_id=?2",
            params![kind, operation_id],
            |row| row.get(0),
        ).optional().map_err(|e| error("database", e))?;
        if let Some(prior) = prior {
            return Err(if prior == intent {
                error("purged", "This operation's material was permanently deleted; its old save cannot be replayed")
            } else {
                error(
                    "operation_conflict",
                    "Operation ID was reused with a different request",
                )
            });
        }
        Ok(())
    }

    pub(super) fn purge(&mut self, id: &str, expected_version: u32) -> Result<()> {
        self.queue_purge(id, expected_version)?;
        self.finish_purge(id).map_err(|_| cleanup_pending())
    }

    pub(super) fn recover_purges(&mut self) -> Result<()> {
        let pending = (|| {
            let mut statement = self.conn.prepare(
                "SELECT material_id,expected_version FROM purge_receipts
                 WHERE completed=0 OR EXISTS(
                     SELECT 1 FROM purge_files WHERE material_id=purge_receipts.material_id)
                 ORDER BY material_id",
            )?;
            let rows = statement.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?))
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        })()
        .map_err(|_| cleanup_pending())?;
        // Only the durable approval/outbox is resumable. Never discover cleanup
        // targets by scanning library directories or create a new purge on open.
        for (id, expected_version) in pending {
            self.purge(&id, expected_version)
                .map_err(|_| cleanup_pending())?;
        }
        Ok(())
    }

    pub(super) fn queue_purge(&mut self, id: &str, expected_version: u32) -> Result<()> {
        files::uuid(id)?;
        if expected_version == 0 {
            return Err(error(
                "metadata_conflict",
                "Expected a positive material metadata version",
            ));
        }
        let prior: Option<u32> = self
            .conn
            .query_row(
                "SELECT expected_version FROM purge_receipts WHERE material_id=?1",
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| error("database", e))?;
        if let Some(prior) = prior {
            return if prior == expected_version {
                Ok(())
            } else {
                Err(error(
                    "metadata_conflict",
                    "Permanent deletion was requested with a different metadata version",
                ))
            };
        }
        let material = self.get(id)?;
        if material.summary.metadata_version != expected_version {
            return Err(error(
                "metadata_conflict",
                "Material metadata changed; refresh and retry",
            ));
        }
        if material.summary.deleted_at.is_none() {
            return Err(error(
                "not_deleted",
                "Move this material to the recycle bin before permanently deleting it",
            ));
        }
        let (draft_materials, _) = self.purge_draft_references().map_err(|_| error(
            "purge_in_use",
            "An edit recovery draft cannot be verified. Preserve the drafts and resolve or discard the affected edit session before retrying permanent deletion",
        ))?;
        if draft_materials.contains(id) {
            return Err(error(
                "purge_in_use",
                "This material has an active or recoverable content edit. Finish or explicitly discard its edit sessions before permanently deleting it",
            ));
        }
        // Project insertion journals already own their copies. Only live library
        // work and edit snapshots need originals; the Store lock excludes live work.
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| error("database", e))?;
        tx.execute(
            "INSERT INTO purge_receipts(material_id,expected_version) VALUES(?1,?2)",
            params![id, expected_version],
        )
        .map_err(|e| error("database", e))?;
        tx.execute(
            "INSERT INTO purge_files(material_id,kind,hash,mime_type)
             SELECT material_id,kind,hash,mime_type FROM material_asset_owners WHERE material_id=?1",
            [id],
        ).map_err(|e| error("database", e))?;
        for (kind, table) in [("save", "save_receipts"), ("edit", "edit_receipts")] {
            tx.execute(
                &format!("INSERT INTO purged_operations(operation_kind,operation_id,intent_hash,material_id)
                          SELECT ?1,operation_id,intent_hash,material_id FROM {table} WHERE material_id=?2"),
                params![kind, id],
            ).map_err(|e| error("database", e))?;
            tx.execute(&format!("DELETE FROM {table} WHERE material_id=?1"), [id])
                .map_err(|e| error("database", e))?;
        }
        tx.execute(
            "DELETE FROM material_search WHERE rowid=(SELECT rowid FROM materials WHERE id=?1)",
            [id],
        )
        .map_err(|e| error("database", e))?;
        tx.execute("DELETE FROM material_images WHERE material_id=?1", [id])
            .map_err(|e| error("database", e))?;
        tx.execute(
            "DELETE FROM material_asset_owners WHERE material_id=?1",
            [id],
        )
        .map_err(|e| error("database", e))?;
        let changed = tx.execute(
            "DELETE FROM materials WHERE id=?1 AND json_extract(detail_json,'$.metadataVersion')=?2
             AND json_extract(detail_json,'$.deletedAt') IS NOT NULL",
            params![id, expected_version],
        ).map_err(|e| error("database", e))?;
        if changed != 1 {
            return Err(error(
                "metadata_conflict",
                "Material changed before permanent deletion; refresh and retry",
            ));
        }
        tx.commit().map_err(|e| error("database", e))
    }

    fn finish_purge(&mut self, id: &str) -> Result<()> {
        let assets = {
            let mut statement = self.conn.prepare(
                "SELECT kind,hash,mime_type FROM purge_files WHERE material_id=?1 ORDER BY kind,hash,mime_type",
            ).map_err(|e| error("database", e))?;
            let rows = statement
                .query_map([id], |row| {
                    Ok(Asset {
                        kind: row.get(0)?,
                        hash: row.get(1)?,
                        mime: row.get(2)?,
                    })
                })
                .map_err(|e| error("database", e))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|e| error("database", e))?
        };
        if !assets.is_empty() {
            let (draft_materials, draft_blobs) = self.purge_draft_references()?;
            if draft_materials.contains(id) {
                return Err(error(
                    "purge_in_use",
                    "An edit recovery draft still claims this material",
                ));
            }
            for asset in assets {
                // Each retry rechecks current claims, not the pre-deletion snapshot.
                // Keep SQLite's writer lock until the file and its outbox entry agree.
                let tx = self
                    .conn
                    .transaction_with_behavior(TransactionBehavior::Immediate)
                    .map_err(|e| error("database", e))?;
                if !referenced(&tx, &asset, &draft_blobs)? {
                    if let Some(path) = owned_path(&self.root, &asset)? {
                        let cap = if asset.kind == "preview" {
                            2 * 1024 * 1024
                        } else {
                            files::MAX_IMAGE_BYTES
                        };
                        let bytes = files::read_limited(&path, cap)?;
                        if files::hash(&bytes) != asset.hash {
                            return Err(error(
                                "image_corrupt",
                                "Cleanup target was replaced; preserve the library",
                            ));
                        }
                        fs::remove_file(&path).map_err(|e| error("cleanup", e))?;
                        #[cfg(not(windows))]
                        fs::File::open(path.parent().unwrap())
                            .and_then(|dir| dir.sync_all())
                            .map_err(|e| error("cleanup", e))?;
                    }
                    if asset.kind == "object" {
                        tx.execute("DELETE FROM blobs WHERE hash=?1", [&asset.hash])
                            .map_err(|e| error("database", e))?;
                    }
                }
                tx.execute(
                    "DELETE FROM purge_files WHERE material_id=?1 AND kind=?2 AND hash=?3 AND mime_type=?4",
                    params![id, asset.kind, asset.hash, asset.mime],
                ).map_err(|e| error("database", e))?;
                tx.commit().map_err(|e| error("database", e))?;
            }
        }
        self.conn
            .execute(
                "UPDATE purge_receipts SET completed=1 WHERE material_id=?1
             AND NOT EXISTS(SELECT 1 FROM purge_files WHERE material_id=?1)",
                [id],
            )
            .map_err(|e| error("database", e))?;
        Ok(())
    }
}
