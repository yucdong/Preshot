use super::*;

fn trash(store: &mut Store, material: &MaterialDetail) -> MaterialSummary {
    store
        .set_deleted(
            &material.summary.id,
            material.summary.metadata_version,
            true,
        )
        .unwrap()
}

fn preview(store: &mut Store, material: &MaterialDetail, bytes: Vec<u8>, width: u32, height: u32) {
    store
        .save_preview(
            &material.summary.id,
            material.summary.revision,
            MaterialPreviewInput {
                bytes,
                width,
                height,
                render_key: format!("revision-{}", material.summary.revision),
                is_partial: false,
            },
        )
        .unwrap();
}

#[test]
fn library_purge_removes_record_original_preview_search_and_preserves_project() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save_legacy_fixture(fixture.save_request()).unwrap();
    let object = store
        .object_path(&material.images[0].blob_id, &material.images[0].mime_type)
        .unwrap();
    let cached = store.preview_path(&files::hash(&fixture.bytes)).unwrap();
    preview(&mut store, &material, fixture.bytes.clone(), 3, 2);
    let deleted = trash(&mut store, &material);
    store.purge(&deleted.id, deleted.metadata_version).unwrap();
    assert_eq!(
        store.get(&deleted.id).unwrap_err().code,
        "library_not_found"
    );
    assert!(!object.exists());
    assert!(!cached.exists());
    for query in ["", "杭州", "摄影"] {
        for trashed in [false, true] {
            let result = store
                .search(
                    serde_json::from_value(json!({
                        "query":query,"trash":trashed,"sort":"relevance","offset":0,"limit":20
                    }))
                    .unwrap(),
                )
                .unwrap();
            assert_eq!(result.total, 0);
        }
    }
    for table in [
        "materials",
        "material_images",
        "blobs",
        "save_receipts",
        "material_search",
    ] {
        assert_eq!(
            store
                .conn
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0,
            "{table}"
        );
    }
    assert_eq!(
        fs::read(fixture.project.join("references").join("0001.png")).unwrap(),
        fixture.bytes
    );
    assert_eq!(
        crate::workspace::read_manifest(&fixture.project)
            .unwrap()
            .plan,
        Some(fixture.plan.clone())
    );
}

#[test]
fn library_purge_validates_identity_version_trash_and_restore_races() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let id = &material.summary.id;
    assert_eq!(
        store.purge("../outside", 1).unwrap_err().code,
        "library_invalid_id"
    );
    assert_eq!(
        store.purge(id, 0).unwrap_err().code,
        "library_metadata_conflict"
    );
    assert_eq!(store.purge(id, 1).unwrap_err().code, "library_not_deleted");
    let deleted = trash(&mut store, &material);
    assert_eq!(
        store.purge(id, 1).unwrap_err().code,
        "library_metadata_conflict"
    );
    store
        .set_deleted(id, deleted.metadata_version, false)
        .unwrap();
    assert_eq!(
        store.purge(id, deleted.metadata_version).unwrap_err().code,
        "library_metadata_conflict"
    );
    assert_eq!(store.purge(id, 3).unwrap_err().code, "library_not_deleted");
    assert_eq!(store.blob(&material.images[0]).unwrap(), fixture.bytes);
}

#[test]
fn library_purge_lost_response_retry_and_save_receipt_cannot_recreate_material() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let request = fixture.save_request();
    let material = store.save(request.clone()).unwrap();
    let deleted = trash(&mut store, &material);
    store.purge(&deleted.id, deleted.metadata_version).unwrap();
    drop(store);
    let mut store = fixture.store();
    store.purge(&deleted.id, deleted.metadata_version).unwrap();
    assert_eq!(
        store.save(request.clone()).unwrap_err().code,
        "library_purged"
    );
    let mut different = request;
    different.metadata.name = "不同意图".into();
    assert_eq!(
        store.save(different).unwrap_err().code,
        "library_operation_conflict"
    );
    assert_eq!(
        store.purge(&deleted.id, 1).unwrap_err().code,
        "library_metadata_conflict"
    );
    assert_eq!(
        store.set_deleted(&deleted.id, 2, false).unwrap_err().code,
        "library_not_found"
    );
}

