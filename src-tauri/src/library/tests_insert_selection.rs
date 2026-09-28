use super::*;

fn append_to_target(fixture: &Fixture, prepared: &PreparedMaterialInsert) -> Value {
    let mut next = fixture.plan.clone();
    for visual in validation::payload_images(&prepared.payload).unwrap() {
        let mut image = visual.clone();
        let source = prepared.images.iter().find(|source| visual["localImageId"] == source.local_image_id).unwrap();
        image.as_object_mut().unwrap().remove("localImageId");
        image["id"] = json!(Uuid::new_v4().to_string());
        image["file"] = json!(source.file);
        next["imageGroups"][0]["images"].as_array_mut().unwrap().push(image);
    }
    next
}

#[test]
fn material_images_append_to_a_pinned_group_with_independent_files_and_exact_recovery() {
    for single in [false, true] {
        let fixture = group_fixture();
        let mut store = fixture.store();
        let mut save = fixture.save_request();
        if single {
            let image = validation::payload_images(&save.snapshot.payload).unwrap()[0].clone();
            save.snapshot.payload.kind = MaterialKind::Image;
            save.snapshot.payload.component = json!({"kind":"image","name":image["caption"],"description":"","images":[image]});
            save.snapshot.sources.truncate(1);
        }
        let saved = store.save(save).unwrap();
        let mut request = fixture.insert_request(&saved);
        request.target_group_id = Some("source".into());
        if !single {
            request.selection = Some(MaterialImageSelection { mode: MaterialImageInsertMode::ImageGroup,
                image_ids: vec![saved.images[2].local_image_id.clone(), saved.images[0].local_image_id.clone()] });
        }
        let prepared = store.prepare_insert(request.clone()).unwrap();
        assert_eq!(prepared.target_group_id.as_deref(), Some("source"));
        assert_eq!(prepared.images.len(), if single { 1 } else { 2 });
        assert_eq!(store.prepare_insert(request.clone()).unwrap(), prepared);
        let mut changed = request.clone();
        changed.target_group_id = None;
        assert!(store.prepare_insert(changed).is_err());
        let next = append_to_target(&fixture, &prepared);
        let mut forged = next.clone();
        forged["imageGroups"][0]["name"] = json!("changed");
        assert!(insert::commit(fixture.commit_request(&prepared, &forged)).is_err());
        let mut forged = next.clone();
        forged["imageGroups"][0]["images"][3]["id"] = json!("source-1");
        assert!(insert::commit(fixture.commit_request(&prepared, &forged)).is_err());
        if !single {
            let mut forged = next.clone();
            forged["imageGroups"][0]["images"].as_array_mut().unwrap().swap(3, 4);
            assert!(insert::commit(fixture.commit_request(&prepared, &forged)).is_err());
        }
        insert::commit(fixture.commit_request(&prepared, &next)).unwrap();
        insert::commit(fixture.commit_request(&prepared, &next)).unwrap();
        assert_eq!(next["document"], fixture.plan["document"]);
        assert_eq!(next["imageGroups"][0]["name"], fixture.plan["imageGroups"][0]["name"]);
        for copy in &prepared.images {
            assert!(copy.file.starts_with("references/"));
            assert_eq!(fs::read(fixture.project.join(&copy.file)).unwrap(), fixture.bytes);
        }
        drop(store);
        let store = fixture.store();
        assert_eq!(store.get(&saved.summary.id).unwrap(), saved);
        assert_eq!(insert::status(fixture.project.to_str().unwrap(), &prepared.operation_id).unwrap(), MaterialInsertStatus::Committed);
        assert_eq!(crate::workspace::read_manifest(&fixture.project).unwrap().plan, Some(next));
    }
}

#[test]
fn target_insertion_rejects_invalid_modes_and_targets_and_cancels_owned_files() {
    let fixture = group_fixture();
    let mut store = fixture.store();
    let saved = store.save(fixture.save_request()).unwrap();
    for target in ["", "missing"] {
        let mut request = fixture.insert_request(&saved);
        request.target_group_id = Some(target.into());
        assert!(store.prepare_insert(request).is_err());
    }
    let mut request = fixture.insert_request(&saved);
    request.target_group_id = Some("source".into());
    request.selection = Some(MaterialImageSelection { mode: MaterialImageInsertMode::Images, image_ids: vec![saved.images[0].local_image_id.clone()] });
    assert!(store.prepare_insert(request).is_err());
    let mut request = fixture.insert_request(&saved);
    request.target_group_id = Some("source".into());
    let prepared = store.prepare_insert(request).unwrap();
    insert::abort(fixture.project.to_str().unwrap(), &prepared.operation_id).unwrap();
    assert!(prepared.images.iter().all(|image| !fixture.project.join(&image.file).exists()));
    assert_eq!(fs::read(fixture.project.join("references/0001.png")).unwrap(), fixture.bytes);
    let result = store.search(serde_json::from_value(json!({"query":"","imagesOnly":true,"sort":"recent","offset":0,"limit":50})).unwrap()).unwrap();
    assert_eq!(result.total, 1);
}

