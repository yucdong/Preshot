use super::*;

#[test]
fn whole_library_move_preserves_materials_group_paths_edit_drafts_and_exact_receipts() {
    for kind in ["imageGroup", "shootingLocation", "modelCard", "prop", "clothing"] {
        let fixture = Fixture::new(kind);
        let mut store = fixture.store();
        let request = fixture.save_request();
        let material = store.save(request.clone()).unwrap();
        let draft = store.begin_edit(&material.summary.id, 1).unwrap();
        let staged = store.import_edit_images(&draft.session_id,
            vec![fixture.project.join("references/0001.png").to_string_lossy().into_owned()]).unwrap();
        drop(store);
        let target = fixture.home.parent().unwrap().join("moved-library");
        crate::storage::tests::move_fixture(&fixture.home, &target);
        let mut store = Store::open_root(&target).unwrap();
        assert_eq!(store.get(&material.summary.id).unwrap(), material);
        assert_eq!(store.save(request).unwrap(), material);
        assert_eq!(store.blob(&material.images[0]).unwrap(), fixture.bytes);
        assert!(store.edit_original_image_path(&draft.session_id, &staged[0].local_image_id).unwrap().starts_with(target.canonicalize().unwrap()));
        if kind == "imageGroup" {
            assert!(store.original_group_path(&material.summary.id, 1).unwrap().starts_with(target.canonicalize().unwrap()));
        }
        store.discard_edit(&draft.session_id).unwrap();
        let prepared = store.prepare_insert(fixture.insert_request(&material)).unwrap();
        assert!(!prepared.images.is_empty());
    }
}

#[test]
fn group_originals_failed_save_reopens_and_reuses_exact_grouped_allocations() {
    let fixture = Fixture::new("imageGroup");
    let mut store = fixture.store();
    let request = fixture.save_request();
    store.conn.execute_batch("CREATE TRIGGER fail_group_save BEFORE INSERT ON save_receipts BEGIN SELECT RAISE(ABORT,'fixture failure'); END;").unwrap();
    assert!(store.save(request.clone()).is_err());
    let encoded: String = store.conn.query_row("SELECT image_json FROM instance_publications WHERE session_id=?1", [&request.operation_id], |r| r.get(0)).unwrap();
    let image: MaterialImage = serde_json::from_str(&encoded).unwrap();
    let path = store.instance_path(image.storage_id.as_deref().unwrap(), &image.mime_type).unwrap();
    assert!(path.exists());
    assert_eq!(store.conn.query_row::<u32,_,_>("SELECT count(*) FROM materials",[],|r|r.get(0)).unwrap(),0);
    store.conn.execute_batch("DROP TRIGGER fail_group_save").unwrap();
    drop(store);
    let mut store = fixture.store();
    assert!(!path.exists());
    let saved = store.save(request).unwrap();
    assert_eq!(saved.images[0], image);
    assert_eq!(store.image_path(&image).unwrap(), path);
    assert_eq!(fs::read(&path).unwrap(), fixture.bytes);
}

#[test]
fn group_originals_new_unsaved_material_requires_save_and_keeps_staging_private() {
    let fixture = Fixture::new("imageGroup");
    let mut store = fixture.store();
    let request = fixture.save_request();
    let mut payload = request.snapshot.payload;
    payload.component["images"] = json!([]);
    let session = store.begin_create(payload.clone()).unwrap();
    assert!(store.edit_original_group_path(&session.session_id).is_err());
    let saved = store.commit_edit(MaterialContentUpdate {
        operation_id: Uuid::new_v4().to_string(), session_id: session.session_id.clone(), payload,
        metadata_update: Some(MaterialMetadataUpdate { expected_version: 0, metadata: request.metadata }),
    }).unwrap();
    let directory = store.original_group_path(&saved.summary.id,1).unwrap();
    assert!(directory.is_dir());
    assert_eq!(fs::read_dir(directory).unwrap().count(),0);
    store.discard_edit(&session.session_id).unwrap();
}

