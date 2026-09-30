use rusqlite::Connection;

use super::{error, Result};

pub(super) fn upgrade_image_byte_limit(conn: &mut Connection) -> Result<()> {
    rebuild_blobs(conn, include_str!("schema_v7.sql"), 7)
}

pub(super) fn remove_image_resolution_limit(conn: &mut Connection) -> Result<()> {
    rebuild_blobs(conn, include_str!("schema_v8.sql"), 8)
}

pub(super) fn remove_image_byte_limit(conn: &mut Connection) -> Result<()> {
    rebuild_blobs(conn, include_str!("schema_v10.sql"), 10)
}

fn rebuild_blobs(conn: &mut Connection, sql: &str, version: u32) -> Result<()> {
    // SQLite requires foreign keys to be disabled outside the transaction when
    // rebuilding a referenced table. Check every relationship before committing.
    conn.pragma_update(None, "foreign_keys", false).map_err(|e| error("database", e))?;
    let result = (|| {
        let tx = conn.transaction().map_err(|e| error("database", e))?;
        tx.execute_batch(sql).map_err(|e| error("database", e))?;
        let invalid: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_foreign_key_check)", [], |row| row.get(0),
        ).map_err(|e| error("database", e))?;
        if invalid {
            return Err(error("database", "Image limit migration found inconsistent image ownership"));
        }
        tx.pragma_update(None, "user_version", version).map_err(|e| error("database", e))?;
        tx.commit().map_err(|e| error("database", e))
    })();
    let restored = conn.pragma_update(None, "foreign_keys", true).map_err(|e| error("database", e));
    result.and(restored)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn library_image_limit_migration_preserves_instances_legacy_owners_and_exact_receipts() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("schema.sql")).unwrap();
        conn.execute_batch("ALTER TABLE material_images ADD COLUMN storage_id TEXT REFERENCES image_instances(storage_id);").unwrap();
        conn.execute_batch(include_str!("schema_v5.sql")).unwrap();
        conn.pragma_update(None, "user_version", 6).unwrap();
        let hash = "a".repeat(64);
        let storage = "07dbb7da-30ec-41e2-a235-d5aa19ad2632";
        let session = "132682b1-dd30-4b18-b7b6-c9a3e15f2e27";
        conn.execute("INSERT INTO blobs VALUES(?1,'image/jpeg',100,3,2)", [&hash]).unwrap();
        conn.execute("INSERT INTO materials(id,kind,detail_json) VALUES('material','imageGroup',?1)",
            [r#"{"id":"material","kind":"imageGroup","revision":1,"payload":{"kind":"imageGroup"}}"#]).unwrap();
        conn.execute("INSERT INTO image_instances VALUES(?1,?2,?3,'original')", [storage, &hash, session]).unwrap();
        conn.execute("INSERT INTO material_images VALUES('material','original',?1,0,?2)", [&hash, storage]).unwrap();
        conn.execute("INSERT INTO material_images VALUES('material','legacy',?1,1,NULL)", [&hash]).unwrap();
        let receipt = format!(r#"{{"images":[{{"storageId":"{storage}","localImageId":"original","blobId":"{hash}","mimeType":"image/jpeg"}}]}}"#);
        conn.execute("INSERT INTO edit_receipts VALUES('operation',?1,'material',?2)", [&hash, &receipt]).unwrap();
        upgrade_image_byte_limit(&mut conn).unwrap();
        remove_image_resolution_limit(&mut conn).unwrap();
        assert_eq!(conn.query_row::<String, _, _>("SELECT result_json FROM edit_receipts", [], |row| row.get(0)).unwrap(), receipt);
        assert_eq!(conn.query_row::<u32, _, _>("SELECT count(*) FROM material_images", [], |row| row.get(0)).unwrap(), 2);
        assert_eq!(conn.query_row::<u32, _, _>("SELECT count(*) FROM material_instance_owners", [], |row| row.get(0)).unwrap(), 1);
        assert_eq!(conn.query_row::<u32, _, _>("SELECT count(*) FROM material_asset_owners", [], |row| row.get(0)).unwrap(), 1);
        assert_eq!(conn.query_row::<String, _, _>("SELECT storage_id FROM image_instances", [], |row| row.get(0)).unwrap(), storage);
        assert!(conn.execute("UPDATE blobs SET byte_length=101", []).is_err());
        assert!(conn.execute("DELETE FROM blobs", []).is_err());
        conn.execute("INSERT INTO blobs VALUES(?1,'image/jpeg',67108864,3,2)", ["b".repeat(64)]).unwrap();
        assert!(conn.execute("INSERT INTO blobs VALUES(?1,'image/jpeg',67108865,3,2)", ["c".repeat(64)]).is_err());
        conn.execute("INSERT INTO blobs VALUES(?1,'image/png',100,20000,2)", ["d".repeat(64)]).unwrap();
        conn.execute("INSERT INTO blobs VALUES(?1,'image/jpeg',100,12000,8000)", ["e".repeat(64)]).unwrap();
        assert!(conn.execute("INSERT INTO blobs VALUES(?1,'image/png',100,0,2)", ["f".repeat(64)]).is_err());
        remove_image_byte_limit(&mut conn).unwrap();
        conn.execute("INSERT INTO blobs VALUES(?1,'image/png',1073741824,10000,10000)", ["f".repeat(64)]).unwrap();
        assert_eq!(conn.query_row::<String, _, _>("SELECT result_json FROM edit_receipts", [], |row| row.get(0)).unwrap(), receipt);
        assert!(conn.execute("INSERT INTO blobs VALUES(?1,'image/png',0,1,1)", ["0".repeat(64)]).is_err());
    }

    #[test]
    fn library_image_limit_migration_failure_restores_schema_version_and_foreign_keys() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("schema.sql")).unwrap();
        conn.execute_batch("ALTER TABLE material_images ADD COLUMN storage_id TEXT REFERENCES image_instances(storage_id);").unwrap();
        conn.execute_batch(include_str!("schema_v5.sql")).unwrap();
        conn.pragma_update(None, "user_version", 6).unwrap();
        let original: String = conn.query_row("SELECT sql FROM sqlite_master WHERE name='blobs'", [], |row| row.get(0)).unwrap();
        let failing = format!("{}\nSELECT * FROM missing_migration_fixture;", include_str!("schema_v7.sql"));
        assert!(rebuild_blobs(&mut conn, &failing, 7).is_err());
        let restored: String = conn.query_row("SELECT sql FROM sqlite_master WHERE name='blobs'", [], |row| row.get(0)).unwrap();
        assert_eq!(original, restored);
        assert_eq!(conn.pragma_query_value::<u32, _>(None, "user_version", |row| row.get(0)).unwrap(), 6);
        assert!(conn.pragma_query_value::<bool, _>(None, "foreign_keys", |row| row.get(0)).unwrap());
        upgrade_image_byte_limit(&mut conn).unwrap();
        assert_eq!(conn.pragma_query_value::<u32, _>(None, "user_version", |row| row.get(0)).unwrap(), 7);
        let original: String = conn.query_row("SELECT sql FROM sqlite_master WHERE name='blobs'", [], |row| row.get(0)).unwrap();
        let failing = format!("{}\nSELECT * FROM missing_resolution_migration_fixture;", include_str!("schema_v8.sql"));
        assert!(rebuild_blobs(&mut conn, &failing, 8).is_err());
        assert_eq!(conn.query_row::<String, _, _>("SELECT sql FROM sqlite_master WHERE name='blobs'", [], |row| row.get(0)).unwrap(), original);
        assert_eq!(conn.pragma_query_value::<u32, _>(None, "user_version", |row| row.get(0)).unwrap(), 7);
        assert!(conn.pragma_query_value::<bool, _>(None, "foreign_keys", |row| row.get(0)).unwrap());
        remove_image_resolution_limit(&mut conn).unwrap();
        assert_eq!(conn.pragma_query_value::<u32, _>(None, "user_version", |row| row.get(0)).unwrap(), 8);
        let original: String = conn.query_row("SELECT sql FROM sqlite_master WHERE name='blobs'", [], |row| row.get(0)).unwrap();
        let failing = format!("{}\nSELECT * FROM missing_v10_fixture;", include_str!("schema_v10.sql"));
        assert!(rebuild_blobs(&mut conn, &failing, 10).is_err());
        assert_eq!(conn.query_row::<String, _, _>("SELECT sql FROM sqlite_master WHERE name='blobs'", [], |row| row.get(0)).unwrap(), original);
        assert_eq!(conn.pragma_query_value::<u32, _>(None, "user_version", |row| row.get(0)).unwrap(), 8);
        assert!(conn.pragma_query_value::<bool, _>(None, "foreign_keys", |row| row.get(0)).unwrap());
        remove_image_byte_limit(&mut conn).unwrap();
        assert_eq!(conn.pragma_query_value::<u32, _>(None, "user_version", |row| row.get(0)).unwrap(), 10);
    }
}
