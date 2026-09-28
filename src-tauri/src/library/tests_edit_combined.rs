use super::*;

fn combined(
    session: &MaterialEditSession,
    expected_version: u32,
    metadata: MaterialMetadata,
) -> MaterialContentUpdate {
    let mut value = serde_json::to_value(update(session)).unwrap();
    value["metadataUpdate"] = json!({
        "expectedVersion":expected_version,
        "metadata":metadata,
    });
    serde_json::from_value(value).unwrap()
}

fn preview(store: &mut Store, fixture: &Fixture, material: &MaterialDetail) {
    store
        .save_preview(
            &material.summary.id,
            material.summary.revision,
            MaterialPreviewInput {
                bytes: fixture.bytes.clone(),
                width: 3,
                height: 2,
                render_key: "combined-edit-preview".into(),
                is_partial: false,
            },
        )
        .unwrap();
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
fn library_combined_edit_atomically_updates_normalized_metadata_payload_search_and_preview() {
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
        preview(&mut store, &fixture, &material);
        let session = store.begin_edit(&material.summary.id, 1).unwrap();
        let metadata = MaterialMetadata {
            name: "  新素材 Cafe\u{301}  ".into(),
            description: "新的冬季说明".into(),
            tags: vec![" 北极星 ".into(), "Ａ".into(), "a".into()],
            favorite: true,
        };
        let mut request = combined(&session, 1, metadata.clone());
        images_mut(&mut request.payload)[0]["caption"] = json!("银河新构图");
        let edited = store.commit_edit(request).unwrap();
        assert_eq!(edited.summary.id, material.summary.id);
        assert_eq!(edited.summary.kind, material.summary.kind);
        assert_eq!(edited.summary.created_at, material.summary.created_at);
        assert_eq!(edited.summary.revision, 2);
        assert_eq!(edited.summary.metadata_version, 2);
        assert_eq!(
            edited.summary.metadata,
            validation::metadata(metadata).unwrap()
        );
        assert_eq!(edited.images, material.images);
        assert_eq!(edited.summary.preview_state, PreviewState::Pending);
        assert_eq!(edited.summary.preview_partial, None);
        assert_eq!(store.load_preview(&material.summary.id, 2).unwrap(), None);
        assert_eq!(store.get(&material.summary.id).unwrap(), edited);
        for text in ["新素材", "Café", "冬季说明", "北极星", "银河新构图"] {
            assert_eq!(
                store.search(query(text)).unwrap().total,
                1,
                "{kind}: {text}"
            );
        }
        for text in ["同名素材", "可复用", "窗边逆光"] {
            assert_eq!(
                store.search(query(text)).unwrap().total,
                0,
                "{kind}: {text}"
            );
        }
        assert_eq!(count(&store, "edit_receipts"), 1);
        assert!(draft_path(&store, &session).exists());
    }
}

#[test]
fn library_combined_edit_metadata_only_and_unchanged_metadata_still_advance_both_versions() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let mut material = store.save(fixture.save_request()).unwrap();
    for changed in [true, false] {
        preview(&mut store, &fixture, &material);
        let session = store
            .begin_edit(&material.summary.id, material.summary.revision)
            .unwrap();
        let mut metadata = material.summary.metadata.clone();
        if changed {
            metadata.name = "只改名称".into();
        }
        let request = combined(
            &session,
            material.summary.metadata_version,
            metadata.clone(),
        );
        let edited = store.commit_edit(request).unwrap();
        assert_eq!(edited.summary.revision, material.summary.revision + 1);
        assert_eq!(
            edited.summary.metadata_version,
            material.summary.metadata_version + 1
        );
        assert_eq!(edited.summary.metadata, metadata);
        assert_eq!(edited.payload, material.payload);
        assert_eq!(edited.images, material.images);
        assert_eq!(edited.summary.preview_state, PreviewState::Pending);
        store.discard_edit(&session.session_id).unwrap();
        material = edited;
    }
}

