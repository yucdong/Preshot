use super::*;

#[test]
fn library_instances_snapshot_cannot_borrow_a_live_edit_publication_identity() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let original = store.save(fixture.save_request()).unwrap();
    let session = store.begin_edit(&original.summary.id, 1).unwrap();
    let pasted = paste(&store, &session, &fixture.bytes);
    let image = staged(&store, &session, &pasted);
    store
        .publish_instance(&session.session_id, &image, &fixture.bytes)
        .unwrap();
    let path = instance_file(&store, &image);
    let mut request = fixture.save_request();
    request.operation_id = session.session_id.clone();
    assert_eq!(
        store.save(request).unwrap_err().code,
        "library_operation_conflict"
    );
    assert!(path.exists());
    assert_eq!(
        store
            .conn
            .query_row::<u32, _, _>("SELECT count(*) FROM snapshot_instance_saves", [], |r| r
                .get(0))
            .unwrap(),
        0
    );
    drop(store);
    let store = fixture.store();
    assert_eq!(
        store.load_edit_image(&session.session_id, &pasted.local_image_id).unwrap(),
        pasted.data_url
    );
    assert!(
        path.exists(),
        "A failed snapshot must not reclassify or clean a live draft's publication"
    );
}

#[test]
fn library_instances_old_staged_imports_gain_storage_without_migrating_unchanged_legacy_images() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let original = store.save_legacy_fixture(fixture.save_request()).unwrap();
    let session = store.begin_edit(&original.summary.id, 1).unwrap();
    let imported = store
        .import_edit_images(
            &session.session_id,
            vec![fixture
                .project
                .join("references")
                .join("0001.png")
                .to_str()
                .unwrap()
                .into()],
        )
        .unwrap()
        .remove(0);
    let manifest_path = draft_path(&store, &session).join("manifest.json");
    let mut manifest: Value = serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    manifest["staged"][0]
        .as_object_mut()
        .unwrap()
        .remove("storageId");
    fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    let mut request = update(&session);
    append(&mut request, &imported);
    let saved = store.commit_edit(request.clone()).unwrap();
    assert_eq!(saved.images[0], original.images[0]);
    assert!(saved.images[1].storage_id.is_some());
    assert_eq!(staged(&store, &session, &imported), saved.images[1]);
    assert_eq!(store.commit_edit(request).unwrap(), saved);
    assert_eq!(store.blob(&saved.images[1]).unwrap(), fixture.bytes);
}

#[test]
fn library_instances_snapshot_save_failure_recovers_files_but_pins_exact_retry_allocations() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let request = fixture.save_request();
    store
        .conn
        .execute_batch(
            "CREATE TRIGGER fail_snapshot_receipt BEFORE INSERT ON save_receipts
        BEGIN SELECT RAISE(ABORT,'injected snapshot receipt failure'); END;",
        )
        .unwrap();
    assert_eq!(
        store.save(request.clone()).unwrap_err().code,
        "library_database"
    );
    let encoded: String = store
        .conn
        .query_row(
            "SELECT image_json FROM instance_publications WHERE session_id=?1",
            [&request.operation_id],
            |r| r.get(0),
        )
        .unwrap();
    let allocation: MaterialImage = serde_json::from_str(&encoded).unwrap();
    let path = instance_file(&store, &allocation);
    assert!(path.exists());
    assert_eq!(
        store
            .conn
            .query_row::<u32, _, _>("SELECT count(*) FROM materials", [], |r| r.get(0))
            .unwrap(),
        0
    );
    let material_id: String = store
        .conn
        .query_row(
            "SELECT material_id FROM snapshot_instance_saves WHERE operation_id=?1",
            [&request.operation_id],
            |r| r.get(0),
        )
        .unwrap();
    store
        .conn
        .execute_batch("DROP TRIGGER fail_snapshot_receipt;")
        .unwrap();
    drop(store);
    let mut store = fixture.store();
    assert!(
        !path.exists(),
        "Opening reclaims definitely uncommitted snapshot files"
    );
    let mut changed = request.clone();
    changed.metadata.name = "Not the original intent".into();
    assert_eq!(
        store.save(changed).unwrap_err().code,
        "library_operation_conflict"
    );
    let mut changed_bytes = Cursor::new(Vec::new());
    DynamicImage::new_rgb8(8, 6)
        .write_to(&mut changed_bytes, ImageFormat::Png)
        .unwrap();
    let source = fixture.project.join("references").join("0001.png");
    fs::write(&source, changed_bytes.into_inner()).unwrap();
    assert_eq!(
        store.save(request.clone()).unwrap_err().code,
        "library_operation_conflict"
    );
    fs::write(&source, &fixture.bytes).unwrap();
    let saved = store.save(request.clone()).unwrap();
    assert_eq!(saved.summary.id, material_id);
    assert_eq!(saved.images[0], allocation);
    assert_eq!(fs::read(path).unwrap(), fixture.bytes);
    assert_eq!(store.save(request).unwrap(), saved);
    for table in ["snapshot_instance_saves", "instance_publications"] {
        assert_eq!(
            store
                .conn
                .query_row::<u32, _, _>(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
                .unwrap(),
            0
        );
    }
}