#[test]
fn library_purge_blocks_recoverable_edit_draft_until_explicit_discard() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let deleted = trash(&mut store, &material);
    drop(store);
    let mut store = fixture.store();
    assert_eq!(
        store
            .purge(&deleted.id, deleted.metadata_version)
            .unwrap_err()
            .code,
        "library_purge_in_use"
    );
    assert_eq!(store.blob(&material.images[0]).unwrap(), fixture.bytes);
    store.discard_edit(&session.session_id).unwrap();
    store.purge(&deleted.id, deleted.metadata_version).unwrap();
}

#[test]
fn library_purge_retains_shared_objects_and_previews_until_last_material() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let first = store.save_legacy_fixture(fixture.save_request()).unwrap();
    let second = store.save_legacy_fixture(fixture.save_request()).unwrap();
    preview(&mut store, &first, fixture.bytes.clone(), 3, 2);
    preview(&mut store, &second, fixture.bytes.clone(), 3, 2);
    let cached = store.preview_path(&files::hash(&fixture.bytes)).unwrap();
    let deleted = trash(&mut store, &first);
    store.purge(&deleted.id, deleted.metadata_version).unwrap();
    assert_eq!(store.blob(&second.images[0]).unwrap(), fixture.bytes);
    assert!(cached.exists());
    assert!(store.load_preview(&second.summary.id, 1).unwrap().is_some());
    let deleted = trash(&mut store, &second);
    store.purge(&deleted.id, deleted.metadata_version).unwrap();
    assert!(!cached.exists());
    assert!(!store
        .object_path(&second.images[0].blob_id, "image/png")
        .unwrap()
        .exists());
}

#[test]
fn library_purge_does_not_block_prepared_insertion_or_delete_undo_copies() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let request = fixture.insert_request(&material);
    let prepared = store.prepare_insert(request.clone()).unwrap();
    let deleted = trash(&mut store, &material);
    store.purge(&deleted.id, deleted.metadata_version).unwrap();
    assert_eq!(store.prepare_insert(request).unwrap(), prepared);
    let next = fixture.next_plan(&prepared);
    insert::commit(fixture.commit_request(&prepared, &next)).unwrap();
    insert::commit(fixture.commit_request(&prepared, &next)).unwrap();
    let canonical = files::directory(&fixture.project).unwrap();
    assert_eq!(
        fs::read(files::reference(&canonical, &prepared.images[0].file, true).unwrap()).unwrap(),
        fixture.bytes
    );
    assert!(
        insert::retain_reference_for_material_history(&canonical, &prepared.images[0].file)
            .unwrap()
    );
}

fn edit_request(session: &MaterialEditSession) -> MaterialContentUpdate {
    MaterialContentUpdate {
        operation_id: Uuid::new_v4().to_string(),
        session_id: session.session_id.clone(),
        payload: session.material.payload.clone(),
        metadata_update: None,
    }
}

fn png(width: u32, height: u32) -> Vec<u8> {
    let mut encoded = Cursor::new(Vec::new());
    DynamicImage::new_rgb8(width, height)
        .write_to(&mut encoded, ImageFormat::Png)
        .unwrap();
    encoded.into_inner()
}

fn count(store: &Store, table: &str) -> i64 {
    store
        .conn
        .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .unwrap()
}