#[test]
fn library_combined_edit_invalid_metadata_leaves_content_preview_receipts_and_search_unchanged() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    preview(&mut store, &fixture, &material);
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let before = store.get(&material.summary.id).unwrap();
    for (field, invalid, code) in [
        ("name", json!(""), "library_validation"),
        ("name", json!("bad\nname"), "library_metadata"),
        ("description", json!("x".repeat(1001)), "library_validation"),
        ("tags", json!(vec!["tag"; 13]), "library_metadata"),
    ] {
        let mut metadata = serde_json::to_value(&before.summary.metadata).unwrap();
        metadata[field] = invalid;
        let mut request = combined(&session, 1, serde_json::from_value(metadata).unwrap());
        request.payload.component["source"] = json!("不应发布的内容");
        assert_eq!(store.commit_edit(request).unwrap_err().code, code);
        assert_eq!(store.get(&material.summary.id).unwrap(), before);
        assert_eq!(count(&store, "edit_receipts"), 0);
        assert_eq!(store.search(query("不应发布")).unwrap().total, 0);
        assert!(store
            .load_preview(&material.summary.id, 1)
            .unwrap()
            .is_some());
        assert_eq!(store.blob(&material.images[0]).unwrap(), fixture.bytes);
    }
}

#[test]
fn library_combined_edit_rejects_stale_metadata_content_and_deleted_state_without_partial_writes() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let mut request = combined(&session, 1, material.summary.metadata.clone());
    request.payload.component["source"] = json!("旧会话内容");
    let mut metadata = material.summary.metadata.clone();
    metadata.name = "外部新名字".into();
    store
        .update_metadata(&material.summary.id, 1, metadata)
        .unwrap();
    let before = store.get(&material.summary.id).unwrap();
    assert_eq!(
        store.commit_edit(request.clone()).unwrap_err().code,
        "library_metadata_conflict"
    );
    assert_eq!(store.get(&material.summary.id).unwrap(), before);
    assert_eq!(count(&store, "edit_receipts"), 0);
    store.commit_edit(update(&session)).unwrap();
    let before = store.get(&material.summary.id).unwrap();
    assert_eq!(
        store.commit_edit(request).unwrap_err().code,
        "library_revision"
    );
    assert_eq!(store.get(&material.summary.id).unwrap(), before);
    let session = store.begin_edit(&material.summary.id, 2).unwrap();
    let request = combined(&session, 2, before.summary.metadata.clone());
    store.set_deleted(&material.summary.id, 2, true).unwrap();
    let before = store.get(&material.summary.id).unwrap();
    assert_eq!(
        store.commit_edit(request).unwrap_err().code,
        "library_deleted"
    );
    assert_eq!(store.get(&material.summary.id).unwrap(), before);
    assert_eq!(count(&store, "edit_receipts"), 1);
}

#[test]
fn library_combined_edit_exact_receipt_survives_lost_response_discard_and_newer_metadata() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let mut metadata = material.summary.metadata.clone();
    metadata.name = "  完整保存  ".into();
    let request = combined(&session, 1, metadata);
    let committed = store.commit_edit(request.clone()).unwrap();
    assert_eq!(store.commit_edit(request.clone()).unwrap(), committed);
    assert_eq!(count(&store, "edit_receipts"), 1);
    store.discard_edit(&session.session_id).unwrap();
    drop(store);
    let mut store = fixture.store();
    assert_eq!(store.commit_edit(request.clone()).unwrap(), committed);
    let mut later = committed.summary.metadata.clone();
    later.name = "后来的名字".into();
    store
        .update_metadata(&material.summary.id, 2, later.clone())
        .unwrap();
    assert_eq!(store.commit_edit(request.clone()).unwrap(), committed);
    let current = store.get(&material.summary.id).unwrap();
    assert_eq!(current.summary.revision, 2);
    assert_eq!(current.summary.metadata_version, 3);
    assert_eq!(current.summary.metadata, later);
    for (field, value) in [
        ("metadata", json!(committed.summary.metadata)),
        ("expectedVersion", json!(2)),
    ] {
        let mut changed = serde_json::to_value(&request).unwrap();
        changed["metadataUpdate"][field] = value;
        assert_eq!(
            store
                .commit_edit(serde_json::from_value(changed).unwrap())
                .unwrap_err()
                .code,
            "library_operation_conflict"
        );
    }
}