#[test]
fn library_instances_snapshot_save_keeps_equal_byte_project_sources_physically_distinct() {
    let mut fixture = Fixture::new("imageGroup");
    let mut duplicate = fixture.plan["imageGroups"][0]["images"][0].clone();
    duplicate["id"] = json!("another-project-image");
    duplicate["file"] = json!("references/0002.png");
    fixture.plan["imageGroups"][0]["images"]
        .as_array_mut()
        .unwrap()
        .push(duplicate);
    fs::write(
        fixture.project.join("references").join("0002.png"),
        &fixture.bytes,
    )
    .unwrap();
    fixture.write_plan(&fixture.plan);
    let mut store = fixture.store();
    let request = fixture.save_request();
    let saved = store.save(request.clone()).unwrap();
    assert_eq!(saved.images.len(), 2);
    assert!(saved.images.iter().all(|image| image.storage_id.is_some()));
    assert_ne!(
        saved.images[0].local_image_id,
        saved.images[1].local_image_id
    );
    assert_eq!(saved.images[0].blob_id, saved.images[1].blob_id);
    assert_ne!(saved.images[0].storage_id, saved.images[1].storage_id);
    let first = instance_file(&store, &saved.images[0]);
    let second = instance_file(&store, &saved.images[1]);
    assert_ne!(first, second);
    assert_eq!(fs::read(&first).unwrap(), fixture.bytes);
    assert_eq!(fs::read(&second).unwrap(), fixture.bytes);
    assert_eq!(store.save(request.clone()).unwrap(), saved);
    let another = store.save(fixture.save_request()).unwrap();
    assert_ne!(another.images[0].storage_id, saved.images[0].storage_id);
    drop(store);
    let mut store = fixture.store();
    assert_eq!(store.save(request).unwrap(), saved);
    assert_eq!(store.get(&saved.summary.id).unwrap(), saved);
    fs::write(&first, b"not a hardlink or hash alias").unwrap();
    assert_eq!(fs::read(&second).unwrap(), fixture.bytes);
    assert_eq!(store.blob(&another.images[0]).unwrap(), fixture.bytes);
    assert_eq!(
        fs::read(fixture.project.join("references").join("0001.png")).unwrap(),
        fixture.bytes
    );
    fs::write(&first, &fixture.bytes).unwrap();
    let deleted = store
        .set_deleted(&saved.summary.id, saved.summary.metadata_version, true)
        .unwrap();
    store.purge(&deleted.id, deleted.metadata_version).unwrap();
    assert!(!first.exists() && !second.exists());
    assert_eq!(store.blob(&another.images[0]).unwrap(), fixture.bytes);
    assert_eq!(store.blob(&another.images[1]).unwrap(), fixture.bytes);
}