#[test]
fn library_purge_sql_failure_rolls_back_canonical_record_search_receipts_and_outbox() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let save = fixture.save_request();
    let material = store.save(save.clone()).unwrap();
    preview(&mut store, &material, fixture.bytes.clone(), 3, 2);
    let deleted = trash(&mut store, &material);
    let cached = store.preview_path(&files::hash(&fixture.bytes)).unwrap();
    store
        .conn
        .execute_batch(
            "CREATE TRIGGER fail_purge BEFORE DELETE ON materials
         BEGIN SELECT RAISE(ABORT,'sensitive stored content'); END;",
        )
        .unwrap();
    let failure = store
        .purge(&deleted.id, deleted.metadata_version)
        .unwrap_err();
    assert_eq!(failure.code, "library_database");
    assert!(!failure.message.contains("sensitive"));
    assert_eq!(store.get(&deleted.id).unwrap().summary, deleted);
    assert_eq!(store.save(save).unwrap().summary, deleted);
    assert_eq!(store.blob(&material.images[0]).unwrap(), fixture.bytes);
    assert!(cached.exists());
    assert_eq!(count(&store, "purge_receipts"), 0);
    assert_eq!(count(&store, "purge_files"), 0);
    assert_eq!(count(&store, "purged_operations"), 0);
    let search = store
        .search(
            serde_json::from_value(json!({
                "query":"杭州","trash":true,"sort":"relevance","offset":0,"limit":20
            }))
            .unwrap(),
        )
        .unwrap();
    assert_eq!(search.total, 1);
    store
        .conn
        .execute_batch("DROP TRIGGER fail_purge;")
        .unwrap();
    store.purge(&deleted.id, deleted.metadata_version).unwrap();
}

#[test]
fn library_purge_interrupted_after_database_commit_recovers_on_open_and_retry_is_idempotent() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save_legacy_fixture(fixture.save_request()).unwrap();
    let deleted = trash(&mut store, &material);
    let object = store
        .object_path(&material.images[0].blob_id, "image/png")
        .unwrap();
    store
        .queue_purge(&deleted.id, deleted.metadata_version)
        .unwrap();
    assert!(object.exists());
    assert_eq!(count(&store, "materials"), 0);
    assert_eq!(count(&store, "purge_files"), 1);
    drop(store);
    let mut store = fixture.store();
    assert!(
        !object.exists(),
        "Opening the library must finish the durable, already-approved purge"
    );
    assert_eq!(
        store
            .set_deleted(&deleted.id, deleted.metadata_version, false)
            .unwrap_err()
            .code,
        "library_not_found"
    );
    store.purge(&deleted.id, deleted.metadata_version).unwrap();
    assert!(!object.exists());
    assert_eq!(count(&store, "purge_files"), 0);
    assert_eq!(
        store
            .conn
            .query_row("SELECT completed FROM purge_receipts", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
}

#[test]
fn library_purge_partial_cleanup_reports_pending_without_paths_and_retries_missing_files() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let save = fixture.save_request();
    let material = store.save_legacy_fixture(save.clone()).unwrap();
    preview(&mut store, &material, fixture.bytes.clone(), 3, 2);
    let deleted = trash(&mut store, &material);
    let object = store
        .object_path(&material.images[0].blob_id, "image/png")
        .unwrap();
    let cached = store.preview_path(&files::hash(&fixture.bytes)).unwrap();
    fs::remove_file(&cached).unwrap();
    fs::create_dir(&cached).unwrap();
    let failure = store
        .purge(&deleted.id, deleted.metadata_version)
        .unwrap_err();
    assert_eq!(failure.code, "library_purge_cleanup_pending");
    assert!(failure
        .message
        .contains("same material ID and metadata version"));
    assert!(!failure.message.contains(fixture.home.to_str().unwrap()));
    assert!(
        !object.exists(),
        "Completed individual targets need not be restored"
    );
    assert!(
        cached.is_dir(),
        "Never recursively remove an unexpected directory"
    );
    assert_eq!(count(&store, "materials"), 0);
    assert_eq!(count(&store, "purge_files"), 1);
    assert_eq!(store.save(save).unwrap_err().code, "library_purged");
    drop(store);
    let failure = match Store::open(&fixture.home) {
        Ok(_) => panic!("Opening must surface unfinished cleanup, not hide it"),
        Err(failure) => failure,
    };
    assert_eq!(failure.code, "library_purge_cleanup_pending");
    assert!(failure
        .message
        .contains("retry reading the material library"));
    assert!(cached.is_dir());
    fs::remove_dir(&cached).unwrap();
    fs::write(&cached, &fixture.bytes).unwrap();
    let mut store = fixture.store();
    assert!(
        !cached.exists(),
        "Retry Reading must resume the retained outbox"
    );
    store.purge(&deleted.id, deleted.metadata_version).unwrap();
    assert!(!cached.exists());
}