#[test]
fn library_combined_edit_payload_only_wire_and_existing_receipt_hash_remain_unchanged() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let request = update(&session);
    let serialized = serde_json::to_vec(&request).unwrap();
    let old_wire = format!(
        "{{\"operationId\":{},\"sessionId\":{},\"payload\":{}}}",
        serde_json::to_string(&request.operation_id).unwrap(),
        serde_json::to_string(&request.session_id).unwrap(),
        serde_json::to_string(&request.payload).unwrap()
    );
    assert_eq!(serialized, old_wire.as_bytes());
    let mut metadata = material.summary.metadata.clone();
    metadata.name = "并发元数据".into();
    store
        .update_metadata(&material.summary.id, 1, metadata.clone())
        .unwrap();
    let committed = store.commit_edit(request.clone()).unwrap();
    assert_eq!(committed.summary.metadata, metadata);
    assert_eq!(committed.summary.metadata_version, 2);
    assert_eq!(committed.summary.revision, 2);
    let hash: String = store
        .conn
        .query_row(
            "SELECT intent_hash FROM edit_receipts WHERE operation_id=?1",
            [&request.operation_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(hash, files::hash(old_wire.as_bytes()));
    drop(store);
    let mut store = fixture.store();
    assert_eq!(store.commit_edit(request).unwrap(), committed);
}

#[test]
fn library_combined_edit_closed_wire_rejects_unknown_and_malformed_nested_fields() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let request = combined(&session, 1, material.summary.metadata.clone());
    let wire = serde_json::to_value(&request).unwrap();
    for invalid in [
        json!(null),
        json!({}),
        json!({"expectedVersion":-1,"metadata":material.summary.metadata}),
        json!({"expectedVersion":1.5,"metadata":material.summary.metadata}),
        json!({"expectedVersion":4294967296_u64,"metadata":material.summary.metadata}),
        json!({"expectedVersion":1,"metadata":material.summary.metadata,"deletedAt":null}),
        json!({"expectedVersion":1,"metadata":null}),
    ] {
        let mut malformed = wire.clone();
        malformed["metadataUpdate"] = invalid;
        assert!(serde_json::from_value::<MaterialContentUpdate>(malformed).is_err());
    }
    let mut malformed = wire;
    malformed["metadataUpdate"]["metadata"]["file"] = json!("outside.png");
    assert!(serde_json::from_value::<MaterialContentUpdate>(malformed).is_err());
    assert_eq!(store.get(&material.summary.id).unwrap(), material);
}

#[test]
fn library_combined_edit_database_failure_rolls_back_metadata_content_preview_search_and_receipt() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    preview(&mut store, &fixture, &material);
    let before = store.get(&material.summary.id).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let mut metadata = material.summary.metadata.clone();
    metadata.name = "不应发布名字".into();
    let mut request = combined(&session, 1, metadata);
    request.payload.component["source"] = json!("不应发布内容");
    let staged = store
        .crop_edit_image(
            &session.session_id,
            &material.images[0].local_image_id,
            MaterialEditCropBounds {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
            },
        )
        .unwrap();
    images_mut(&mut request.payload)[0]["localImageId"] = json!(staged.local_image_id);
    store
        .conn
        .execute_batch(
            "CREATE TRIGGER fail_combined_receipt BEFORE INSERT ON edit_receipts
         BEGIN SELECT RAISE(ABORT,'sensitive transaction failure'); END;",
        )
        .unwrap();
    let failure = store.commit_edit(request.clone()).unwrap_err();
    assert_eq!(failure.code, "library_database");
    assert!(!failure.message.contains("sensitive"));
    assert_eq!(store.get(&material.summary.id).unwrap(), before);
    assert_eq!(count(&store, "edit_receipts"), 0);
    assert_eq!(count(&store, "blobs"), 1);
    assert_eq!(store.search(query("不应发布")).unwrap().total, 0);
    assert!(store
        .load_preview(&material.summary.id, 1)
        .unwrap()
        .is_some());
    assert!(draft_path(&store, &session).exists());
    store
        .conn
        .execute_batch("DROP TRIGGER fail_combined_receipt;")
        .unwrap();
    let saved = store.commit_edit(request).unwrap();
    assert_eq!(saved.summary.revision, 2);
    assert_eq!(saved.summary.metadata_version, 2);
    assert_eq!(saved.images[0].local_image_id, staged.local_image_id);
    assert_ne!(saved.images[0].blob_id, material.images[0].blob_id);
    assert_eq!(count(&store, "blobs"), 2);
}

