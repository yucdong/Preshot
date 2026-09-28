use super::*;

#[path = "tests_edit_combined.rs"]
mod combined;
#[path = "tests_create.rs"]
mod creation;
#[path = "tests_instances.rs"]
mod instances;

fn update(session: &MaterialEditSession) -> MaterialContentUpdate {
    MaterialContentUpdate {
        operation_id: Uuid::new_v4().to_string(),
        session_id: session.session_id.clone(),
        payload: session.material.payload.clone(),
        metadata_update: None,
    }
}

fn images_mut(payload: &mut MaterialPayload) -> &mut Vec<Value> {
    let component = &mut payload.component;
    let images = match payload.kind {
        MaterialKind::Image | MaterialKind::ImageGroup => &mut component["images"],
        MaterialKind::ModelCard => &mut component["samples"]["images"],
        MaterialKind::Clothing => &mut component["mainGallery"]["images"],
        _ => &mut component["gallery"]["images"],
    };
    images.as_array_mut().unwrap()
}

fn query(value: &str) -> MaterialSearch {
    serde_json::from_value(json!({"query":value,"sort":"relevance","offset":0,"limit":20})).unwrap()
}

fn draft_path(store: &Store, session: &MaterialEditSession) -> PathBuf {
    store.root.join("drafts").join(&session.session_id)
}

#[test]
fn library_edit_all_kinds_cas_search_metadata_and_preview_invalidation() {
    for kind in [
        "imageGroup",
        "shootingLocation",
        "modelCard",
        "prop",
        "clothing",
    ] {
        let fixture = Fixture::new(kind);
        let mut store = fixture.store();
        let material = store.save(fixture.save_request()).unwrap();
        let session = store.begin_edit(&material.summary.id, 1).unwrap();
        let mut request = update(&session);
        images_mut(&mut request.payload)[0]["caption"] = json!("北极星 Aurora");
        let mut metadata = material.summary.metadata.clone();
        metadata.name = "最新名字".into();
        metadata.tags = vec!["最新标签".into()];
        metadata.favorite = true;
        let latest = store
            .update_metadata(&material.summary.id, 1, metadata)
            .unwrap();
        store
            .save_preview(
                &material.summary.id,
                1,
                MaterialPreviewInput {
                    bytes: fixture.bytes.clone(),
                    width: 3,
                    height: 2,
                    render_key: "old-key".into(),
                    is_partial: true,
                },
            )
            .unwrap();

        let edited = store.commit_edit(request).unwrap();
        assert_eq!(edited.summary.id, material.summary.id);
        assert_eq!(edited.summary.kind, material.summary.kind);
        assert_eq!(edited.summary.revision, 2);
        assert_eq!(edited.summary.metadata_version, 2);
        assert_eq!(edited.summary.metadata, latest.metadata);
        assert_eq!(edited.images, material.images);
        assert_eq!(edited.summary.preview_state, PreviewState::Pending);
        assert_eq!(edited.summary.preview_partial, None);
        let cache: (Option<String>, Option<String>) = store
            .conn
            .query_row(
                "SELECT preview_hash,preview_render_key FROM materials WHERE id=?1",
                [&material.summary.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(cache, (None, None));
        assert_eq!(store.load_preview(&material.summary.id, 2).unwrap(), None);
        assert!(store.mark_preview_failed(&material.summary.id, 1).is_err());
        for text in ["北", "北极星", "aurora", "最新标签"] {
            assert_eq!(store.search(query(text)).unwrap().total, 1, "{text}");
        }
        assert_eq!(store.search(query("逆光")).unwrap().total, 0);
        assert_eq!(store.get(&material.summary.id).unwrap(), edited);
        assert!(draft_path(&store, &session).exists());
    }
}

#[test]
fn library_edit_receipt_survives_discard_reopen_later_edits_and_lost_response() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let mut request = update(&session);
    request.payload.component["source"] = json!("第一次保存");
    let committed = store.commit_edit(request.clone()).unwrap();
    assert_eq!(store.commit_edit(request.clone()).unwrap(), committed);
    let mut other = request.clone();
    other.payload.component["source"] = json!("不同意图");
    assert_eq!(
        store.commit_edit(other).unwrap_err().code,
        "library_operation_conflict"
    );
    store.discard_edit(&session.session_id).unwrap();
    store.discard_edit(&session.session_id).unwrap();
    assert!(!draft_path(&store, &session).exists());
    let next = store.begin_edit(&material.summary.id, 2).unwrap();
    let mut next_request = update(&next);
    next_request.payload.component["source"] = json!("第二次保存");
    store.commit_edit(next_request).unwrap();
    drop(store);
    let mut store = fixture.store();
    assert_eq!(store.commit_edit(request).unwrap(), committed);
    assert_eq!(store.get(&material.summary.id).unwrap().summary.revision, 3);
}

#[test]
fn library_edit_rejects_stale_deleted_wrong_kind_and_undeclared_or_duplicate_images() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    assert_eq!(
        store.begin_edit(&material.summary.id, 2).unwrap_err().code,
        "library_revision"
    );
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let other = store.begin_edit(&material.summary.id, 1).unwrap();
    let mut request = update(&session);
    images_mut(&mut request.payload)[0]["localImageId"] = json!("undeclared");
    assert_eq!(
        store.commit_edit(request).unwrap_err().code,
        "library_image_not_found"
    );
    let mut request = update(&session);
    let duplicate = images_mut(&mut request.payload)[0].clone();
    images_mut(&mut request.payload).push(duplicate);
    assert!(store.commit_edit(request).is_err());
    let mut request = update(&session);
    request.payload.kind = MaterialKind::Clothing;
    request.payload.component =
        json!({"kind":"clothing","title":"外套","source":"","mainGallery":{"images":[]}});
    assert_eq!(store.commit_edit(request).unwrap_err().code, "library_kind");
    store.set_deleted(&material.summary.id, 1, true).unwrap();
    assert_eq!(
        store.commit_edit(update(&session)).unwrap_err().code,
        "library_deleted"
    );
    assert_eq!(
        store.begin_edit(&material.summary.id, 1).unwrap_err().code,
        "library_deleted"
    );
    store.set_deleted(&material.summary.id, 2, false).unwrap();
    store.commit_edit(update(&session)).unwrap();
    assert_eq!(
        store.commit_edit(update(&other)).unwrap_err().code,
        "library_revision"
    );
    assert_eq!(store.get(&material.summary.id).unwrap().summary.revision, 2);
}