#[test]
fn library_purge_cleanup_sql_failure_after_unlink_keeps_retry_ownership() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save_legacy_fixture(fixture.save_request()).unwrap();
    let deleted = trash(&mut store, &material);
    let object = store
        .object_path(&material.images[0].blob_id, "image/png")
        .unwrap();
    store
        .conn
        .execute_batch(
            "CREATE TRIGGER fail_cleanup BEFORE DELETE ON purge_files
         BEGIN SELECT RAISE(ABORT,'cleanup database failure'); END;",
        )
        .unwrap();
    assert_eq!(
        store
            .purge(&deleted.id, deleted.metadata_version)
            .unwrap_err()
            .code,
        "library_purge_cleanup_pending"
    );
    assert!(!object.exists());
    assert_eq!(count(&store, "materials"), 0);
    assert_eq!(count(&store, "blobs"), 1);
    assert_eq!(count(&store, "purge_files"), 1);
    drop(store);
    let failure = match Store::open(&fixture.home) {
        Ok(_) => panic!("Opening must not discard a failed cleanup transaction"),
        Err(failure) => failure,
    };
    assert_eq!(failure.code, "library_purge_cleanup_pending");
    let repair = Connection::open(fixture.home.join("library").join("library.db")).unwrap();
    repair.execute_batch("DROP TRIGGER fail_cleanup;").unwrap();
    drop(repair);
    let mut store = fixture.store();
    store.purge(&deleted.id, deleted.metadata_version).unwrap();
    assert_eq!(count(&store, "blobs"), 0);
    assert_eq!(count(&store, "purge_files"), 0);
}

#[test]
fn library_purge_open_recovery_preserves_files_claimed_by_later_material_data() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let first = store.save_legacy_fixture(fixture.save_request()).unwrap();
    preview(&mut store, &first, fixture.bytes.clone(), 3, 2);
    let deleted = trash(&mut store, &first);
    store
        .queue_purge(&deleted.id, deleted.metadata_version)
        .unwrap();
    let second = store.save_legacy_fixture(fixture.save_request()).unwrap();
    preview(&mut store, &second, fixture.bytes.clone(), 3, 2);
    drop(store);
    let mut store = fixture.store();
    assert_eq!(count(&store, "purge_files"), 0);
    store.purge(&deleted.id, deleted.metadata_version).unwrap();
    assert_eq!(store.blob(&second.images[0]).unwrap(), fixture.bytes);
    assert!(store.load_preview(&second.summary.id, 1).unwrap().is_some());
    assert_eq!(count(&store, "purge_files"), 0);
    let second_deleted = trash(&mut store, &second);
    store
        .purge(&second_deleted.id, second_deleted.metadata_version)
        .unwrap();
    assert_eq!(count(&store, "blobs"), 0);
}