#[test]
fn library_instances_encoded_jpeg_import_preserves_original_bytes_without_recompression() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let original = store.save(fixture.save_request()).unwrap();
    let session = store.begin_edit(&original.summary.id, 1).unwrap();
    let mut encoded = Cursor::new(Vec::new());
    DynamicImage::new_rgb8(5, 4)
        .write_to(&mut encoded, ImageFormat::Jpeg)
        .unwrap();
    let bytes = encoded.into_inner();
    let image = store
        .import_edit_image_data(
            &session.session_id,
            MaterialEditImageData {
                name: "clipboard.jpg".into(),
                mime_type: "image/jpeg".into(),
                bytes: bytes.clone(),
            },
        )
        .unwrap();
    assert_eq!(
        STANDARD
            .decode(image.data_url.split(',').nth(1).unwrap())
            .unwrap(),
        bytes
    );
    let mut request = update(&session);
    append(&mut request, &image);
    let saved = store.commit_edit(request).unwrap();
    assert_eq!(saved.images[1].mime_type, "image/jpeg");
    assert_eq!(store.blob(&saved.images[1]).unwrap(), bytes);
    assert_eq!(
        fs::read(instance_file(&store, &saved.images[1])).unwrap(),
        bytes
    );
}

fn paste(store: &Store, session: &MaterialEditSession, bytes: &[u8]) -> MaterialEditImage {
    store
        .import_edit_image_data(
            &session.session_id,
            MaterialEditImageData {
                name: "clipboard.png".into(),
                mime_type: "image/png".into(),
                bytes: bytes.to_vec(),
            },
        )
        .unwrap()
}

fn append(request: &mut MaterialContentUpdate, image: &MaterialEditImage) {
    images_mut(&mut request.payload).push(json!({
        "localImageId":image.local_image_id, "aspectRatio":image.width as f64 / image.height as f64,
        "frameWidth":150, "frameHeight":100, "fitMode":"stretch", "caption":"粘贴"
    }));
}

fn staged(
    store: &Store,
    session: &MaterialEditSession,
    image: &MaterialEditImage,
) -> MaterialImage {
    let manifest: Value = serde_json::from_slice(
        &fs::read(draft_path(store, session).join("manifest.json")).unwrap(),
    )
    .unwrap();
    serde_json::from_value(
        manifest["staged"]
            .as_array()
            .unwrap()
            .iter()
            .find(|value| value["localImageId"] == image.local_image_id)
            .unwrap()
            .clone(),
    )
    .unwrap()
}

fn instance_file(store: &Store, image: &MaterialImage) -> PathBuf {
    store
        .instance_path(image.storage_id.as_deref().unwrap(), &image.mime_type)
        .unwrap()
}

#[test]
fn library_instances_every_paste_is_physically_independent_before_after_save_and_reopen() {
    for kind in [
        "imageGroup",
        "shootingLocation",
        "modelCard",
        "prop",
        "clothing",
    ] {
        let fixture = Fixture::new(kind);
        let mut store = fixture.store();
        let original = store.save_legacy_fixture(fixture.save_request()).unwrap();
        let session = store.begin_edit(&original.summary.id, 1).unwrap();
        let a = paste(&store, &session, &fixture.bytes);
        let b = paste(&store, &session, &fixture.bytes);
        let sa = staged(&store, &session, &a);
        let sb = staged(&store, &session, &b);
        assert_ne!(a.local_image_id, b.local_image_id);
        assert_ne!(sa.storage_id, sb.storage_id);
        assert_eq!(sa.blob_id, sb.blob_id);
        let da = draft_path(&store, &session).join(format!("{}.png", a.local_image_id));
        let db = draft_path(&store, &session).join(format!("{}.png", b.local_image_id));
        fs::write(&da, b"changed one staging file").unwrap();
        assert_eq!(fs::read(&db).unwrap(), fixture.bytes);
        fs::write(&da, &fixture.bytes).unwrap();
        let mut request = update(&session);
        append(&mut request, &a);
        append(&mut request, &b);
        let saved = store.commit_edit(request.clone()).unwrap();
        assert_eq!(saved.images[0].storage_id, None);
        assert_eq!(saved.images[1], sa);
        assert_eq!(saved.images[2], sb);
        assert_eq!(store.commit_edit(request.clone()).unwrap(), saved);
        let pa = instance_file(&store, &sa);
        let pb = instance_file(&store, &sb);
        assert_ne!(pa, pb);
        assert_eq!(fs::read(&pa).unwrap(), fixture.bytes);
        assert_eq!(fs::read(&pb).unwrap(), fixture.bytes);
        assert_eq!(
            store
                .conn
                .query_row::<u32, _, _>("SELECT count(*) FROM image_instances", [], |r| r.get(0))
                .unwrap(),
            2
        );
        assert_eq!(
            store
                .conn
                .query_row::<u32, _, _>("SELECT count(*) FROM instance_publications", [], |r| r
                    .get(0))
                .unwrap(),
            0
        );
        store.discard_edit(&session.session_id).unwrap();
        drop(store);
        let mut store = fixture.store();
        assert_eq!(store.get(&saved.summary.id).unwrap(), saved);
        assert_eq!(store.commit_edit(request).unwrap(), saved);
        let renewed = store.begin_edit(&saved.summary.id, 2).unwrap();
        let unchanged = store.commit_edit(update(&renewed)).unwrap();
        assert_eq!(unchanged.images, saved.images);
        assert_eq!(
            store
                .conn
                .query_row::<u32, _, _>("SELECT count(*) FROM image_instances", [], |r| r.get(0))
                .unwrap(),
            2
        );
        store.discard_edit(&renewed.session_id).unwrap();
        fs::write(&pa, b"not linked to equal bytes").unwrap();
        assert_eq!(fs::read(&pb).unwrap(), fixture.bytes);
        assert_eq!(store.blob(&original.images[0]).unwrap(), fixture.bytes);
        assert!(store.blob(&sa).is_err());
        fs::remove_file(&pa).unwrap();
        assert!(
            store.blob(&sa).is_err(),
            "Missing instances must never fall back to legacy equal-hash objects"
        );
        assert_eq!(store.blob(&sb).unwrap(), fixture.bytes);
    }
}