#[test]
fn library_edit_import_copies_originals_cancel_and_crop_keep_undo_sources() {
    for format in [ImageFormat::Png, ImageFormat::Jpeg] {
        let fixture = Fixture::new("imageGroup");
        let mut store = fixture.store();
        let material = store.save(fixture.save_request()).unwrap();
        let session = store.begin_edit(&material.summary.id, 1).unwrap();
        let extension = if format == ImageFormat::Png {
            "png"
        } else {
            "jpg"
        };
        let source = fixture.project.join(format!("external.{extension}"));
        let mut encoded = Cursor::new(Vec::new());
        DynamicImage::new_rgb8(4, 3)
            .write_to(&mut encoded, format)
            .unwrap();
        let bytes = encoded.into_inner();
        fs::write(&source, &bytes).unwrap();
        let staged = store
            .import_edit_images(&session.session_id, vec![source.to_str().unwrap().into()])
            .unwrap()
            .remove(0);
        assert_eq!(
            STANDARD
                .decode(staged.data_url.split(',').nth(1).unwrap())
                .unwrap(),
            bytes
        );
        let cropped = store
            .crop_edit_image(
                &session.session_id,
                &staged.local_image_id,
                MaterialEditCropBounds {
                    x: 1,
                    y: 0,
                    width: 2,
                    height: 3,
                },
            )
            .unwrap();
        assert_ne!(cropped.local_image_id, staged.local_image_id);
        assert_ne!(cropped.data_url, staged.data_url);
        assert_eq!((cropped.width, cropped.height), (2, 3));
        assert_eq!(
            store
                .load_edit_image(&session.session_id, &staged.local_image_id)
                .unwrap(),
            staged.data_url
        );
        assert_eq!(fs::read(&source).unwrap(), bytes);
        fs::remove_file(&source).unwrap();
        assert_eq!(
            store
                .load_edit_image(&session.session_id, &staged.local_image_id)
                .unwrap(),
            staged.data_url
        );
        store.discard_edit(&session.session_id).unwrap();
        assert!(!draft_path(&store, &session).exists());
        assert_eq!(store.get(&material.summary.id).unwrap(), material);
        assert_eq!(store.blob(&material.images[0]).unwrap(), fixture.bytes);
    }
}