fn group_fixture() -> Fixture {
    let mut fixture = Fixture::new("imageGroup");
    let original = fixture.plan["imageGroups"][0]["images"][0].clone();
    fixture.plan["imageGroups"][0]["images"] = Value::Array((1..=3).map(|index| {
        let mut image = original.clone();
        let file = format!("references/{index:04}.png");
        fs::write(fixture.project.join(&file), &fixture.bytes).unwrap();
        image["id"] = json!(format!("source-{index}"));
        image["file"] = json!(file);
        image["caption"] = json!(format!("image-{index}"));
        image
    }).collect());
    fixture.write_plan(&fixture.plan);
    fixture
}

#[test]
fn image_group_subsets_copy_only_selected_images_in_original_order_for_both_modes() {
    for mode in [MaterialImageInsertMode::ImageGroup, MaterialImageInsertMode::Images] {
        for count in [1, 2, 3] {
            let fixture = group_fixture();
            let mut store = fixture.store();
            let saved = store.save(fixture.save_request()).unwrap();
            let mut request = fixture.insert_request(&saved);
            let images = validation::payload_images(&saved.payload).unwrap();
            let ids: Vec<_> = images.iter().take(count).rev().map(|image| image["localImageId"].as_str().unwrap().to_owned()).collect();
            request.selection = Some(MaterialImageSelection { image_ids: ids, mode: mode.clone() });
            let prepared = store.prepare_insert(request.clone()).unwrap();
            assert_eq!(prepared.images.len(), count);
            assert_eq!(store.prepare_insert(request.clone()).unwrap(), prepared);
            let mut changed = request.clone();
            changed.selection.as_mut().unwrap().mode = if mode == MaterialImageInsertMode::Images { MaterialImageInsertMode::ImageGroup } else { MaterialImageInsertMode::Images };
            assert!(store.prepare_insert(changed).is_err());
            let next = fixture.next_plan(&prepared);
            let commit = fixture.commit_request(&prepared, &next);
            insert::commit(commit.clone()).unwrap();
            insert::commit(commit).unwrap();
            if mode == MaterialImageInsertMode::Images {
                assert_eq!(next["imageGroups"], fixture.plan["imageGroups"]);
                let blocks = next["document"]["blocks"].as_array().unwrap();
                assert_eq!(blocks.len(), 1 + count);
                for (index, block) in blocks[1..].iter().enumerate() {
                    assert_eq!(block["type"], "image");
                    assert_eq!(block["props"]["caption"], format!("image-{}", index + 1));
                }
            } else {
                let group = next["imageGroups"].as_array().unwrap().last().unwrap();
                assert_eq!(group["name"], "杭州摄影");
                assert_eq!(group["description"], "西湖日落");
                assert_eq!(group["images"].as_array().unwrap().len(), count);
            }
            crate::plan::save_project_plan_in(&fixture.project, fixture.plan.clone()).unwrap();
            for source in &prepared.images {
                assert!(insert::retain_reference_for_material_history(&fixture.project, &source.file).unwrap());
                assert_eq!(fs::read(fixture.project.join(&source.file)).unwrap(), fixture.bytes);
            }
            crate::plan::save_project_plan_in(&fixture.project, next.clone()).unwrap();
            insert::reconcile_project(&fixture.project).unwrap();
            assert_eq!(crate::workspace::read_manifest(&fixture.project).unwrap().plan, Some(next));
        }
    }
}