#[test]
fn library_instances_encoded_import_is_closed_bounded_and_cancel_safe() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    for (name, mime, bytes) in [
        ("clipboard.png", "image/jpeg", fixture.bytes.clone()),
        ("clipboard.jpg", "image/png", fixture.bytes.clone()),
        ("C:\\external.png", "image/png", fixture.bytes.clone()),
        ("..\\external.png", "image/png", fixture.bytes.clone()),
        ("clipboard.gif", "image/gif", b"GIF89a".to_vec()),
        (
            "clipboard.png",
            "image/png",
            vec![0; files::MAX_IMAGE_BYTES + 1],
        ),
        ("clipboard.png", "image/png", Vec::new()),
    ] {
        assert!(store
            .import_edit_image_data(
                &session.session_id,
                MaterialEditImageData {
                    name: name.into(),
                    mime_type: mime.into(),
                    bytes,
                }
            )
            .is_err());
    }
    assert_eq!(
        fs::read_dir(draft_path(&store, &session)).unwrap().count(),
        1
    );
    let image = paste(&store, &session, &fixture.bytes);
    let source = staged(&store, &session, &image);
    assert!(
        !instance_file(&store, &source).exists(),
        "Import must not publish canonical assets"
    );
    store.discard_edit(&session.session_id).unwrap();
    assert!(!draft_path(&store, &session).exists());
    assert_eq!(store.get(&material.summary.id).unwrap(), material);
    assert!(store
        .import_edit_image_data(
            &session.session_id,
            MaterialEditImageData {
                name: "clipboard.png".into(),
                mime_type: "image/png".into(),
                bytes: fixture.bytes,
            }
        )
        .is_err());
}

#[test]
fn library_instances_creation_crop_and_new_paste_keep_distinct_storage() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let mut payload = fixture.save_request().snapshot.payload;
    images_mut(&mut payload).clear();
    let session = store.begin_create(payload).unwrap();
    let pasted = paste(&store, &session, &fixture.bytes);
    let cropped = store
        .crop_edit_image(
            &session.session_id,
            &pasted.local_image_id,
            MaterialEditCropBounds {
                x: 0,
                y: 0,
                width: 2,
                height: 2,
            },
        )
        .unwrap();
    let paste_storage = staged(&store, &session, &pasted).storage_id.unwrap();
    let crop_storage = staged(&store, &session, &cropped).storage_id.unwrap();
    assert_ne!(paste_storage, crop_storage);
    let mut request = update(&session);
    append(&mut request, &cropped);
    request.metadata_update = Some(MaterialMetadataUpdate {
        expected_version: 0,
        metadata: fixture.save_request().metadata,
    });
    let saved = store.commit_edit(request).unwrap();
    assert_eq!(saved.summary.revision, 1);
    assert_eq!(
        saved.images[0].storage_id.as_deref(),
        Some(crop_storage.as_str())
    );
    assert_eq!(
        store
            .conn
            .query_row::<u32, _, _>(
                "SELECT count(*) FROM material_asset_owners WHERE kind='object'",
                [],
                |r| r.get(0)
            )
            .unwrap(),
        0
    );
    assert!(!store
        .object_path(&saved.images[0].blob_id, "image/png")
        .unwrap()
        .exists());
    store.discard_edit(&session.session_id).unwrap();
    let renewed = store.begin_edit(&saved.summary.id, 1).unwrap();
    let new_paste = paste(&store, &renewed, &fixture.bytes);
    assert_ne!(
        staged(&store, &renewed, &new_paste).storage_id.unwrap(),
        paste_storage
    );
}