#[test]
fn library_edit_snapshot_images_survive_replacement_and_new_revision_insertion() {
    let mut fixture = Fixture::new("imageGroup");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let old_request = fixture.insert_request(&material);
    let old_insert = store.prepare_insert(old_request.clone()).unwrap();
    let old_path = fixture.project.join(&old_insert.images[0].file);
    let old_plan = fixture.next_plan(&old_insert);
    insert::commit(fixture.commit_request(&old_insert, &old_plan)).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let original = &material.images[0].local_image_id;
    let crop = store
        .crop_edit_image(
            &session.session_id,
            original,
            MaterialEditCropBounds {
                x: 0,
                y: 0,
                width: 1,
                height: 2,
            },
        )
        .unwrap();
    let mut request = update(&session);
    images_mut(&mut request.payload)[0]["localImageId"] = json!(crop.local_image_id);
    let edited = store.commit_edit(request).unwrap();
    assert_eq!(store.prepare_insert(old_request).unwrap(), old_insert);
    assert_eq!(
        store
            .load_edit_image(&session.session_id, original)
            .unwrap(),
        format!("data:image/png;base64,{}", STANDARD.encode(&fixture.bytes))
    );
    assert_eq!(fs::read(&old_path).unwrap(), fixture.bytes);
    let mut insertion = fixture.insert_request(&edited);
    insertion.expected_plan = old_plan.clone();
    insertion.revision = 2;
    let new_insert = store.prepare_insert(insertion).unwrap();
    assert_eq!(new_insert.revision, 2);
    let bytes = fs::read(fixture.project.join(&new_insert.images[0].file)).unwrap();
    assert_eq!(
        bytes,
        STANDARD
            .decode(crop.data_url.split(',').nth(1).unwrap())
            .unwrap()
    );
    assert_ne!(old_insert.images[0].file, new_insert.images[0].file);
    assert_eq!(fs::read(&old_path).unwrap(), fixture.bytes);
    assert_eq!(
        crate::workspace::read_manifest(&fixture.project)
            .unwrap()
            .plan,
        Some(old_plan)
    );
    assert_eq!(
        store
            .prepare_insert(fixture.insert_request(&material))
            .unwrap_err()
            .code,
        "library_stale_plan"
    );
    fixture.plan = crate::workspace::read_manifest(&fixture.project)
        .unwrap()
        .plan
        .unwrap();
    let new_plan = fixture.next_plan(&new_insert);
    insert::commit(fixture.commit_request(&new_insert, &new_plan)).unwrap();
    assert_eq!(
        crate::workspace::read_manifest(&fixture.project)
            .unwrap()
            .plan,
        Some(new_plan)
    );
    assert_eq!(fs::read(&old_path).unwrap(), fixture.bytes);
    store.discard_edit(&session.session_id).unwrap();
    assert_eq!(store.blob(&edited.images[0]).unwrap(), bytes);
}

#[test]
fn library_edit_import_commit_survives_source_deletion_and_draft_discard() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let source = fixture.project.join("new-original.png");
    let mut encoded = Cursor::new(Vec::new());
    DynamicImage::new_rgb8(7, 5)
        .write_to(&mut encoded, ImageFormat::Png)
        .unwrap();
    let original = encoded.into_inner();
    fs::write(&source, &original).unwrap();
    let staged = store
        .import_edit_images(&session.session_id, vec![source.to_str().unwrap().into()])
        .unwrap()
        .remove(0);
    fs::remove_file(&source).unwrap();
    let mut request = update(&session);
    images_mut(&mut request.payload)[0]["localImageId"] = json!(staged.local_image_id);
    let edited = store.commit_edit(request.clone()).unwrap();
    assert_eq!(edited.images[0].byte_length, original.len() as u64);
    assert_eq!((edited.images[0].width, edited.images[0].height), (7, 5));
    assert_eq!(edited.summary.byte_length, original.len() as u64);
    store.discard_edit(&session.session_id).unwrap();
    assert_eq!(store.blob(&edited.images[0]).unwrap(), original);
    assert_eq!(store.blob(&material.images[0]).unwrap(), fixture.bytes);
    assert_eq!(store.commit_edit(request).unwrap(), edited);
}