#[test]
fn group_selection_rejects_invalid_ids_and_cancels_an_entire_native_batch() {
    let fixture = group_fixture();
    let mut store = fixture.store();
    let saved = store.save(fixture.save_request()).unwrap();
    let ids: Vec<_> = saved.images.iter().map(|image| image.local_image_id.clone()).collect();
    for selected in [vec![], vec!["unknown".into()], vec![ids[0].clone(), ids[0].clone()]] {
        let mut request = fixture.insert_request(&saved);
        request.selection = Some(MaterialImageSelection { image_ids: selected, mode: MaterialImageInsertMode::Images });
        assert!(store.prepare_insert(request).is_err());
    }
    let mut request = fixture.insert_request(&saved);
    request.selection = Some(MaterialImageSelection { image_ids: vec![ids[0].clone(), ids[2].clone()], mode: MaterialImageInsertMode::Images });
    let prepared = store.prepare_insert(request).unwrap();
    let next = fixture.next_plan(&prepared);
    let mut swapped = next.clone();
    swapped["document"]["blocks"].as_array_mut().unwrap().swap(1, 2);
    assert!(insert::commit(fixture.commit_request(&prepared, &swapped)).is_err());
    let mut truncated = next.clone();
    truncated["document"]["blocks"].as_array_mut().unwrap().pop();
    assert!(insert::commit(fixture.commit_request(&prepared, &truncated)).is_err());
    insert::abort(fixture.project.to_str().unwrap(), &prepared.operation_id).unwrap();
    for source in &prepared.images { assert!(!fixture.project.join(&source.file).exists()); }
    for image in &saved.images { assert_eq!(store.blob(image).unwrap(), fixture.bytes); }
    assert_eq!(crate::workspace::read_manifest(&fixture.project).unwrap().plan, Some(fixture.plan));
}

#[test]
fn missing_unselected_original_is_ignored_and_partial_copy_failure_rolls_back() {
    let fixture = group_fixture();
    let mut store = fixture.store();
    let saved = store.save(fixture.save_request()).unwrap();
    let missing = &saved.images[1];
    fs::remove_file(store.instance_path(missing.storage_id.as_ref().unwrap(), &missing.mime_type).unwrap()).unwrap();
    let mut request = fixture.insert_request(&saved);
    request.selection = Some(MaterialImageSelection { image_ids: vec![saved.images[0].local_image_id.clone(), saved.images[2].local_image_id.clone()], mode: MaterialImageInsertMode::Images });
    let prepared = store.prepare_insert(request).unwrap();
    assert_eq!(prepared.images.len(), 2);
    insert::abort(fixture.project.to_str().unwrap(), &prepared.operation_id).unwrap();
    let mut failing = fixture.insert_request(&saved);
    failing.selection = Some(MaterialImageSelection { image_ids: saved.images.iter().map(|image| image.local_image_id.clone()).collect(), mode: MaterialImageInsertMode::Images });
    assert!(store.prepare_insert(failing.clone()).is_err());
    assert_eq!(insert::status(fixture.project.to_str().unwrap(), &failing.operation_id).unwrap(), MaterialInsertStatus::Cancelled);
    assert_eq!(fs::read_dir(fixture.project.join("media")).unwrap().count(), 0);
    assert_eq!(crate::workspace::read_manifest(&fixture.project).unwrap().plan, Some(fixture.plan));
}

#[test]
fn split_group_renders_each_image_and_tracks_transformed_jpeg_as_png() {
    let mut fixture = group_fixture();
    let mut jpeg = Cursor::new(Vec::new());
    DynamicImage::new_rgb8(6, 4).write_to(&mut jpeg, ImageFormat::Jpeg).unwrap();
    fs::write(fixture.project.join("references/0002.jpg"), jpeg.get_ref()).unwrap();
    let second = &mut fixture.plan["imageGroups"][0]["images"][1];
    second["file"] = json!("references/0002.jpg");
    second["frameWidth"] = json!(100);
    second["frameHeight"] = json!(100);
    second["fitMode"] = json!("cover");
    fixture.write_plan(&fixture.plan);
    let mut store = fixture.store();
    let saved = store.save(fixture.save_request()).unwrap();
    let mut request = fixture.insert_request(&saved);
    request.selection = Some(MaterialImageSelection { image_ids: saved.images[..2].iter().map(|image| image.local_image_id.clone()).collect(), mode: MaterialImageInsertMode::Images });
    let prepared = store.prepare_insert(request).unwrap();
    let dimensions: Vec<_> = prepared.images.iter().map(|source| {
        assert!(source.file.ends_with(".png"));
        let bytes = fs::read(fixture.project.join(&source.file)).unwrap();
        let image = image::load_from_memory(&bytes).unwrap();
        (image.width(), image.height())
    }).collect();
    assert_eq!(dimensions, vec![(3, 2), (4, 4)]);
    let next = fixture.next_plan(&prepared);
    insert::commit(fixture.commit_request(&prepared, &next)).unwrap();
    insert::reconcile_project(&fixture.project).unwrap();
    assert_eq!(store.blob(&saved.images[1]).unwrap(), *jpeg.get_ref());
}