#[test]
fn library_instances_failed_commit_retains_exact_owned_publication_for_retry_or_discard() {
    for retry in [true, false] {
        let fixture = Fixture::new("prop");
        let mut store = fixture.store();
        let material = store.save(fixture.save_request()).unwrap();
        let session = store.begin_edit(&material.summary.id, 1).unwrap();
        let pasted = paste(&store, &session, &fixture.bytes);
        let image = staged(&store, &session, &pasted);
        let path = instance_file(&store, &image);
        let mut request = update(&session);
        append(&mut request, &pasted);
        store
            .conn
            .execute_batch(
                "CREATE TRIGGER fail_instance_commit BEFORE INSERT ON edit_receipts
            BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END;",
            )
            .unwrap();
        assert!(store.commit_edit(request.clone()).is_err());
        assert!(path.exists());
        assert_eq!(store.get(&material.summary.id).unwrap(), material);
        assert_eq!(
            store
                .conn
                .query_row::<u32, _, _>("SELECT count(*) FROM instance_publications", [], |r| r
                    .get(0))
                .unwrap(),
            1
        );
        store
            .conn
            .execute_batch("DROP TRIGGER fail_instance_commit;")
            .unwrap();
        drop(store);
        let mut store = fixture.store();
        assert!(
            path.exists(),
            "Opening must retain retry sources of a live session"
        );
        if retry {
            let result = store.commit_edit(request).unwrap();
            assert_eq!(result.images[1], image);
            store.discard_edit(&session.session_id).unwrap();
            assert_eq!(store.blob(&image).unwrap(), fixture.bytes);
        } else {
            store.discard_edit(&session.session_id).unwrap();
            assert!(!path.exists());
        }
        assert_eq!(
            store
                .conn
                .query_row::<u32, _, _>("SELECT count(*) FROM instance_publications", [], |r| r
                    .get(0))
                .unwrap(),
            0
        );
    }
}

#[test]
fn library_instances_existing_equal_bytes_do_not_authorize_publication_collision() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let pasted = paste(&store, &session, &fixture.bytes);
    let image = staged(&store, &session, &pasted);
    let path = instance_file(&store, &image);
    fs::write(&path, &fixture.bytes).unwrap();
    let mut request = update(&session);
    append(&mut request, &pasted);
    assert_eq!(
        store.commit_edit(request).unwrap_err().code,
        "library_image_corrupt"
    );
    store.discard_edit(&session.session_id).unwrap();
    assert_eq!(
        fs::read(path).unwrap(),
        fixture.bytes,
        "Never delete or adopt unowned matching files"
    );
}