#[test]
fn library_edit_concurrent_sessions_have_exactly_one_cas_winner() {
    use std::sync::{Arc, Barrier};
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let first = store.begin_edit(&material.summary.id, 1).unwrap();
    let second = store.begin_edit(&material.summary.id, 1).unwrap();
    drop(store);
    let barrier = Arc::new(Barrier::new(2));
    let threads: Vec<_> = [first, second]
        .into_iter()
        .map(|session| {
            let home = fixture.home.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                Store::open(&home).unwrap().commit_edit(update(&session))
            })
        })
        .collect();
    let results: Vec<_> = threads
        .into_iter()
        .map(|thread| thread.join().unwrap())
        .collect();
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|r| r.as_ref().is_err_and(|e| e.code == "library_revision"))
            .count(),
        1
    );
    assert_eq!(
        fixture
            .store()
            .get(&material.summary.id)
            .unwrap()
            .summary
            .revision,
        2
    );
}

#[test]
fn library_edit_import_batch_failure_geometry_limits_and_confinement() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let source = fixture.project.join("references").join("0001.png");
    let bad = fixture.project.join("bad.png");
    fs::write(&bad, b"bad image").unwrap();
    assert!(store
        .import_edit_images(
            &session.session_id,
            vec![
                source.to_str().unwrap().into(),
                bad.to_str().unwrap().into()
            ]
        )
        .is_err());
    assert_eq!(
        fs::read_dir(draft_path(&store, &session)).unwrap().count(),
        1
    );
    assert!(store
        .load_edit_image(&session.session_id, "..\\references\\0001.png")
        .is_err());
    assert!(store.discard_edit("..\\objects").is_err());
    for bounds in [
        MaterialEditCropBounds {
            x: -1,
            y: 0,
            width: 1,
            height: 1,
        },
        MaterialEditCropBounds {
            x: 0,
            y: 0,
            width: 0,
            height: 1,
        },
        MaterialEditCropBounds {
            x: 3,
            y: 0,
            width: 1,
            height: 1,
        },
        MaterialEditCropBounds {
            x: i64::MAX,
            y: 0,
            width: 1,
            height: 1,
        },
    ] {
        assert!(store
            .crop_edit_image(
                &session.session_id,
                &material.images[0].local_image_id,
                bounds
            )
            .is_err());
    }
    let mut request = update(&session);
    let image = images_mut(&mut request.payload)[0].clone();
    *images_mut(&mut request.payload) = (0..129)
        .map(|n| {
            let mut image = image.clone();
            image["localImageId"] = json!(format!("image-{n}"));
            image
        })
        .collect();
    assert!(store.commit_edit(request).is_err());
    let oversized = fs::File::create(&bad).unwrap();
    oversized
        .set_len(files::MAX_IMAGE_BYTES as u64 + 1)
        .unwrap();
    drop(oversized);
    assert!(store
        .import_edit_images(&session.session_id, vec![bad.to_str().unwrap().into()])
        .is_err());
    assert_eq!(store.get(&material.summary.id).unwrap(), material);
}

#[test]
fn library_edit_sql_failure_rolls_back_receipt_mappings_preview_and_search() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let mut request = update(&session);
    request.payload.component["source"] = json!("唯一新内容");
    images_mut(&mut request.payload).clear();
    store.conn.execute_batch(
        "CREATE TRIGGER fail_edit BEFORE INSERT ON edit_receipts BEGIN SELECT RAISE(ABORT,'failure'); END;"
    ).unwrap();
    assert!(store.commit_edit(request.clone()).is_err());
    assert_eq!(store.get(&material.summary.id).unwrap(), material);
    assert_eq!(store.search(query("唯一")).unwrap().total, 0);
    store.conn.execute_batch("DROP TRIGGER fail_edit;").unwrap();
    let result = store.commit_edit(request).unwrap();
    assert_eq!(result.summary.revision, 2);
    assert!(result.images.is_empty());
    assert_eq!(result.summary.byte_length, 0);
}

#[test]
fn library_edit_discard_rejects_replaced_owned_file_without_touching_other_files() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let source = fixture.project.join("references").join("0001.png");
    let staged = store
        .import_edit_images(&session.session_id, vec![source.to_str().unwrap().into()])
        .unwrap()
        .remove(0);
    let path = draft_path(&store, &session).join(format!("{}.png", staged.local_image_id));
    fs::write(&path, b"user replacement").unwrap();
    assert!(store.discard_edit(&session.session_id).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"user replacement");
    assert_eq!(store.get(&material.summary.id).unwrap(), material);
    fs::write(&path, &fixture.bytes).unwrap();
    store.discard_edit(&session.session_id).unwrap();
}