#[test]
fn library_combined_edit_invalid_or_stale_metadata_never_publishes_staged_instances() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let staged = store
        .crop_edit_image(
            &session.session_id,
            &material.images[0].local_image_id,
            MaterialEditCropBounds {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
            },
        )
        .unwrap();
    let manifest: Value = serde_json::from_slice(
        &fs::read(draft_path(&store, &session).join("manifest.json")).unwrap(),
    ).unwrap();
    let stored: MaterialImage = serde_json::from_value(manifest["staged"][0].clone()).unwrap();
    assert_eq!(stored.local_image_id, staged.local_image_id);
    let object = store.instance_path(stored.storage_id.as_deref().unwrap(), "image/png").unwrap();
    assert!(!object.exists());
    for (expected_version, invalid_name, code) in [
        (1, "", "library_validation"),
        (0, "valid", "library_metadata_conflict"),
        (2, "valid", "library_metadata_conflict"),
    ] {
        let mut metadata = material.summary.metadata.clone();
        metadata.name = invalid_name.into();
        let mut request = combined(&session, expected_version, metadata);
        images_mut(&mut request.payload)[0]["localImageId"] = json!(staged.local_image_id);
        assert_eq!(store.commit_edit(request).unwrap_err().code, code);
        assert!(!object.exists());
        assert_eq!(store.get(&material.summary.id).unwrap(), material);
        assert_eq!(count(&store, "edit_receipts"), 0);
    }
    store.discard_edit(&session.session_id).unwrap();
    assert!(!draft_path(&store, &session).exists());
    assert_eq!(store.get(&material.summary.id).unwrap(), material);
}

#[test]
fn library_combined_edit_discard_cancels_metadata_and_component_staging_together() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    preview(&mut store, &fixture, &material);
    let before = store.get(&material.summary.id).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let staged = store
        .crop_edit_image(
            &session.session_id,
            &material.images[0].local_image_id,
            MaterialEditCropBounds {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
            },
        )
        .unwrap();
    let mut metadata = material.summary.metadata.clone();
    metadata.name = "已取消名称".into();
    let mut request = combined(&session, 1, metadata);
    images_mut(&mut request.payload)[0]["localImageId"] = json!(staged.local_image_id);
    store.discard_edit(&session.session_id).unwrap();
    assert_eq!(store.get(&material.summary.id).unwrap(), before);
    assert_eq!(count(&store, "edit_receipts"), 0);
    assert_eq!(store.search(query("已取消")).unwrap().total, 0);
    assert!(!draft_path(&store, &session).exists());
    assert_eq!(
        store.commit_edit(request).unwrap_err().code,
        "library_edit_not_found"
    );
    assert_eq!(
        fs::read(fixture.project.join("references").join("0001.png")).unwrap(),
        fixture.bytes
    );
}