#[test]
fn group_originals_save_and_edit_keep_all_instances_in_one_stable_directory() {
    let fixture = Fixture::new("imageGroup");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let directory = store.original_group_path(&material.summary.id, 1).unwrap();
    assert_eq!(
        store.image_path(&material.images[0]).unwrap().parent(),
        Some(directory.as_path())
    );
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    assert_eq!(
        store.edit_original_group_path(&session.session_id).unwrap(),
        directory
    );
    let imported = store
        .import_edit_images(
            &session.session_id,
            vec![fixture
                .project
                .join("references/0001.png")
                .to_string_lossy()
                .into_owned()],
        )
        .unwrap()
        .remove(0);
    let mut payload = material.payload.clone();
    let mut image = payload.component["images"][0].clone();
    image["localImageId"] = json!(imported.local_image_id);
    payload.component["images"]
        .as_array_mut()
        .unwrap()
        .push(image);
    let input = MaterialContentUpdate {
        operation_id: Uuid::new_v4().to_string(),
        session_id: session.session_id.clone(),
        payload,
        metadata_update: None,
    };
    let saved = store.commit_edit(input.clone()).unwrap();
    assert_eq!(store.commit_edit(input).unwrap(), saved);
    assert_eq!(
        store.original_group_path(&material.summary.id, 2).unwrap(),
        directory
    );
    assert_ne!(saved.images[0].storage_id, saved.images[1].storage_id);
    for image in &saved.images {
        assert_eq!(
            store.image_path(image).unwrap().parent(),
            Some(directory.as_path())
        );
        assert_eq!(store.blob(image).unwrap(), fixture.bytes);
    }
    store.discard_edit(&session.session_id).unwrap();
    let mut metadata = saved.summary.metadata.clone();
    metadata.name = "改名后的图片组".into();
    store
        .update_metadata(&saved.summary.id, saved.summary.metadata_version, metadata)
        .unwrap();
    assert_eq!(
        store.original_group_path(&saved.summary.id, 2).unwrap(),
        directory
    );
    drop(store);
    let store = fixture.store();
    assert_eq!(
        store.original_group_path(&saved.summary.id, 2).unwrap(),
        directory
    );
    assert_eq!(store.blob(&saved.images[1]).unwrap(), fixture.bytes);
}

#[test]
fn group_originals_old_instances_relocate_without_changing_identity_or_receipts() {
    let fixture = Fixture::new("imageGroup");
    let mut store = fixture.store();
    let request = fixture.save_request();
    let material = store.save(request.clone()).unwrap();
    let image = &material.images[0];
    let grouped = store.image_path(image).unwrap();
    let old = store
        .ungrouped_instance_path(image.storage_id.as_deref().unwrap(), &image.mime_type)
        .unwrap();
    files::publish_new(&grouped, &old).unwrap();
    store.conn.execute_batch("DROP TABLE group_instance_locations; DROP TABLE group_legacy_files; PRAGMA user_version=8;").unwrap();
    drop(store);
    let mut store = fixture.store();
    assert_eq!(store.image_path(image).unwrap(), old);
    let directory = store.original_group_path(&material.summary.id, 1).unwrap();
    assert_eq!(grouped.parent(), Some(directory.as_path()));
    assert!(!old.exists());
    assert_eq!(fs::read(&grouped).unwrap(), fixture.bytes);
    assert_eq!(store.get(&material.summary.id).unwrap(), material);
    assert_eq!(store.save(request).unwrap(), material);
    fs::remove_file(&grouped).unwrap();
    fs::write(&old, &fixture.bytes).unwrap();
    assert!(
        store.original_group_path(&material.summary.id, 1).is_err(),
        "A completed mapping must not fall back to the previous path"
    );
}

#[test]
fn group_originals_recover_interrupted_relocation_on_both_sides_of_the_file_move() {
    for moved in [false, true] {
        let fixture = Fixture::new("imageGroup");
        let mut store = fixture.store();
        let material = store.save(fixture.save_request()).unwrap();
        let image = &material.images[0];
        let grouped = store.image_path(image).unwrap();
        let old = store
            .ungrouped_instance_path(image.storage_id.as_deref().unwrap(), &image.mime_type)
            .unwrap();
        if !moved {
            files::publish_new(&grouped, &old).unwrap();
        }
        store
            .conn
            .execute("UPDATE group_instance_locations SET relocating=1", [])
            .unwrap();
        drop(store);
        let store = fixture.store();
        assert!(!old.exists());
        assert!(grouped.exists());
        assert_eq!(store.blob(image).unwrap(), fixture.bytes);
        assert_eq!(store.get(&material.summary.id).unwrap(), material);
    }
}

#[test]
fn group_originals_refuses_unowned_destination_and_keeps_the_source() {
    let fixture = Fixture::new("imageGroup");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let image = &material.images[0];
    let destination = store.image_path(image).unwrap();
    let source = store.ungrouped_instance_path(image.storage_id.as_deref().unwrap(), &image.mime_type).unwrap();
    files::publish_new(&destination, &source).unwrap();
    store.conn.execute("DELETE FROM group_instance_locations", []).unwrap();
    fs::write(&destination,b"unowned file").unwrap();
    assert!(store.original_group_path(&material.summary.id,1).is_err());
    assert_eq!(fs::read(&destination).unwrap(),b"unowned file");
    assert_eq!(fs::read(&source).unwrap(),fixture.bytes);
}