#[test]
fn library_edit_interrupted_batch_is_invisible_and_recovers_only_recorded_ownership() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let source = fixture.project.join("references").join("0001.png");
    let staged = store
        .import_edit_images(&session.session_id, vec![source.to_str().unwrap().into()])
        .unwrap()
        .remove(0);
    let manifest_path = draft_path(&store, &session).join("manifest.json");
    let mut manifest: Value = serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    manifest["pending"] = manifest["staged"].take();
    manifest["staged"] = json!([]);
    fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    let mut request = update(&session);
    images_mut(&mut request.payload)[0]["localImageId"] = json!(staged.local_image_id);
    drop(store);
    let mut store = fixture.store();
    assert_eq!(
        store
            .load_edit_image(&session.session_id, &staged.local_image_id)
            .unwrap_err()
            .code,
        "library_image_not_found"
    );
    assert_eq!(
        store.commit_edit(request).unwrap_err().code,
        "library_image_not_found"
    );
    let fresh = store
        .import_edit_images(&session.session_id, vec![source.to_str().unwrap().into()])
        .unwrap()
        .remove(0);
    assert_ne!(fresh.local_image_id, staged.local_image_id);
    assert!(!draft_path(&store, &session)
        .join(format!("{}.png", staged.local_image_id))
        .exists());
    let foreign = draft_path(&store, &session).join("unrelated.png");
    fs::write(&foreign, b"unrelated").unwrap();
    assert!(store
        .import_edit_images(&session.session_id, vec![source.to_str().unwrap().into()])
        .is_err());
    assert!(store.discard_edit(&session.session_id).is_err());
    assert_eq!(fs::read(&foreign).unwrap(), b"unrelated");
    assert!(store
        .load_edit_image(&session.session_id, &fresh.local_image_id)
        .is_ok());
    fs::remove_file(&foreign).unwrap();
    // A prior interrupted discard may already have removed a verified stage.
    fs::remove_file(draft_path(&store, &session).join(format!("{}.png", fresh.local_image_id)))
        .unwrap();
    store.discard_edit(&session.session_id).unwrap();
    store.discard_edit(&session.session_id).unwrap();
}

#[test]
fn library_edit_rejects_oversized_dimensions_mismatched_format_and_foreign_session_ids() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let other = store.begin_edit(&material.summary.id, 1).unwrap();
    let source = fixture.project.join("references").join("0001.png");
    let staged = store
        .import_edit_images(&other.session_id, vec![source.to_str().unwrap().into()])
        .unwrap()
        .remove(0);
    assert!(store
        .load_edit_image(&session.session_id, &staged.local_image_id)
        .is_err());
    let mut request = update(&session);
    images_mut(&mut request.payload)[0]["localImageId"] = json!(staged.local_image_id);
    assert_eq!(
        store.commit_edit(request).unwrap_err().code,
        "library_image_not_found"
    );
    let bad = fixture.project.join("wide.png");
    let mut encoded = Cursor::new(Vec::new());
    DynamicImage::new_rgb8(8193, 1)
        .write_to(&mut encoded, ImageFormat::Png)
        .unwrap();
    fs::write(&bad, encoded.into_inner()).unwrap();
    assert_eq!(
        store
            .import_edit_images(&session.session_id, vec![bad.to_str().unwrap().into()])
            .unwrap_err()
            .code,
        "library_image_dimensions"
    );
    let wrong = fixture.project.join("wrong.jpg");
    fs::write(&wrong, &fixture.bytes).unwrap();
    assert_eq!(
        store
            .import_edit_images(&session.session_id, vec![wrong.to_str().unwrap().into()])
            .unwrap_err()
            .code,
        "library_image_format"
    );
    assert!(store
        .import_edit_images(&session.session_id, vec![])
        .is_err());
    assert!(store
        .import_edit_images(
            &session.session_id,
            vec![source.to_str().unwrap().into(); 129]
        )
        .is_err());
    for field in ["frameWidth", "frameHeight", "aspectRatio"] {
        let mut request = update(&session);
        images_mut(&mut request.payload)[0][field] = json!(0);
        assert!(store.commit_edit(request).is_err());
    }
    let mut request = update(&session);
    images_mut(&mut request.payload)[0]["crop"] = json!({"x":0.9,"y":0,"width":0.2,"height":1});
    assert!(store.commit_edit(request).is_err());
}