#[test]
fn library_combined_edit_schema_enforces_closed_versioned_transitions() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    for changes in [
        "'$.metadataVersion',0",
        "'$.metadataVersion',3",
        "'$.metadataVersion',1.5",
        "'$.metadataVersion',NULL",
        "'$.metadataVersion',4294967296",
        "'$.name','unversioned'",
        "'$.description','unversioned'",
        "'$.tags',json('[\"unversioned\"]')",
        "'$.favorite',json('true')",
        "'$.deletedAt',12345",
        "'$.metadataVersion',2,'$.payload.component.source','content-without-revision'",
        "'$.revision',2,'$.metadataVersion',3,'$.name','skipped-version'",
        "'$.revision',2,'$.metadataVersion',2,'$.deletedAt',12345",
        "'$.revision',2,'$.metadataVersion',2,'$.createdAt',0",
        "'$.revision',2,'$.metadataVersion',2,'$.id','changed-id'",
        "'$.revision',2,'$.metadataVersion',2,'$.kind','clothing'",
        "'$.revision',2,'$.metadataVersion',2,'$.payload.kind','clothing'",
    ] {
        assert!(
            store
                .conn
                .execute(
                    &format!("UPDATE materials SET detail_json=json_set(detail_json,{changes})"),
                    [],
                )
                .is_err(),
            "{changes}"
        );
        assert_eq!(store.get(&material.summary.id).unwrap(), material);
    }
    for changes in [
        "'$.metadataVersion',2",
        "'$.metadataVersion',2,'$.name','metadata-only'",
        "'$.metadataVersion',2,'$.description','new description'",
        "'$.metadataVersion',2,'$.tags',json('[\"new\"]')",
        "'$.metadataVersion',2,'$.favorite',json('true')",
        "'$.metadataVersion',2,'$.deletedAt',12345",
        "'$.revision',2,'$.payload.component.source','content-only'",
        "'$.revision',2,'$.metadataVersion',2",
        "'$.revision',2,'$.metadataVersion',2,'$.name','unified','$.payload.component.source','content'",
    ] {
        store.conn.execute_batch("SAVEPOINT transition;").unwrap();
        assert!(store.conn.execute(
            &format!("UPDATE materials SET detail_json=json_set(detail_json,{changes})"),
            [],
        ).is_ok(), "{changes}");
        store.conn.execute_batch("ROLLBACK TO transition; RELEASE transition;").unwrap();
    }
    store.set_deleted(&material.summary.id, 1, true).unwrap();
    assert!(store.conn.execute(
        "UPDATE materials SET detail_json=json_set(detail_json,'$.revision',2,'$.metadataVersion',3,'$.deletedAt',NULL)",
        [],
    ).is_err(), "Restore and content revision must never be combined");
    store.set_deleted(&material.summary.id, 2, false).unwrap();
}

#[test]
fn library_combined_edit_version_exhaustion_is_deterministic_and_never_partial() {
    for field in ["metadataVersion", "revision"] {
        let fixture = Fixture::new("prop");
        let mut store = fixture.store();
        let material = store.save(fixture.save_request()).unwrap();
        store
            .conn
            .execute_batch("DROP TRIGGER revisioned_content;")
            .unwrap();
        store
            .conn
            .execute(
                &format!(
                    "UPDATE materials SET detail_json=json_set(detail_json,'$.{field}',4294967295)"
                ),
                [],
            )
            .unwrap();
        store
            .conn
            .execute_batch(include_str!("schema.sql"))
            .unwrap();
        let before = store.get(&material.summary.id).unwrap();
        let session = store
            .begin_edit(&material.summary.id, before.summary.revision)
            .unwrap();
        let request = combined(
            &session,
            before.summary.metadata_version,
            before.summary.metadata.clone(),
        );
        assert_eq!(
            store.commit_edit(request).unwrap_err().code,
            if field == "metadataVersion" {
                "library_metadata_conflict"
            } else {
                "library_revision"
            },
        );
        assert_eq!(store.get(&material.summary.id).unwrap(), before);
        assert_eq!(count(&store, "edit_receipts"), 0);
        assert_eq!(store.blob(&material.images[0]).unwrap(), fixture.bytes);
        if field == "metadataVersion" {
            let legacy = store.commit_edit(update(&session)).unwrap();
            assert_eq!(legacy.summary.metadata_version, u32::MAX);
            assert_eq!(legacy.summary.revision, 2);
        }
    }
}

fn old_edit_guard(store: &Store, version: u32) {
    store.conn.execute_batch(
        "DROP TRIGGER revisioned_content;
         CREATE TRIGGER revisioned_content BEFORE UPDATE OF detail_json ON materials
         WHEN json_extract(new.detail_json,'$.revision') <> json_extract(old.detail_json,'$.revision')
          AND json_extract(new.detail_json,'$.metadataVersion') <> json_extract(old.detail_json,'$.metadataVersion')
         BEGIN SELECT RAISE(ABORT,'old separate-edit guard'); END;"
    ).unwrap();
    if version == 1 {
        store.conn.execute_batch(
            "DROP TRIGGER revisioned_content;
             CREATE TRIGGER immutable_content BEFORE UPDATE OF detail_json ON materials
             WHEN json_extract(new.detail_json,'$.revision') <> json_extract(old.detail_json,'$.revision')
             BEGIN SELECT RAISE(ABORT,'old immutable-content guard'); END;"
        ).unwrap();
    }
    store
        .conn
        .pragma_update(None, "user_version", version)
        .unwrap();
}