#[test]
fn group_originals_legacy_shared_hashes_get_owned_copies_and_purge_only_the_selected_material() {
    let fixture = Fixture::new("imageGroup");
    let mut store = fixture.store();
    let first = store.save_legacy_fixture(fixture.save_request()).unwrap();
    let second = store.save_legacy_fixture(fixture.save_request()).unwrap();
    let first_dir = store.original_group_path(&first.summary.id, 1).unwrap();
    let second_dir = store.original_group_path(&second.summary.id, 1).unwrap();
    let first_file = fs::read_dir(&first_dir)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let second_file = fs::read_dir(&second_dir)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    assert_ne!(first_file, second_file);
    assert_eq!(fs::read(&first_file).unwrap(), fixture.bytes);
    assert_eq!(store.get(&first.summary.id).unwrap(), first);
    let trash = store.set_deleted(&first.summary.id, 1, true).unwrap();
    store
        .purge(&first.summary.id, trash.metadata_version)
        .unwrap();
    assert!(!first_file.exists());
    assert!(second_file.exists());
    assert_eq!(store.blob(&second.images[0]).unwrap(), fixture.bytes);
    assert_eq!(
        fs::read(fixture.project.join("references/0001.png")).unwrap(),
        fixture.bytes
    );
}

#[test]
fn group_originals_permanent_delete_retains_replaced_files_and_resumes_exact_cleanup() {
    let fixture = Fixture::new("imageGroup");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let path = store.image_path(&material.images[0]).unwrap();
    fs::write(&path, b"user replacement").unwrap();
    let trash = store.set_deleted(&material.summary.id, 1, true).unwrap();
    assert!(store
        .purge(&material.summary.id, trash.metadata_version)
        .is_err());
    assert_eq!(fs::read(&path).unwrap(), b"user replacement");
    fs::write(&path, &fixture.bytes).unwrap();
    drop(store);
    let store = fixture.store();
    assert!(!path.exists());
    assert!(store.get(&material.summary.id).is_err());
    assert_eq!(
        store
            .conn
            .query_row::<u32, _, _>("SELECT count(*) FROM group_instance_locations", [], |r| r
                .get(0))
            .unwrap(),
        0
    );
}

#[test]
fn library_originals_resolve_exact_instances_and_never_fall_back_to_equal_pixels() {
    let fixture = Fixture::new("imageGroup");
    let mut store = fixture.store();
    let first = store.save(fixture.save_request()).unwrap();
    let second = store.save(fixture.save_request()).unwrap();
    let legacy = store.save_legacy_fixture(fixture.save_request()).unwrap();
    let image = &first.images[0];
    let resolve = |material: &MaterialDetail| {
        store.original_image_path(
            &material.summary.id,
            material.summary.revision,
            &material.images[0].local_image_id,
        )
    };
    let first_path = resolve(&first).unwrap();
    let second_path = resolve(&second).unwrap();
    let legacy_path = resolve(&legacy).unwrap();
    assert_ne!(first_path, second_path);
    assert_ne!(first_path, legacy_path);
    assert_eq!(fs::read(&first_path).unwrap(), fixture.bytes);
    assert_eq!(
        legacy_path,
        store.object_path(&image.blob_id, &image.mime_type).unwrap()
    );
    assert!(store
        .original_image_path(&first.summary.id, 2, &image.local_image_id)
        .is_err());
    assert!(store
        .original_image_path(&first.summary.id, 1, "../outside")
        .is_err());
    // Resolution does not decode the original; damaged bytes can still be located.
    fs::write(&first_path, b"damaged").unwrap();
    assert_eq!(resolve(&first).unwrap(), first_path);
    fs::remove_file(&first_path).unwrap();
    assert!(resolve(&first).is_err());
    assert!(second_path.is_file());
    assert!(legacy_path.is_file());
}

#[test]
fn library_originals_edit_resolution_is_session_scoped_and_supports_unsaved_imports() {
    let fixture = Fixture::new("imageGroup");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let other = store.begin_edit(&material.summary.id, 1).unwrap();
    let original = &material.images[0];
    assert_eq!(
        store
            .edit_original_image_path(&session.session_id, &original.local_image_id)
            .unwrap(),
        store
            .original_image_path(&material.summary.id, 1, &original.local_image_id)
            .unwrap(),
    );
    let imported = store
        .import_edit_images(
            &session.session_id,
            vec![fixture
                .project
                .join("references/0001.png")
                .to_string_lossy()
                .into_owned()],
        )
        .unwrap()
        .remove(0);
    let staged = store
        .edit_original_image_path(&session.session_id, &imported.local_image_id)
        .unwrap();
    assert_eq!(fs::read(&staged).unwrap(), fixture.bytes);
    assert!(store
        .edit_original_image_path(&other.session_id, &imported.local_image_id)
        .is_err());
    assert!(store
        .original_image_path(&material.summary.id, 1, &imported.local_image_id)
        .is_err());
    store.discard_edit(&session.session_id).unwrap();
    assert!(store
        .edit_original_image_path(&session.session_id, &original.local_image_id)
        .is_err());
    assert!(store
        .edit_original_image_path(&session.session_id, &imported.local_image_id)
        .is_err());
    assert!(!staged.exists());
    assert!(store
        .original_image_path(&material.summary.id, 1, &original.local_image_id)
        .unwrap()
        .exists());
}