#[test]
fn library_purge_removes_attributable_old_revision_blobs_previews_and_edit_receipts() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let save = fixture.save_request();
    let material = store.save_legacy_fixture(save.clone()).unwrap();
    preview(&mut store, &material, fixture.bytes.clone(), 3, 2);
    let first_preview = store.preview_path(&files::hash(&fixture.bytes)).unwrap();
    let second_png = png(4, 3);
    preview(&mut store, &material, second_png.clone(), 4, 3);
    let second_preview = store.preview_path(&files::hash(&second_png)).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let request = edit_request(&session);
    let revised = store.commit_edit(request.clone()).unwrap();
    store.discard_edit(&session.session_id).unwrap();
    let session2 = store.begin_edit(&material.summary.id, 2).unwrap();
    let mut remove_images = edit_request(&session2);
    remove_images.payload.component["gallery"]["images"] = json!([]);
    let empty = store.commit_edit(remove_images.clone()).unwrap();
    store.discard_edit(&session2.session_id).unwrap();
    assert!(empty.images.is_empty());
    let original = store
        .object_path(&material.images[0].blob_id, "image/png")
        .unwrap();
    assert!(original.exists());
    assert_eq!(revised.images, material.images);
    let deleted = trash(&mut store, &empty);
    store.purge(&deleted.id, deleted.metadata_version).unwrap();
    assert!(!original.exists());
    assert!(!first_preview.exists());
    assert!(!second_preview.exists());
    assert_eq!(count(&store, "edit_receipts"), 0);
    assert_eq!(count(&store, "material_asset_owners"), 0);
    assert_eq!(
        store.commit_edit(request.clone()).unwrap_err().code,
        "library_purged"
    );
    assert_eq!(
        store.commit_edit(remove_images).unwrap_err().code,
        "library_purged"
    );
    let mut changed = request;
    changed.payload.component["source"] = json!("different");
    assert_eq!(
        store.commit_edit(changed).unwrap_err().code,
        "library_operation_conflict"
    );
    assert_eq!(store.save(save).unwrap_err().code, "library_purged");
    assert!(
        store
            .conn
            .execute(
                "INSERT INTO materials(id,kind,detail_json) VALUES(?1,?2,?3)",
                params![
                    material.summary.id,
                    material.summary.kind.as_str(),
                    serde_json::to_string(&material).unwrap()
                ]
            )
            .is_err(),
        "Even a stale direct insert cannot reuse a purged identity"
    );
}

#[test]
fn library_purge_retains_other_material_old_receipt_and_draft_blob_references() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let first = store.save(fixture.save_request()).unwrap();
    let second = store.save(fixture.save_request()).unwrap();
    let session = store.begin_edit(&second.summary.id, 1).unwrap();
    let request = edit_request(&session);
    store.commit_edit(request.clone()).unwrap();
    let session2 = store.begin_edit(&second.summary.id, 2).unwrap();
    let mut changed = edit_request(&session2);
    changed.payload.component["gallery"]["images"] = json!([]);
    store.commit_edit(changed).unwrap();
    store.discard_edit(&session2.session_id).unwrap();
    let deleted = trash(&mut store, &first);
    store.purge(&deleted.id, deleted.metadata_version).unwrap();
    assert_eq!(store.blob(&second.images[0]).unwrap(), fixture.bytes);
    assert!(store
        .load_edit_image(&session.session_id, &second.images[0].local_image_id)
        .is_ok());
    store.discard_edit(&session.session_id).unwrap();
    assert_eq!(store.commit_edit(request).unwrap().images, second.images);
    assert_eq!(store.blob(&second.images[0]).unwrap(), fixture.bytes);
}

#[test]
fn library_purge_rejects_unverifiable_draft_without_deleting_anything() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let draft = store
        .root
        .join("drafts")
        .join(session.session_id)
        .join("manifest.json");
    fs::write(draft, b"{\"malformed\":\"sensitive draft\"}").unwrap();
    let deleted = trash(&mut store, &material);
    let failure = store
        .purge(&deleted.id, deleted.metadata_version)
        .unwrap_err();
    assert_eq!(failure.code, "library_purge_in_use");
    assert!(!failure.message.contains("sensitive"));
    assert_eq!(store.get(&deleted.id).unwrap().summary, deleted);
    assert_eq!(store.blob(&material.images[0]).unwrap(), fixture.bytes);
    assert_eq!(count(&store, "purge_receipts"), 0);
}

