use super::{
    error, files,
    models::{MaterialDetail, MaterialImage, MaterialKind},
    Result, Store,
};
use rusqlite::{params, OptionalExtension};
use std::{
    fs,
    path::{Path, PathBuf},
};

fn extension(mime: &str) -> Result<&'static str> {
    match mime {
        "image/png" => Ok("png"),
        "image/jpeg" => Ok("jpg"),
        _ => Err(error("corrupt", "Invalid original MIME type")),
    }
}

fn verify(path: &Path, hash: &str, length: u64) -> Result<()> {
    crate::original_image::verify(path, length, hash)
}

impl Store {
    pub(super) fn group_directory(&self, id: &str) -> Result<PathBuf> {
        files::uuid(id)?;
        let groups = files::child_dir(&self.root, "groups")?;
        let group = files::child_dir(&groups, id)?;
        files::child_dir(&group, "originals")
    }

    fn grouped_instance_path(&self, material: &str, storage: &str, mime: &str) -> Result<PathBuf> {
        files::uuid(storage)?;
        let path = self
            .group_directory(material)?
            .join(format!("{storage}.{}", extension(mime)?));
        files::check_leaf(&path)?;
        Ok(path)
    }

    pub(super) fn instance_group_path(&self, storage: &str, mime: &str) -> Result<Option<PathBuf>> {
        let entry: Option<(String, String, bool)> = self.conn.query_row(
            "SELECT material_id,mime_type,relocating FROM group_instance_locations WHERE storage_id=?1",
            [storage], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        ).optional().map_err(|e| error("database", e))?;
        let Some((material, stored_mime, relocating)) = entry else {
            return Ok(None);
        };
        if mime != stored_mime {
            return Err(error("corrupt", "Original MIME mapping differs"));
        }
        if relocating {
            return Err(error(
                "originals_pending",
                "Original image relocation is incomplete; reopen the library to retry",
            ));
        }
        Ok(Some(self.grouped_instance_path(&material, storage, mime)?))
    }