#[test]
fn library_instances_purge_retains_old_receipts_and_live_drafts_then_resumes_every_file() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let original = store.save_legacy_fixture(fixture.save_request()).unwrap();
    let session = store.begin_edit(&original.summary.id, 1).unwrap();
    let a = paste(&store, &session, &fixture.bytes);
    let b = paste(&store, &session, &fixture.bytes);
    let mut request = update(&session);
    append(&mut request, &a);
    append(&mut request, &b);
    let saved = store.commit_edit(request.clone()).unwrap();
    let pa = instance_file(&store, &saved.images[1]);
    let pb = instance_file(&store, &saved.images[2]);
    store.discard_edit(&session.session_id).unwrap();
    let next = store.begin_edit(&saved.summary.id, 2).unwrap();
    let mut remove = update(&next);
    images_mut(&mut remove.payload).clear();
    let removed = store.commit_edit(remove).unwrap();
    assert!(pa.exists() && pb.exists());
    assert_eq!(
        store.commit_edit(request).unwrap(),
        saved,
        "Earlier receipts retain exact instance mappings"
    );
    let trash = store.set_deleted(&removed.summary.id, 1, true).unwrap();
    assert_eq!(
        store
            .purge(&trash.id, trash.metadata_version)
            .unwrap_err()
            .code,
        "library_purge_in_use"
    );
    store.discard_edit(&next.session_id).unwrap();
    store
        .queue_purge(&trash.id, trash.metadata_version)
        .unwrap();
    assert_eq!(
        store
            .conn
            .query_row::<u32, _, _>("SELECT count(*) FROM purge_instance_files", [], |r| r
                .get(0))
            .unwrap(),
        2
    );
    drop(store);
    let store = fixture.store();
    assert!(!pa.exists() && !pb.exists());
    assert_eq!(
        store
            .conn
            .query_row::<u32, _, _>("SELECT count(*) FROM image_instances", [], |r| r.get(0))
            .unwrap(),
        0
    );
    assert_eq!(
        store
            .conn
            .query_row::<u32, _, _>("SELECT count(*) FROM purge_instance_files", [], |r| r
                .get(0))
            .unwrap(),
        0
    );
}

#[test]
fn library_instances_purge_corrupt_file_keeps_outbox_for_repaired_retry() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let original = store.save_legacy_fixture(fixture.save_request()).unwrap();
    let session = store.begin_edit(&original.summary.id, 1).unwrap();
    let pasted = paste(&store, &session, &fixture.bytes);
    let mut request = update(&session);
    append(&mut request, &pasted);
    let saved = store.commit_edit(request).unwrap();
    let path = instance_file(&store, &saved.images[1]);
    store.discard_edit(&session.session_id).unwrap();
    let trash = store.set_deleted(&saved.summary.id, 1, true).unwrap();
    fs::write(&path, b"replaced").unwrap();
    assert_eq!(
        store
            .purge(&trash.id, trash.metadata_version)
            .unwrap_err()
            .code,
        "library_purge_cleanup_pending"
    );
    assert_eq!(
        store
            .conn
            .query_row::<u32, _, _>("SELECT count(*) FROM purge_instance_files", [], |r| r
                .get(0))
            .unwrap(),
        1
    );
    fs::write(&path, &fixture.bytes).unwrap();
    drop(store);
    let store = fixture.store();
    assert!(!path.exists());
    assert_eq!(
        store
            .conn
            .query_row::<u32, _, _>("SELECT count(*) FROM image_instances", [], |r| r.get(0))
            .unwrap(),
        0
    );
}

fn downgrade_legacy_v4(store: &Store) {
    store
        .conn
        .execute_batch(
            "DROP TRIGGER material_asset_image; DROP TRIGGER material_asset_receipt;
         DROP TRIGGER material_instance_mapping; DROP TRIGGER material_instance_receipt;
         DROP TRIGGER immutable_instance;
         DROP INDEX material_image_instance;
         ALTER TABLE material_images DROP COLUMN storage_id;
         DROP TABLE material_instance_owners; DROP TABLE image_instances;
         DROP TABLE instance_publications; DROP TABLE purge_instance_files;
         DROP TABLE snapshot_instance_saves;",
        )
        .unwrap();
    store
        .conn
        .execute_batch(include_str!("schema.sql"))
        .unwrap();
}

