use super::*;

fn request(fixture: &Fixture) -> MaterialSaveRequest {
    let mut input = fixture.save_request();
    let image = validation::payload_images(&input.snapshot.payload).unwrap()[0].clone();
    input.snapshot.payload.kind = MaterialKind::Image;
    input.snapshot.payload.component =
        json!({"kind":"image","name":image["caption"],"description":"","images":[image]});
    input.metadata.description = "柔和的午后自然光".into();
    input.metadata.tags = vec!["肖像灵感".into()];
    input
}

fn query(text: &str) -> MaterialSearch {
    serde_json::from_value(
        json!({"query":text,"kind":"image","sort":"relevance","offset":0,"limit":20}),
    )
    .unwrap()
}

#[test]
fn a_selected_legacy_clothing_image_does_not_collect_the_main_gallery() {
    let mut fixture = Fixture::new("clothing");
    let mut input = request(&fixture);
    fs::write(
        fixture.project.join("references/legacy.png"),
        &fixture.bytes,
    )
    .unwrap();
    let mut legacy = fixture.plan["artifacts"][0]["mainGallery"]["images"][0].clone();
    legacy["id"] = json!("legacy-selected");
    legacy["file"] = json!("references/legacy.png");
    fixture.plan["artifacts"][0]["tryOn"]["gallery"]["images"] = json!([legacy]);
    fixture.write_plan(&fixture.plan);
    input.expected_plan = fixture.plan.clone();
    input.snapshot.sources[0].file = "references/legacy.png".into();
    let mut store = fixture.store();
    let saved = store.save(input).unwrap();
    assert_eq!(saved.summary.image_count, 1);
    assert_eq!(saved.summary.kind, MaterialKind::Image);
}

#[test]
fn image_material_copies_one_image_searches_metadata_and_inserts_an_independent_row() {
    for kind in [
        "imageGroup",
        "shootingLocation",
        "modelCard",
        "prop",
        "clothing",
    ] {
        let fixture = Fixture::new(kind);
        let mut store = fixture.store();
        let input = request(&fixture);
        let saved = store.save(input.clone()).unwrap();
        assert_eq!(saved.summary.kind, MaterialKind::Image);
        assert_eq!(saved.summary.image_count, 1);
        assert!(saved.images[0].storage_id.is_some());
        assert_eq!(store.save(input).unwrap(), saved);
        for word in ["午后自然光", "肖像灵感", "窗边逆光"] {
            assert_eq!(store.search(query(word)).unwrap().total, 1);
        }
        let prepared = store
            .prepare_insert(fixture.insert_request(&saved))
            .unwrap();
        let next = fixture.next_plan(&prepared);
        let insert = fixture.insert_request(&saved);
        insert::commit(MaterialInsertCommit {
            operation_id: prepared.operation_id.clone(),
            project_id: insert.project_id,
            project_path: insert.project_path,
            expected_plan: fixture.plan.clone(),
            next_plan: next.clone(),
        })
        .unwrap();
        let block = next["document"]["blocks"].as_array().unwrap().last().unwrap();
        assert_eq!(block["type"], "image");
        assert_eq!(block["props"]["url"], prepared.images[0].file);
        assert_eq!(next["imageGroups"], fixture.plan["imageGroups"]);
        assert!(prepared.images[0].file.starts_with("media/"));
        fs::remove_file(fixture.project.join("references/0001.png")).unwrap();
        assert_eq!(store.blob(&saved.images[0]).unwrap(), fixture.bytes);
        assert!(fixture.project.join(&prepared.images[0].file).is_file());
        assert!(insert::retain_reference_for_material_history(&fixture.project, &prepared.images[0].file).unwrap());
    }
}

#[test]
fn native_image_snapshot_verifies_owning_block_file_and_real_dimensions() {
    let mut fixture = Fixture::new("imageGroup");
    let mut input = request(&fixture);
    fs::create_dir(fixture.project.join("media")).unwrap();
    fs::write(fixture.project.join("media/photo.png"), &fixture.bytes).unwrap();
    fixture.plan["imageGroups"] = json!([]);
    fixture.plan["document"]["blocks"] = json!([{"id":"block-source","type":"image",
        "props":{"url":"media/photo.png","name":"日落","caption":"逆光","previewWidth":300,"showPreview":true},"children":[]}]);
    fixture.write_plan(&fixture.plan);
    input.expected_plan = fixture.plan.clone();
    input.snapshot.sources[0].file = "media/photo.png".into();
    input.snapshot.payload.component = json!({"kind":"image","name":"日落","description":"","images":[{
        "localImageId":input.snapshot.sources[0].local_image_id,"caption":"逆光","aspectRatio":1.5,
        "frameWidth":300,"frameHeight":200,"sourceWidth":3,"sourceHeight":2}]});
    let mut store = fixture.store();
    let mut forged = input.clone();
    forged.operation_id = Uuid::new_v4().to_string();
    forged.snapshot.payload.component["images"][0]["sourceWidth"] = json!(6);
    forged.snapshot.payload.component["images"][0]["sourceHeight"] = json!(4);
    assert!(store.save(forged).is_err());
    let mut wrong_file = input.clone();
    wrong_file.operation_id = Uuid::new_v4().to_string();
    wrong_file.snapshot.sources[0].file = "media/other.png".into();
    assert!(store.save(wrong_file).is_err());
    let saved = store.save(input.clone()).unwrap();
    assert_eq!(saved.summary.kind, MaterialKind::Image);
    assert_eq!(store.blob(&saved.images[0]).unwrap(), fixture.bytes);
    let native = fixture.plan["document"]["blocks"][0].clone();
    fixture.plan["document"]["blocks"] =
        json!([{"id":"parent","type":"paragraph","props":{},"content":[],"children":[native]}]);
    fixture.write_plan(&fixture.plan);
    input.operation_id = Uuid::new_v4().to_string();
    input.expected_plan = fixture.plan.clone();
    let nested = store.save(input).unwrap();
    assert_eq!(nested.payload, saved.payload);
    assert_ne!(nested.images[0].storage_id, saved.images[0].storage_id);
}