    // Pin the final directory before the existing durable publication protocol
    // takes ownership of any files. A failed save can replay the same allocation.
    pub(super) fn assign_group_instance(
        &self,
        material: &str,
        image: &MaterialImage,
    ) -> Result<()> {
        super::edit::validate_image(image)?;
        files::uuid(material)?;
        let storage = image
            .storage_id
            .as_deref()
            .ok_or_else(|| error("corrupt", "Missing instance"))?;
        let prior: Option<(String, String, String, u64, bool)> = self.conn.query_row(
            "SELECT material_id,mime_type,blob_hash,byte_length,relocating FROM group_instance_locations WHERE storage_id=?1",
            [storage], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?)),
        ).optional().map_err(|e| error("database", e))?;
        if let Some(prior) = prior {
            if prior
                != (
                    material.into(),
                    image.mime_type.clone(),
                    image.blob_id.clone(),
                    image.byte_length,
                    false,
                )
            {
                return Err(error(
                    "corrupt",
                    "Original directory belongs to another image or material",
                ));
            }
            return Ok(());
        }
        let old = self.ungrouped_instance_path(storage, &image.mime_type)?;
        let destination = self.grouped_instance_path(material, storage, &image.mime_type)?;
        if destination.exists() || destination.with_extension("pending").exists() {
            return Err(error(
                "image_corrupt",
                "Original destination is occupied by an unowned file",
            ));
        }
        let committed: bool = self
            .conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM image_instances WHERE storage_id=?1)",
                [storage],
                |r| r.get(0),
            )
            .map_err(|e| error("database", e))?;
        if committed {
            self.validate_instance_mapping(image)?;
            let foreign_owner: bool = self.conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM material_instance_owners WHERE storage_id=?1 AND material_id<>?2)",
                params![storage, material], |r| r.get(0)).map_err(|e| error("database", e))?;
            if foreign_owner {
                return Err(error(
                    "image_corrupt",
                    "Original instance has another material owner",
                ));
            }
            verify(&old, &image.blob_id, image.byte_length)?;
        } else if old.exists() || old.with_extension("pending").exists() {
            // An old, not-yet-committed publication must complete in its original
            // location. A subsequent directory open will relocate it safely.
            return Ok(());
        }
        self.conn
            .execute(
                "INSERT INTO group_instance_locations VALUES(?1,?2,?3,?4,?5,?6)",
                params![
                    storage,
                    material,
                    image.mime_type,
                    image.blob_id,
                    image.byte_length,
                    committed
                ],
            )
            .map_err(|e| error("database", e))?;
        if committed {
            self.finish_group_relocation(
                storage,
                material,
                &image.mime_type,
                &image.blob_id,
                image.byte_length,
            )?;
        }
        Ok(())
    }

    fn finish_group_relocation(
        &self,
        storage: &str,
        material: &str,
        mime: &str,
        hash: &str,
        length: u64,
    ) -> Result<()> {
        let source = self.ungrouped_instance_path(storage, mime)?;
        let destination = self.grouped_instance_path(material, storage, mime)?;
        if destination.exists() {
            verify(&destination, hash, length)?;
            if source.exists() {
                verify(&source, hash, length)?;
                fs::remove_file(&source).map_err(|e| error("originals_cleanup", e))?;
            }
        } else {
            verify(&source, hash, length)?;
            files::publish_new(&source, &destination)?;
        }
        self.conn
            .execute(
                "UPDATE group_instance_locations SET relocating=0 WHERE storage_id=?1",
                [storage],
            )
            .map_err(|e| error("database", e))?;
        Ok(())
    }

    pub(super) fn recover_group_relocations(&self) -> Result<()> {
        let rows = {
            let mut stmt = self.conn.prepare("SELECT storage_id,material_id,mime_type,blob_hash,byte_length FROM group_instance_locations WHERE relocating=1")
                .map_err(|e| error("database", e))?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, u64>(4)?,
                    ))
                })
                .map_err(|e| error("database", e))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|e| error("database", e))?
        };
        for (storage, material, mime, hash, length) in rows {
            let valid: bool = self.conn.query_row("SELECT EXISTS(SELECT 1 FROM image_instances i JOIN blobs b ON b.hash=i.blob_hash WHERE i.storage_id=?1 AND b.hash=?2 AND b.mime_type=?3 AND b.byte_length=?4)",
                params![storage,hash,mime,length], |r| r.get(0)).map_err(|e| error("database", e))?;
            if !valid {
                return Err(error(
                    "corrupt",
                    "Relocation journal does not match the immutable instance",
                ));
            }
            self.finish_group_relocation(&storage, &material, &mime, &hash, length)?;
        }
        Ok(())
    }

    fn legacy_group_path(
        &self,
        material: &str,
        local: &str,
        hash: &str,
        mime: &str,
    ) -> Result<PathBuf> {
        super::validation::local_image_identifier(local)?;
        // Validate the hash with the explicit legacy resolver. It never resolves an instance.
        self.object_path(hash, mime)?;
        let key = files::hash(format!("{local}:{hash}").as_bytes());
        let path = self
            .group_directory(material)?
            .join(format!("legacy-{key}.{}", extension(mime)?));
        files::check_leaf(&path)?;
        Ok(path)
    }

    pub(super) fn collect_legacy_group_original(
        &self,
        material: &str,
        image: &MaterialImage,
    ) -> Result<PathBuf> {
        super::edit::validate_image(image)?;
        let destination = self.legacy_group_path(
            material,
            &image.local_image_id,
            &image.blob_id,
            &image.mime_type,
        )?;
        let pending = destination.with_extension("pending");
        files::check_leaf(&pending)?;
        let prior: Option<(String,u64,bool)> = self.conn.query_row(
            "SELECT mime_type,byte_length,ready FROM group_legacy_files WHERE material_id=?1 AND local_image_id=?2 AND blob_hash=?3",
            params![material,image.local_image_id,image.blob_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)),
        ).optional().map_err(|e| error("database", e))?;
        if let Some((mime, length, ready)) = &prior {
            if mime != &image.mime_type || *length != image.byte_length {
                return Err(error("corrupt", "Legacy copy mapping differs"));
            }
            if *ready {
                verify(&destination, &image.blob_id, image.byte_length)?;
                return Ok(destination);
            }
        } else {
            if destination.exists() || pending.exists() {
                return Err(error(
                    "image_corrupt",
                    "Legacy original destination is occupied",
                ));
            }
            self.conn
                .execute(
                    "INSERT INTO group_legacy_files VALUES(?1,?2,?3,?4,?5,0)",
                    params![
                        material,
                        image.local_image_id,
                        image.blob_id,
                        image.mime_type,
                        image.byte_length
                    ],
                )
                .map_err(|e| error("database", e))?;
        }
        if destination.exists() {
            verify(&destination, &image.blob_id, image.byte_length)?;
        } else {
            let source = self.verified_image_path(image)?;
            if pending.exists() {
                if !crate::original_image::is_prefix(&pending, &source)? {
                    return Err(error("image_corrupt", "Legacy pending copy differs"));
                }
                fs::remove_file(&pending).map_err(|e| error("originals_cleanup", e))?;
            }
            crate::original_image::copy_new(&source, &pending, image.byte_length, &image.blob_id)?;
            files::publish_new(&pending, &destination)?;
        }
        self.conn.execute("UPDATE group_legacy_files SET ready=1 WHERE material_id=?1 AND local_image_id=?2 AND blob_hash=?3",
            params![material,image.local_image_id,image.blob_id]).map_err(|e| error("database", e))?;
        Ok(destination)
    }

    pub(super) fn collect_group_originals(&self, detail: &MaterialDetail) -> Result<PathBuf> {
        if detail.summary.kind != MaterialKind::ImageGroup {
            return Err(error(
                "kind",
                "Only image-group materials have an original-image directory",
            ));
        }
        for image in &detail.images {
            if image.storage_id.is_some() {
                self.assign_group_instance(&detail.summary.id, image)?;
                let path = self.image_path(image)?;
                if !path.is_file() {
                    return Err(error(
                        "image_not_found",
                        "The original image file is missing",
                    ));
                }
            } else {
                self.collect_legacy_group_original(&detail.summary.id, image)?;
            }
        }
        self.group_directory(&detail.summary.id)
    }

    pub(super) fn original_group_path(&self, id: &str, revision: u32) -> Result<PathBuf> {
        self.collect_group_originals(&self.revision(id, revision)?)
    }

    // Rows survive metadata deletion and are cleaned only under durable purge approval.
    pub(super) fn purge_legacy_group_originals(&self, id: &str) -> Result<()> {
        let approved: bool = self
            .conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM purge_receipts WHERE material_id=?1)",
                [id],
                |r| r.get(0),
            )
            .map_err(|e| error("database", e))?;
        if !approved {
            return Err(error("purge", "Original cleanup requires durable approval"));
        }
        let rows = {
            let mut stmt = self.conn.prepare("SELECT local_image_id,blob_hash,mime_type,byte_length FROM group_legacy_files WHERE material_id=?1")
                .map_err(|e| error("database", e))?;
            let rows = stmt
                .query_map([id], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, u64>(3)?,
                    ))
                })
                .map_err(|e| error("database", e))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|e| error("database", e))?
        };
        if !rows.is_empty() && self.purge_draft_references()?.0.contains(id) {
            return Err(error(
                "purge_in_use",
                "A live draft retains these originals",
            ));
        }
        for (local, hash, mime, length) in rows {
            let path = self.legacy_group_path(id, &local, &hash, &mime)?;
            for (candidate, partial) in [(path.with_extension("pending"), true), (path, false)] {
                files::check_leaf(&candidate)?;
                if candidate.exists() {
                    if partial {
                        let source = self.object_path(&hash, &mime)?;
                        verify(&source, &hash, length)?;
                        if !crate::original_image::is_prefix(&candidate, &source)? {
                            return Err(error(
                                "image_corrupt",
                                "Legacy staging copy differs from its owned source",
                            ));
                        }
                    } else {
                        verify(&candidate, &hash, length)?;
                    }
                    fs::remove_file(&candidate).map_err(|e| error("originals_cleanup", e))?;
                }
            }
            self.conn.execute("DELETE FROM group_legacy_files WHERE material_id=?1 AND local_image_id=?2 AND blob_hash=?3",
                params![id,local,hash]).map_err(|e| error("database", e))?;
        }
        Ok(())
    }
}