#[test]
fn library_instances_v4_migration_preserves_exact_old_receipts_trash_and_interrupted_purge() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save_legacy_fixture(fixture.save_request()).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let request = update(&session);
    let result = store.commit_edit(request.clone()).unwrap();
    let old_json: String = store
        .conn
        .query_row(
            "SELECT result_json FROM edit_receipts WHERE operation_id=?1",
            [&request.operation_id],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!old_json.contains("storageId"));
    store.discard_edit(&session.session_id).unwrap();
    let trash = store.set_deleted(&material.summary.id, 1, true).unwrap();
    let another = store.save_legacy_fixture(fixture.save_request()).unwrap();
    let another_trash = store.set_deleted(&another.summary.id, 1, true).unwrap();
    store
        .queue_purge(&another_trash.id, another_trash.metadata_version)
        .unwrap();
    downgrade_legacy_v4(&store);
    drop(store);
    let mut store = fixture.store();
    assert_eq!(
        store
            .conn
            .pragma_query_value::<u32, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        6
    );
    let migrated_json: String = store
        .conn
        .query_row(
            "SELECT result_json FROM edit_receipts WHERE operation_id=?1",
            [&request.operation_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(old_json, migrated_json);
    assert_eq!(store.commit_edit(request).unwrap(), result);
    assert_eq!(store.get(&material.summary.id).unwrap().summary, trash);
    store
        .set_deleted(&trash.id, trash.metadata_version, false)
        .unwrap();
    assert_eq!(store.blob(&result.images[0]).unwrap(), fixture.bytes);
    assert_eq!(
        store
            .conn
            .query_row::<u32, _, _>("SELECT count(*) FROM purge_files", [], |r| r.get(0))
            .unwrap(),
        0
    );
    assert!(store.get(&another.summary.id).is_err());
}

#[test]
fn library_instances_rejects_newer_database_without_downgrading_or_rebuilding() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let saved = store.save(fixture.save_request()).unwrap();
    store.conn.pragma_update(None, "user_version", 7).unwrap();
    drop(store);
    let failure = Store::open(&fixture.home).err().unwrap();
    assert_eq!(failure.code, "library_database_version");
    let connection =
        rusqlite::Connection::open(fixture.home.join("library").join("library.db")).unwrap();
    assert_eq!(
        connection
            .pragma_query_value::<u32, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        7
    );
    let json: String = connection
        .query_row(
            "SELECT detail_json FROM materials WHERE id=?1",
            [&saved.summary.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        serde_json::from_str::<MaterialDetail>(&json).unwrap(),
        saved
    );
}

#[test]
fn library_instances_v5_migration_failure_rolls_back_column_tables_triggers_and_version() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let saved = store.save_legacy_fixture(fixture.save_request()).unwrap();
    downgrade_legacy_v4(&store);
    {
        let tx = store.conn.transaction().unwrap();
        tx.execute_batch("ALTER TABLE material_images ADD COLUMN storage_id TEXT REFERENCES image_instances(storage_id);").unwrap();
        let interrupted = include_str!("schema_v5.sql").replace(
            "PRAGMA user_version = 5;",
            "SELECT * FROM missing_instance_migration_fixture; PRAGMA user_version = 5;",
        );
        assert!(tx.execute_batch(&interrupted).is_err());
    }
    assert_eq!(
        store
            .conn
            .pragma_query_value::<u32, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        4
    );
    assert!(store
        .conn
        .prepare("SELECT storage_id FROM material_images")
        .is_err());
    assert!(store
        .conn
        .prepare("SELECT storage_id FROM image_instances")
        .is_err());
    drop(store);
    let store = fixture.store();
    assert_eq!(store.get(&saved.summary.id).unwrap(), saved);
}

#[test]
fn library_instances_recovery_reuses_owned_pending_file_and_reclaims_abandoned_publication() {
    for abandon in [false, true] {
        let fixture = Fixture::new("prop");
        let mut store = fixture.store();
        let original = store.save(fixture.save_request()).unwrap();
        let session = store.begin_edit(&original.summary.id, 1).unwrap();
        let pasted = paste(&store, &session, &fixture.bytes);
        let image = staged(&store, &session, &pasted);
        store
            .publish_instance(&session.session_id, &image, &fixture.bytes)
            .unwrap();
        let path = instance_file(&store, &image);
        let pending = path.with_extension("pending");
        fs::rename(&path, &pending).unwrap();
        fs::write(&pending, &fixture.bytes[..fixture.bytes.len() / 2]).unwrap();
        if abandon {
            fs::remove_dir_all(draft_path(&store, &session)).unwrap();
        }

        drop(store);
        let mut store = fixture.store();
        if abandon {
            assert!(!path.exists() && !pending.exists());
            assert_eq!(
                store
                    .conn
                    .query_row::<u32, _, _>("SELECT count(*) FROM instance_publications", [], |r| r
                        .get(0))
                    .unwrap(),
                0
            );
        } else {
            let mut request = update(&session);
            append(&mut request, &pasted);
            let saved = store.commit_edit(request).unwrap();
            assert_eq!(saved.images[1], image);
            assert!(!pending.exists());
            assert_eq!(fs::read(path).unwrap(), fixture.bytes);
        }
    }
}