#[test]
fn library_purge_does_not_sweep_unattributed_objects_or_unexpected_replacement_bytes() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save_legacy_fixture(fixture.save_request()).unwrap();
    let unrelated_bytes = png(8, 5);
    let unrelated = store
        .object_path(&files::hash(&unrelated_bytes), "image/png")
        .unwrap();
    fs::write(&unrelated, &unrelated_bytes).unwrap();
    let object = store
        .object_path(&material.images[0].blob_id, "image/png")
        .unwrap();
    fs::write(&object, b"foreign replacement").unwrap();
    let deleted = trash(&mut store, &material);
    assert_eq!(
        store
            .purge(&deleted.id, deleted.metadata_version)
            .unwrap_err()
            .code,
        "library_purge_cleanup_pending"
    );
    assert_eq!(fs::read(&object).unwrap(), b"foreign replacement");
    assert_eq!(fs::read(&unrelated).unwrap(), unrelated_bytes);
    fs::write(&object, &fixture.bytes).unwrap();
    store.purge(&deleted.id, deleted.metadata_version).unwrap();
    drop(store);
    let _store = fixture.store();
    assert_eq!(fs::read(&unrelated).unwrap(), unrelated_bytes);
}

#[test]
fn library_purge_open_does_not_authorize_cleanup_of_ordinary_trashed_materials() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    preview(&mut store, &material, fixture.bytes.clone(), 3, 2);
    let deleted = trash(&mut store, &material);
    drop(store);
    let store = fixture.store();
    assert_eq!(store.get(&deleted.id).unwrap().summary, deleted);
    assert_eq!(store.blob(&material.images[0]).unwrap(), fixture.bytes);
    assert!(store.load_preview(&deleted.id, 1).unwrap().is_some());
    assert_eq!(count(&store, "purge_receipts"), 0);
}

#[test]
fn library_purge_open_resumes_failed_completion_receipt_even_with_an_empty_outbox() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let deleted = trash(&mut store, &material);
    store
        .conn
        .execute_batch(
            "CREATE TRIGGER fail_completion BEFORE UPDATE ON purge_receipts
         WHEN new.completed=1
         BEGIN SELECT RAISE(ABORT,'completion receipt failure'); END;",
        )
        .unwrap();
    assert_eq!(
        store
            .purge(&deleted.id, deleted.metadata_version)
            .unwrap_err()
            .code,
        "library_purge_cleanup_pending"
    );
    assert_eq!(count(&store, "purge_files"), 0);
    assert_eq!(count(&store, "blobs"), 0);
    drop(store);
    let failure = match Store::open(&fixture.home) {
        Ok(_) => panic!("The failed completion receipt must remain discoverable"),
        Err(failure) => failure,
    };
    assert_eq!(failure.code, "library_purge_cleanup_pending");
    let repair = Connection::open(fixture.home.join("library").join("library.db")).unwrap();
    repair
        .execute_batch("DROP TRIGGER fail_completion;")
        .unwrap();
    drop(repair);
    let mut store = fixture.store();
    store.purge(&deleted.id, deleted.metadata_version).unwrap();
    assert_eq!(
        store
            .conn
            .query_row("SELECT completed FROM purge_receipts", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
}

#[test]
fn library_purge_v2_migration_recovers_current_and_historical_receipt_ownership() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save_legacy_fixture(fixture.save_request()).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    store.commit_edit(edit_request(&session)).unwrap();
    store.discard_edit(&session.session_id).unwrap();
    let session = store.begin_edit(&material.summary.id, 2).unwrap();
    let mut empty = edit_request(&session);
    empty.payload.component["gallery"]["images"] = json!([]);
    let latest = store.commit_edit(empty).unwrap();
    store.discard_edit(&session.session_id).unwrap();
    preview(&mut store, &latest, fixture.bytes.clone(), 3, 2);
    store
        .conn
        .execute_batch(
            "DELETE FROM material_asset_owners;
         DELETE FROM library_meta WHERE key='asset_ownership_version';
         PRAGMA user_version=2;",
        )
        .unwrap();
    drop(store);
    let mut store = fixture.store();
    assert_eq!(count(&store, "material_asset_owners"), 2);
    let deleted = trash(&mut store, &latest);
    let original = store
        .object_path(&material.images[0].blob_id, "image/png")
        .unwrap();
    let cached = store.preview_path(&files::hash(&fixture.bytes)).unwrap();
    store.purge(&deleted.id, deleted.metadata_version).unwrap();
    assert!(!original.exists());
    assert!(!cached.exists());
}