#[test]
fn v5_upgrade_retains_exact_material_and_save_receipt() {
    let fixture = Fixture::new("prop");
    let input = fixture.save_request();
    let mut store = fixture.store();
    let saved = store.save(input.clone()).unwrap();
    store.conn.pragma_update(None, "user_version", 5).unwrap();
    drop(store);
    let mut store = fixture.store();
    assert_eq!(store.get(&saved.summary.id).unwrap(), saved);
    assert_eq!(store.save(input).unwrap(), saved);
}

#[test]
fn native_image_insertion_retains_original_bytes_through_undo_removal_and_reopen() {
    let mut fixture = Fixture::new("imageGroup");
    fixture.plan["imageGroups"][0]["images"][0] = json!({
        "id":"source-image", "file":"references/0001.png", "caption":"原图",
        "aspectRatio":1.5,"frameWidth":300,"frameHeight":200
    });
    fixture.write_plan(&fixture.plan);
    let mut store = fixture.store();
    let saved = store.save(request(&fixture)).unwrap();
    let prepared = store.prepare_insert(fixture.insert_request(&saved)).unwrap();
    let file = &prepared.images[0].file;
    assert_eq!(fs::read(fixture.project.join(file)).unwrap(), fixture.bytes);
    let next = fixture.next_plan(&prepared);
    insert::commit(fixture.commit_request(&prepared, &next)).unwrap();
    let on_disk = crate::workspace::read_manifest(&fixture.project).unwrap();
    assert_eq!(on_disk.plan, Some(next.clone()));
    // Undo removes the block, but native media cleanup must retain its redo file.
    crate::plan::save_project_plan_in(&fixture.project, fixture.plan.clone()).unwrap();
    crate::plan::remove_plan_media_from(&fixture.project, file).unwrap();
    assert_eq!(fs::read(fixture.project.join(file)).unwrap(), fixture.bytes);
    crate::plan::save_project_plan_in(&fixture.project, next.clone()).unwrap();
    insert::reconcile_project(&fixture.project).unwrap();
    assert_eq!(crate::workspace::read_manifest(&fixture.project).unwrap().plan, Some(next));
    assert!(crate::plan::load_plan_media_from(&fixture.project, file).unwrap().starts_with("data:image/png;base64,"));
}

#[test]
fn native_image_prepare_aborts_only_its_own_copy_and_rejects_forged_insertions() {
    let fixture = Fixture::new("imageGroup");
    let mut store = fixture.store();
    let saved = store.save(request(&fixture)).unwrap();
    let prepared = store.prepare_insert(fixture.insert_request(&saved)).unwrap();
    let next = fixture.next_plan(&prepared);
    for field in ["url", "name", "caption", "previewWidth", "groupId"] {
        let mut forged = next.clone();
        let block = forged["document"]["blocks"].as_array_mut().unwrap().last_mut().unwrap();
        block["props"][field] = json!("forged");
        assert!(insert::commit(fixture.commit_request(&prepared, &forged)).is_err());
    }
    let mut extra = next.clone();
    extra["imageGroups"].as_array_mut().unwrap().push(json!({"id":"extra"}));
    assert!(insert::commit(fixture.commit_request(&prepared, &extra)).is_err());
    insert::abort(fixture.project.to_str().unwrap(), &prepared.operation_id).unwrap();
    assert!(!fixture.project.join(&prepared.images[0].file).exists());
    assert_eq!(fs::read(fixture.project.join("references/0001.png")).unwrap(), fixture.bytes);
    assert_eq!(store.blob(&saved.images[0]).unwrap(), fixture.bytes);
    let next_attempt = store.prepare_insert(fixture.insert_request(&saved)).unwrap();
    assert_ne!(next_attempt.images[0].file, prepared.images[0].file);
    insert::abort(fixture.project.to_str().unwrap(), &next_attempt.operation_id).unwrap();
}

#[test]
fn legacy_group_based_image_receipts_still_reconcile_and_retain_their_copy() {
    let fixture = Fixture::new("imageGroup");
    let mut store = fixture.store();
    let saved = store.save(fixture.save_request()).unwrap();
    let mut prepared = store.prepare_insert(fixture.insert_request(&saved)).unwrap();
    prepared.payload = request(&fixture).snapshot.payload;
    let mut grouped = prepared.clone();
    grouped.payload.kind = MaterialKind::ImageGroup;
    grouped.payload.component["kind"] = json!("imageGroup");
    let next = fixture.next_plan(&grouped);
    // Simulate the exact v1 journal written by the earlier image-group insertion.
    let path = fixture.journal_path(&prepared.operation_id);
    let mut journal: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    journal["prepared"] = serde_json::to_value(&prepared).unwrap();
    journal["nextPlan"] = next.clone();
    journal["phase"] = json!("committed");
    fs::write(path, serde_json::to_vec(&journal).unwrap()).unwrap();
    fixture.write_plan(&next);
    insert::reconcile_project(&fixture.project).unwrap();
    assert!(insert::retain_reference_for_material_history(&fixture.project, &prepared.images[0].file).unwrap());
    assert_eq!(crate::workspace::read_manifest(&fixture.project).unwrap().plan, Some(next));
}