#[test]
fn library_instances_mixed_insert_reads_the_instance_and_never_substitutes_legacy_bytes() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let original = store.save(fixture.save_request()).unwrap();
    let session = store.begin_edit(&original.summary.id, 1).unwrap();
    let pasted = paste(&store, &session, &fixture.bytes);
    let mut request = update(&session);
    append(&mut request, &pasted);
    let saved = store.commit_edit(request).unwrap();
    let prepared = store
        .prepare_insert(fixture.insert_request(&saved))
        .unwrap();
    assert_eq!(prepared.images.len(), 2);
    assert_ne!(prepared.images[0].file, prepared.images[1].file);
    for image in &prepared.images {
        let path = fixture
            .project
            .join("references")
            .join(files::reference_name(&image.file).unwrap());
        assert_eq!(fs::read(path).unwrap(), fixture.bytes);
    }
    insert::abort(fixture.project.to_str().unwrap(), &prepared.operation_id).unwrap();
    fs::remove_file(instance_file(&store, &saved.images[1])).unwrap();
    assert!(store
        .prepare_insert(fixture.insert_request(&saved))
        .is_err());
    assert_eq!(store.blob(&original.images[0]).unwrap(), fixture.bytes);
}

#[test]
fn library_instances_detail_and_relational_identity_must_agree_and_null_never_means_legacy() {
    for replacement in [
        Value::Null,
        json!("not-a-uuid"),
        json!(Uuid::new_v4().to_string()),
    ] {
        let fixture = Fixture::new("prop");
        let mut store = fixture.store();
        let original = store.save(fixture.save_request()).unwrap();
        let session = store.begin_edit(&original.summary.id, 1).unwrap();
        let pasted = paste(&store, &session, &fixture.bytes);
        let mut request = update(&session);
        append(&mut request, &pasted);
        let saved = store.commit_edit(request).unwrap();
        let mut corrupted = serde_json::to_value(&saved).unwrap();
        corrupted["revision"] = json!(3);
        corrupted["images"][1]["storageId"] = replacement;
        store
            .conn
            .execute(
                "UPDATE materials SET detail_json=?1 WHERE id=?2",
                params![corrupted.to_string(), saved.summary.id],
            )
            .unwrap();
        assert!(store.get(&saved.summary.id).is_err());
    }
}

#[test]
fn library_instances_purge_keeps_outbox_while_a_recovery_draft_is_the_only_owner() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let original = store.save_legacy_fixture(fixture.save_request()).unwrap();
    let session = store.begin_edit(&original.summary.id, 1).unwrap();
    let pasted = paste(&store, &session, &fixture.bytes);
    let mut request = update(&session);
    append(&mut request, &pasted);
    let saved = store.commit_edit(request).unwrap();
    store.discard_edit(&session.session_id).unwrap();
    let recovery = store.begin_edit(&saved.summary.id, 2).unwrap();
    let manifest_path = draft_path(&store, &recovery).join("manifest.json");
    let mut manifest: Value = serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    // Model an earlier retained recovery owner whose material record is not
    // the one being purged; its immutable snapshot still pins this instance.
    manifest["material"]["id"] = json!(Uuid::new_v4().to_string());
    fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    let path = instance_file(&store, &saved.images[1]);
    let trash = store.set_deleted(&saved.summary.id, 1, true).unwrap();
    store.purge(&trash.id, trash.metadata_version).unwrap();
    assert!(path.exists());
    assert_eq!(
        store
            .conn
            .query_row::<u32, _, _>("SELECT count(*) FROM purge_instance_files", [], |r| r
                .get(0))
            .unwrap(),
        1
    );
    store.discard_edit(&recovery.session_id).unwrap();
    drop(store);
    let store = fixture.store();
    assert!(!path.exists());
    assert_eq!(
        store
            .conn
            .query_row::<u32, _, _>("SELECT count(*) FROM purge_instance_files", [], |r| r
                .get(0))
            .unwrap(),
        0
    );
}