#[test]
fn library_purge_removes_failed_edit_publication_after_discard_but_not_original_source() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let source = fixture._root.path().join("selected-original.png");
    let bytes = png(7, 4);
    fs::write(&source, &bytes).unwrap();
    let staged = store
        .import_edit_images(&session.session_id, vec![source.to_str().unwrap().into()])
        .unwrap()
        .remove(0);
    let mut update = edit_request(&session);
    update.payload.component["gallery"]["images"][0]["localImageId"] = json!(staged.local_image_id);
    store
        .conn
        .execute_batch(
            "CREATE TRIGGER fail_edit BEFORE UPDATE ON materials
         BEGIN SELECT RAISE(ABORT,'edit transaction failed'); END;",
        )
        .unwrap();
    assert_eq!(
        store.commit_edit(update).unwrap_err().code,
        "library_database"
    );
    let image_json: String = store.conn.query_row(
        "SELECT image_json FROM instance_publications WHERE session_id=?1", [&session.session_id], |r| r.get(0),
    ).unwrap();
    let published: MaterialImage = serde_json::from_str(&image_json).unwrap();
    let orphan = store.instance_path(published.storage_id.as_deref().unwrap(), "image/png").unwrap();
    assert!(
        orphan.exists(),
        "File-first publication survives the failed edit transaction"
    );
    store.conn.execute_batch("DROP TRIGGER fail_edit;").unwrap();
    store.discard_edit(&session.session_id).unwrap();
    let deleted = trash(&mut store, &material);
    store.purge(&deleted.id, deleted.metadata_version).unwrap();
    assert!(
        !orphan.exists(),
        "Write-ahead asset ownership attributes this failed publication"
    );
    assert_eq!(fs::read(&source).unwrap(), bytes);
    assert_eq!(
        fs::read(fixture.project.join("references").join("0001.png")).unwrap(),
        fixture.bytes
    );
}

#[test]
fn library_purge_removes_failed_preview_publication_after_reopen() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    store
        .conn
        .execute_batch(
            "CREATE TRIGGER fail_preview BEFORE UPDATE ON materials
         BEGIN SELECT RAISE(ABORT,'preview transaction failed'); END;",
        )
        .unwrap();
    assert_eq!(
        store
            .save_preview(
                &material.summary.id,
                1,
                MaterialPreviewInput {
                    bytes: fixture.bytes.clone(),
                    width: 3,
                    height: 2,
                    render_key: "preview".into(),
                    is_partial: false,
                },
            )
            .unwrap_err()
            .code,
        "library_database"
    );
    let cached = store.preview_path(&files::hash(&fixture.bytes)).unwrap();
    assert!(cached.exists());
    store
        .conn
        .execute_batch("DROP TRIGGER fail_preview;")
        .unwrap();
    drop(store);
    let mut store = fixture.store();
    let deleted = trash(&mut store, &material);
    store.purge(&deleted.id, deleted.metadata_version).unwrap();
    assert!(!cached.exists());
}

#[test]
fn library_purge_revalidates_outbox_hashes_before_deriving_paths() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save_legacy_fixture(fixture.save_request()).unwrap();
    let deleted = trash(&mut store, &material);
    store
        .queue_purge(&deleted.id, deleted.metadata_version)
        .unwrap();
    store
        .conn
        .execute_batch(
            "PRAGMA ignore_check_constraints=ON;
         UPDATE purge_files SET hash='../../outside';
         PRAGMA ignore_check_constraints=OFF;",
        )
        .unwrap();
    assert_eq!(
        store
            .purge(&deleted.id, deleted.metadata_version)
            .unwrap_err()
            .code,
        "library_purge_cleanup_pending"
    );
    assert_eq!(store.blob(&material.images[0]).unwrap(), fixture.bytes);
    assert_eq!(
        fs::read(fixture.project.join("references").join("0001.png")).unwrap(),
        fixture.bytes
    );
    store
        .conn
        .execute(
            "UPDATE purge_files SET hash=?1",
            [&material.images[0].blob_id],
        )
        .unwrap();
    store.purge(&deleted.id, deleted.metadata_version).unwrap();
}