#[test]
fn library_edit_migration_failure_restores_v1_trigger_schema_and_version() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    store
        .conn
        .execute_batch(
            "DROP TRIGGER revisioned_content;
         DROP TABLE edit_receipts;
         CREATE TRIGGER immutable_content BEFORE UPDATE OF detail_json ON materials
         BEGIN SELECT RAISE(ABORT,'old-v1-immutable-rule'); END;
         PRAGMA user_version=1;",
        )
        .unwrap();
    let broken = include_str!("schema.sql").replace(
        "PRAGMA user_version = 4;",
        "SELECT * FROM missing_edit_migration_fixture; PRAGMA user_version = 4;",
    );
    assert!(store.conn.execute_batch(&broken).is_err());
    store.conn.execute_batch("ROLLBACK;").unwrap();
    assert_eq!(
        store
            .conn
            .pragma_query_value::<u32, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        1
    );
    assert!(store
        .conn
        .execute("UPDATE materials SET detail_json=detail_json", [])
        .is_err());
    let tables: u32 = store.conn.query_row(
        "SELECT count(*) FROM sqlite_master WHERE name IN ('edit_receipts','revisioned_content')", [], |r| r.get(0)
    ).unwrap();
    assert_eq!(tables, 0);
    assert_eq!(store.get(&material.summary.id).unwrap(), material);
    drop(store);
    let mut store = fixture.store();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    assert_eq!(
        store
            .commit_edit(update(&session))
            .unwrap()
            .summary
            .revision,
        2
    );
}

#[test]
fn library_edit_schema_rejects_revision_skips_identity_and_unversioned_metadata_changes() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    store.save(fixture.save_request()).unwrap();
    for changes in [
        "'$.revision',0",
        "'$.revision',3",
        "'$.revision',1.5",
        "'$.revision',NULL",
        "'$.id','forged'",
        "'$.kind','clothing'",
        "'$.payload.kind','clothing'",
        "'$.payload.component.source','changed-without-revision'",
        "'$.revision',2,'$.metadataVersion',3",
        "'$.revision',2,'$.name','changed-metadata'",
    ] {
        assert!(
            store
                .conn
                .execute(
                    &format!("UPDATE materials SET detail_json=json_set(detail_json,{changes})"),
                    []
                )
                .is_err(),
            "{changes}"
        );
    }
}

#[test]
fn library_edit_corrupt_snapshot_sizes_fail_without_overflow() {
    let fixture = Fixture::new("imageGroup");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let path = draft_path(&store, &session).join("manifest.json");
    let mut manifest: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    let mut second = manifest["material"]["images"][0].clone();
    second["localImageId"] = json!("second");
    manifest["material"]["images"]
        .as_array_mut()
        .unwrap()
        .push(second);
    let mut portable = manifest["material"]["payload"]["component"]["images"][0].clone();
    portable["localImageId"] = json!("second");
    manifest["material"]["payload"]["component"]["images"]
        .as_array_mut()
        .unwrap()
        .push(portable);
    manifest["material"]["imageCount"] = json!(2);
    manifest["material"]["images"][0]["byteLength"] = json!(u64::MAX);
    fs::write(&path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    assert!(store
        .load_edit_image(&session.session_id, &material.images[0].local_image_id)
        .is_err());
}

#[cfg(windows)]
#[test]
fn library_edit_reparse_points_never_load_copy_or_delete_outside_files() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let path = draft_path(&store, &session);
    let moved = store.root.join("retained-draft");
    fs::rename(&path, &moved).unwrap();
    let output = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&path)
        .arg(&moved)
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(store
        .load_edit_image(&session.session_id, &material.images[0].local_image_id)
        .is_err());
    assert!(store.discard_edit(&session.session_id).is_err());
    assert!(moved.join("manifest.json").exists());
    fs::remove_dir(&path).unwrap();
    fs::rename(&moved, &path).unwrap();
    let external = fixture.project.join("linked");
    let references = fixture.project.join("references").canonicalize().unwrap();
    let output = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&external)
        .arg(&references)
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(store
        .import_edit_images(
            &session.session_id,
            vec![external.join("0001.png").to_str().unwrap().into()]
        )
        .is_err());
    assert_eq!(
        fs::read(references.join("0001.png")).unwrap(),
        fixture.bytes
    );
    fs::remove_dir(external).unwrap();
    store.discard_edit(&session.session_id).unwrap();
}