#[test]
fn library_combined_edit_migrates_v1_v2_v3_and_preserves_existing_save_and_edit_receipts() {
    for version in [1, 2, 3] {
        let fixture = Fixture::new("prop");
        let mut store = fixture.store();
        let saved = fixture.save_request();
        let mut material = store.save_legacy_fixture(saved.clone()).unwrap();
        let old_request = if version > 1 {
            let session = store.begin_edit(&material.summary.id, 1).unwrap();
            let request = update(&session);
            material = store.commit_edit(request.clone()).unwrap();
            store.discard_edit(&session.session_id).unwrap();
            Some(request)
        } else {
            None
        };
        preview(&mut store, &fixture, &material);
        old_edit_guard(&store, version);
        drop(store);
        let mut store = fixture.store();
        assert_eq!(
            store
                .conn
                .pragma_query_value::<u32, _>(None, "user_version", |row| row.get(0))
                .unwrap(),
            6
        );
        let current = store.get(&material.summary.id).unwrap();
        assert_eq!(store.save(saved).unwrap(), current);
        if let Some(old_request) = old_request {
            assert_eq!(store.commit_edit(old_request).unwrap(), material);
        }
        let session = store
            .begin_edit(&material.summary.id, current.summary.revision)
            .unwrap();
        let mut metadata = current.summary.metadata.clone();
        metadata.name = "迁移后统一编辑".into();
        let committed = store
            .commit_edit(combined(
                &session,
                current.summary.metadata_version,
                metadata,
            ))
            .unwrap();
        assert_eq!(committed.summary.revision, current.summary.revision + 1);
        assert_eq!(
            committed.summary.metadata_version,
            current.summary.metadata_version + 1
        );
        assert_eq!(store.search(query("统一编辑")).unwrap().total, 1);
    }
}

#[test]
fn library_combined_edit_failed_v4_migration_rolls_back_the_old_guard_and_version() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    old_edit_guard(&store, 3);
    let interrupted = include_str!("schema.sql").replace(
        "PRAGMA user_version = 4;",
        "SELECT * FROM missing_combined_migration_fixture; PRAGMA user_version = 4;",
    );
    assert!(store.conn.execute_batch(&interrupted).is_err());
    store.conn.execute_batch("ROLLBACK;").unwrap();
    assert_eq!(
        store
            .conn
            .pragma_query_value::<u32, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        3
    );
    assert!(store.conn.execute(
        "UPDATE materials SET detail_json=json_set(detail_json,'$.revision',2,'$.metadataVersion',2)",
        [],
    ).is_err());
    assert_eq!(store.get(&material.summary.id).unwrap(), material);
    drop(store);
    let mut store = fixture.store();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    store
        .commit_edit(combined(&session, 1, material.summary.metadata.clone()))
        .unwrap();
}

#[test]
fn library_combined_edit_receipt_remains_exact_after_purge_and_cannot_resurrect_content() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let session = store.begin_edit(&material.summary.id, 1).unwrap();
    let mut metadata = material.summary.metadata.clone();
    metadata.name = "统一保存后永久删除".into();
    let request = combined(&session, 1, metadata);
    let committed = store.commit_edit(request.clone()).unwrap();
    store.discard_edit(&session.session_id).unwrap();
    let deleted = store
        .set_deleted(
            &material.summary.id,
            committed.summary.metadata_version,
            true,
        )
        .unwrap();
    store.purge(&deleted.id, deleted.metadata_version).unwrap();
    drop(store);
    let mut store = fixture.store();
    assert_eq!(
        store.commit_edit(request.clone()).unwrap_err().code,
        "library_purged"
    );
    let mut changed = serde_json::to_value(request).unwrap();
    changed["metadataUpdate"]["metadata"]["name"] = json!("changed");
    assert_eq!(
        store
            .commit_edit(serde_json::from_value(changed).unwrap())
            .unwrap_err()
            .code,
        "library_operation_conflict"
    );
    assert_eq!(count(&store, "materials"), 0);
    assert_eq!(count(&store, "edit_receipts"), 0);
    assert_eq!(count(&store, "blobs"), 0);
}