#[cfg(windows)]
#[test]
fn library_purge_refuses_object_bucket_junction_without_touching_its_destination() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save_legacy_fixture(fixture.save_request()).unwrap();
    let deleted = trash(&mut store, &material);
    let object = store
        .object_path(&material.images[0].blob_id, "image/png")
        .unwrap();
    let bucket = object.parent().unwrap().to_path_buf();
    let relocated = fixture.project.join("original-source-directory");
    fs::rename(&bucket, &relocated).unwrap();
    let output = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&bucket)
        .arg(relocated.canonicalize().unwrap())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        store
            .purge(&deleted.id, deleted.metadata_version)
            .unwrap_err()
            .code,
        "library_purge_cleanup_pending"
    );
    let retained = relocated.join(object.file_name().unwrap());
    assert_eq!(fs::read(&retained).unwrap(), fixture.bytes);
    fs::remove_dir(&bucket).unwrap();
    fs::create_dir(&bucket).unwrap();
    fs::write(&object, &fixture.bytes).unwrap();
    store.purge(&deleted.id, deleted.metadata_version).unwrap();
    assert!(!object.exists());
    assert_eq!(fs::read(&retained).unwrap(), fixture.bytes);
}

#[cfg(windows)]
#[test]
fn library_purge_locked_image_returns_retryable_failure_and_does_not_claim_success() {
    use std::os::windows::fs::OpenOptionsExt;
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save_legacy_fixture(fixture.save_request()).unwrap();
    let deleted = trash(&mut store, &material);
    let object = store
        .object_path(&material.images[0].blob_id, "image/png")
        .unwrap();
    let locked = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&object)
        .unwrap();
    assert_eq!(
        store
            .purge(&deleted.id, deleted.metadata_version)
            .unwrap_err()
            .code,
        "library_purge_cleanup_pending"
    );
    assert!(object.exists());
    assert_eq!(count(&store, "purge_files"), 1);
    drop(locked);
    store.purge(&deleted.id, deleted.metadata_version).unwrap();
    assert!(!object.exists());
}

#[test]
#[ignore = "Worker invoked only by the cross-process purge regression"]
fn library_purge_worker() {
    let home = PathBuf::from(std::env::var_os("PRESHOT_PURGE_TEST_HOME").unwrap());
    let id = std::env::var("PRESHOT_PURGE_TEST_ID").unwrap();
    fs::write(home.join("purge-worker-started"), b"started").unwrap();
    let mut store = Store::open(&home).unwrap();
    let result = store.purge(&id, 2);
    fs::write(
        home.join("purge-worker-result"),
        result
            .err()
            .map(|e| e.code)
            .unwrap_or_else(|| "success".into()),
    )
    .unwrap();
}

#[test]
fn library_purge_cross_process_lock_rechecks_version_after_restore_wins_race() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    trash(&mut store, &material);
    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "library::tests::permanent_delete::library_purge_worker",
            "--ignored",
            "--quiet",
        ])
        .env("PRESHOT_PURGE_TEST_HOME", &fixture.home)
        .env("PRESHOT_PURGE_TEST_ID", &material.summary.id)
        .spawn()
        .unwrap();
    let start = std::time::Instant::now();
    while !fixture.home.join("purge-worker-started").exists() {
        assert!(start.elapsed() < std::time::Duration::from_secs(10));
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert!(!fixture.home.join("purge-worker-result").exists());
    store.set_deleted(&material.summary.id, 2, false).unwrap();
    drop(store);
    assert!(child.wait().unwrap().success());
    assert_eq!(
        fs::read_to_string(fixture.home.join("purge-worker-result")).unwrap(),
        "library_metadata_conflict"
    );
    let store = fixture.store();
    assert!(store
        .get(&material.summary.id)
        .unwrap()
        .summary
        .deleted_at
        .is_none());
    assert_eq!(store.blob(&material.images[0]).unwrap(), fixture.bytes);
}
