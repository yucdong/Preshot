use super::*;

struct CreateFixture {
    root: TempDir,
    home: PathBuf,
}

impl CreateFixture {
    fn new() -> Self {
        let root = tempfile::Builder::new()
            .prefix("library-create-test-")
            .tempdir_in(".")
            .unwrap();
        let home = root.path().join("home");
        Self { root, home }
    }

    fn store(&self) -> Store {
        Store::open(&self.home).unwrap()
    }

    fn source(&self) -> PathBuf {
        let source = self.root.path().join("selected-original.png");
        let mut png = Cursor::new(Vec::new());
        DynamicImage::new_rgb8(3, 2)
            .write_to(&mut png, ImageFormat::Png)
            .unwrap();
        fs::write(&source, png.into_inner()).unwrap();
        source
    }
}

fn payload(kind: &str) -> MaterialPayload {
    let component = match kind {
        "image" | "imageGroup" => json!({"kind":kind,"name":"新图片组","description":"","images":[]}),
        "shootingLocation" => {
            json!({"kind":kind,"venueName":"新场地","address":"","description":"","gallery":{"images":[]}})
        }
        "modelCard" => {
            json!({"kind":kind,"modelId":"新模特","heightCm":null,"weightKg":null,"shoeSize":"","notes":"","samples":{"images":[]}})
        }
        "clothing" => json!({"kind":kind,"title":"新服装","source":"","mainGallery":{"images":[]}}),
        _ => json!({"kind":kind,"title":"新道具","source":"","gallery":{"images":[]}}),
    };
    serde_json::from_value(
        json!({"format":"preshot-material","version":1,"kind":kind,"component":component}),
    )
    .unwrap()
}

fn create_request(session: &MaterialEditSession) -> MaterialContentUpdate {
    MaterialContentUpdate {
        operation_id: Uuid::new_v4().to_string(),
        session_id: session.session_id.clone(),
        payload: session.material.payload.clone(),
        metadata_update: Some(MaterialMetadataUpdate {
            expected_version: 0,
            metadata: MaterialMetadata {
                name: "  新建素材  ".into(),
                description: "独立素材库".into(),
                tags: vec!["新建".into()],
                favorite: false,
            },
        }),
    }
}

fn add_image(request: &mut MaterialContentUpdate, image: &MaterialEditImage) {
    images_mut(&mut request.payload).push(json!({
        "localImageId":image.local_image_id,
        "aspectRatio":f64::from(image.width)/f64::from(image.height),
        "frameWidth":150,"frameHeight":100,"fitMode":"stretch","caption":"原始图像",
    }));
}

#[test]
fn exif_materials_keep_raw_integrity_and_pinned_raw_or_oriented_presentations() {
    use crate::original_image::PresentationAxes;
    for kind in ["image", "imageGroup", "shootingLocation", "modelCard", "prop", "clothing"] {
        let fixture = CreateFixture::new();
        let source = fixture.root.path().join("camera.jpg");
        let bytes = crate::original_image::test_jpeg_with_orientation(3, 2, 6);
        fs::write(&source, &bytes).unwrap();
        let hash = files::hash(&bytes);
        let mut store = fixture.store();
        let raw = store.begin_create(payload("imageGroup")).unwrap();
        let raw_image = store.import_edit_images(&raw.session_id, vec![source.to_string_lossy().into_owned()]).unwrap().remove(0);
        let mut raw_request = create_request(&raw);
        add_image(&mut raw_request, &raw_image);
        let legacy = store.commit_edit(raw_request).unwrap();
        let session = store.begin_create(payload(kind)).unwrap();
        let imported = store.import_edit_images(&session.session_id, vec![source.to_string_lossy().into_owned()]).unwrap().remove(0);
        assert_eq!((imported.width, imported.height), (3, 2));
        assert_eq!((imported.display_width, imported.display_height), (Some(2), Some(3)));
        assert_eq!(imported.presentation_axes, Some(PresentationAxes::Exif));
        let mut request = create_request(&session); request.payload.version = 2;
        add_image(&mut request, &imported);
        let visual = &mut images_mut(&mut request.payload)[0];
        visual["presentationAxes"] = json!("exif");
        visual["sourceWidth"] = json!(2); visual["sourceHeight"] = json!(3);
        visual["aspectRatio"] = json!(2.0 / 3.0); visual["frameWidth"] = json!(100); visual["frameHeight"] = json!(150);
        let saved = store.commit_edit(request.clone()).unwrap();
        assert_eq!(store.commit_edit(request).unwrap(), saved, "exact retry");
        assert_eq!((saved.images[0].width, saved.images[0].height), (3, 2));
        assert_eq!(saved.images[0].blob_id, hash);
        assert_ne!(saved.images[0].storage_id, legacy.images[0].storage_id);
        drop(store);
        let store = fixture.store();
        assert_eq!(store.get(&saved.summary.id).unwrap(), saved);
        for (material, expected_axes, dimensions) in [(&legacy, None, (3, 2)), (&saved, Some(PresentationAxes::Exif), (2, 3))] {
            let url = store.load_image(&material.summary.id, 1, &material.images[0].local_image_id).unwrap();
            let pixels = image::load_from_memory(&base64::engine::general_purpose::STANDARD.decode(url.split_once(',').unwrap().1).unwrap()).unwrap();
            assert_eq!((pixels.width(), pixels.height()), dimensions, "{kind}");
            let target = store.begin_create(payload("imageGroup")).unwrap();
            let reused = store.import_library_images(&target.session_id, &material.summary.id, 1, vec![material.images[0].local_image_id.clone()]).unwrap().remove(0);
            assert_eq!(reused.presentation_axes, expected_axes);
            assert_eq!((reused.display_width.unwrap(), reused.display_height.unwrap()), dimensions);
            assert_eq!((reused.width, reused.height), (3, 2));
            store.discard_edit(&target.session_id).unwrap();
        }
        let cropped = store.crop_edit_image_with_axes(&session.session_id, &imported.local_image_id, MaterialEditCropBounds { x: 0, y: 1, width: 2, height: 2 }, PresentationAxes::Exif).unwrap();
        assert_eq!((cropped.width, cropped.height), (2, 2));
        assert_eq!(cropped.presentation_axes, None, "crop raster no longer contains orientation metadata");
        assert_eq!(fs::read(store.verified_image_path(&saved.images[0]).unwrap()).unwrap(), bytes);
        assert_eq!(fs::read(&source).unwrap(), bytes);
    }
}

#[test]
fn buglist1_large_original_survives_create_reopen_and_draft_reuse() {
    // A valid PNG with trailing bytes exercises encoded-file size independently
    // of pixel allocation. Real high-resolution fixtures are covered separately.
    let fixture = CreateFixture::new();
    let source = fixture.source();
    fs::OpenOptions::new().write(true).open(&source).unwrap()
        .set_len(257 * 1024 * 1024).unwrap();
    let mut store = fixture.store();
    let session = store.begin_create(payload("imageGroup")).unwrap();
    let imported = store.import_edit_images(&session.session_id, vec![source.to_string_lossy().into_owned()]).unwrap();
    assert_eq!(imported[0].byte_length, 257 * 1024 * 1024);
    assert!(imported[0].data_url.len() < 1024 * 1024, "IPC carries a display image, not the original");
    let mut request = create_request(&session);
    add_image(&mut request, &imported[0]);
    let saved = store.commit_edit(request).unwrap();
    let id = saved.summary.id.clone();
    assert_eq!(saved.images[0].byte_length, 257 * 1024 * 1024);
    drop(store);
    let store = fixture.store();
    assert_eq!(store.get(&id).unwrap(), saved);
    assert!(store.load_image(&id, 1, &saved.images[0].local_image_id).unwrap().len() < 1024 * 1024);
    let target = store.begin_create(payload("imageGroup")).unwrap();
    let copied = store.import_library_images(&target.session_id, &id, 1, vec![saved.images[0].local_image_id.clone()]).unwrap();
    assert_ne!(copied[0].local_image_id, saved.images[0].local_image_id);
    assert_eq!(copied[0].byte_length, saved.images[0].byte_length);
    store.discard_edit(&target.session_id).unwrap();
}

#[test]
#[ignore = "Generate scripts/generate-large-image-fixtures.py and set PRESHOT_LARGE_IMAGE_FIXTURES"]
fn buglist1_real_large_images_create_reuse_project_and_derivatives() {
    let root = PathBuf::from(std::env::var("PRESHOT_LARGE_IMAGE_FIXTURES").unwrap());
    let png = root.join("original-10000x10000.png");
    let jpeg = root.join("original-8000x8000.jpg");
    assert!(fs::metadata(&png).unwrap().len() > 256 * 1024 * 1024);
    assert!(fs::metadata(&jpeg).unwrap().len() > 64 * 1024 * 1024);
    let mut fixture = Fixture::new("imageGroup");
    fixture.plan["schemaVersion"] = json!(17);
    fixture.plan["document"]["version"] = json!(5);
    fixture.write_plan(&fixture.plan);
    let mut store = fixture.store();
    let session = store.begin_create(payload("imageGroup")).unwrap();
    let images = store.import_edit_images(&session.session_id,
        [&png, &png, &jpeg].into_iter().map(|path| path.to_string_lossy().into_owned()).collect()).unwrap();
    assert!(images.iter().map(|image| image.byte_length).sum::<u64>() > 512 * 1024 * 1024);
    assert!(images.iter().all(|image| image.preview_error.is_none() && image.data_url.len() < 24 * 1024 * 1024));
    let mut request = create_request(&session);
    for image in &images { add_image(&mut request, image); }
    let saved = store.commit_edit(request).unwrap();
    store.discard_edit(&session.session_id).unwrap();
    drop(store);
    let mut store = fixture.store();
    assert_eq!(store.get(&saved.summary.id).unwrap(), saved);
    let target = store.begin_create(payload("imageGroup")).unwrap();
    let reused = store.import_library_images(&target.session_id, &saved.summary.id, 1,
        saved.images.iter().map(|image| image.local_image_id.clone()).collect()).unwrap();
    let mut request = create_request(&target);
    for image in &reused { add_image(&mut request, image); }
    let copied = store.commit_edit(request).unwrap();
    store.discard_edit(&target.session_id).unwrap();
    for (source, target) in saved.images.iter().zip(&copied.images) {
        assert_eq!(source.blob_id, target.blob_id);
        assert_ne!(source.storage_id, target.storage_id);
        store.verified_image_path(target).unwrap();
    }
    let prepared = store.prepare_insert(fixture.insert_request(&copied)).unwrap();
    let next = fixture.next_plan(&prepared);
    insert::commit(MaterialInsertCommit {
        operation_id: prepared.operation_id, project_id: fixture.save_request().project_id,
        project_path: fixture.project.to_string_lossy().into_owned(), expected_plan: fixture.plan.clone(), next_plan: next,
    }).unwrap();
    for (source, image) in prepared.images.iter().zip(&copied.images) {
        let path = fixture.project.join(&source.file);
        crate::original_image::verify(&path, image.byte_length, &image.blob_id).unwrap();
        let display = crate::plan::load_reference_image_from(&fixture.project, &source.file).unwrap();
        assert!(display.len() < 24 * 1024 * 1024);
        let export = crate::original_image::display_url(&path, 3072).unwrap();
        assert!(export.len() < 48 * 1024 * 1024);
    }
    assert_eq!(crate::original_image::fingerprint(&png).unwrap().1, saved.images[0].blob_id);
    assert_eq!(crate::original_image::fingerprint(&jpeg).unwrap().1, saved.images[2].blob_id);
}

fn count(store: &Store, table: &str) -> i64 {
    store
        .conn
        .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .unwrap()
}

fn assert_unpublished(store: &Store) {
    for table in [
        "materials",
        "material_images",
        "material_search",
        "save_receipts",
        "edit_receipts",
        "material_asset_owners",
        "blobs",
    ] {
        assert_eq!(count(store, table), 0, "{table}");
    }
    assert_eq!(store.search(query("")).unwrap().total, 0);
}

fn verify_large_jpeg_lifecycle(bytes: Vec<u8>) {
    assert!(bytes.len() > 16 * 1024 * 1024);
    verify_original_image_lifecycle(bytes);
}

fn verify_original_image_lifecycle(bytes: Vec<u8>) {
    let fixture = Fixture::new("imageGroup");
    let source = fixture.project.join("camera.jpg");
    fs::write(&source, &bytes).unwrap();
    let mut store = fixture.store();
    let session = store.begin_create(payload("image")).unwrap();
    let staged = store.import_edit_images(&session.session_id, vec![source.to_str().unwrap().into()])
        .unwrap().remove(0);
    assert_eq!(staged.byte_length, bytes.len() as u64);
    let mut request = create_request(&session);
    add_image(&mut request, &staged);
    images_mut(&mut request.payload)[0]["frameWidth"] = json!(150.0);
    images_mut(&mut request.payload)[0]["frameHeight"] = json!(150.0 * staged.height as f64 / staged.width as f64);
    let saved = store.commit_edit(request).unwrap();
    store.discard_edit(&session.session_id).unwrap();
    drop(store);
    let store = fixture.store();
    assert_eq!(store.get(&saved.summary.id).unwrap(), saved);
    assert_eq!(store.blob(&saved.images[0]).unwrap(), bytes);
    let edit = store.begin_edit(&saved.summary.id, 1).unwrap();
    assert_eq!(store.load_edit_image(&edit.session_id, &staged.local_image_id).unwrap(), staged.data_url);
    store.discard_edit(&edit.session_id).unwrap();
    let prepared = store.prepare_insert(fixture.insert_request(&saved)).unwrap();
    let next = fixture.next_plan(&prepared);
    let input = fixture.insert_request(&saved);
    insert::commit(MaterialInsertCommit {
        operation_id: prepared.operation_id,
        project_id: input.project_id,
        project_path: input.project_path,
        expected_plan: fixture.plan.clone(), next_plan: next,
    }).unwrap();
    assert_eq!(fs::read(fixture.project.join(&prepared.images[0].file)).unwrap(), bytes);
    assert_eq!(fs::read(&source).unwrap(), bytes);
}

#[test]
fn library_unrestricted_resolution_import_save_reopen_insert_and_crop() {
    let mut encoded = Cursor::new(Vec::new());
    DynamicImage::new_rgb8(20000, 2).write_to(&mut encoded, ImageFormat::Jpeg).unwrap();
    let bytes = encoded.into_inner();
    verify_original_image_lifecycle(bytes.clone());

    let fixture = CreateFixture::new();
    let store = fixture.store();
    let session = store.begin_create(payload("image")).unwrap();
    let staged = store.import_edit_image_data(&session.session_id, MaterialEditImageData {
        name: "wide.jpg".into(), mime_type: "image/jpeg".into(), bytes: bytes.clone(),
    }).unwrap();
    let cropped = store.crop_edit_image(&session.session_id, &staged.local_image_id,
        MaterialEditCropBounds { x: 100, y: 0, width: 19000, height: 2 }).unwrap();
    assert_eq!((cropped.width, cropped.height), (19000, 2));
    assert_eq!(store.load_edit_image(&session.session_id, &staged.local_image_id).unwrap(), staged.data_url);
    let visual = json!({
        "localImageId":"wide", "aspectRatio":10000.0, "frameWidth":19000,"frameHeight":2,
        "fitMode":"stretch", "crop":{"x":0.0,"y":0.0,"width":1.0,"height":1.0},
    });
    let rendered = image_material::insertion_bytes(&bytes, &visual).unwrap();
    assert_eq!(files::image_info(&rendered, false).unwrap(), ("image/png", 19000, 2));
}

#[test]
fn library_unrestricted_resolution_above_32_million_pixels() {
    let mut encoded = Cursor::new(Vec::new());
    DynamicImage::new_luma8(6000, 6000).write_to(&mut encoded, ImageFormat::Png).unwrap();
    assert_eq!(files::image_info(encoded.get_ref(), false).unwrap(), ("image/png", 6000, 6000));
}

#[test]
fn library_large_jpeg_import_save_reopen_and_insert_preserve_original_bytes() {
    verify_large_jpeg_lifecycle(large_jpeg_bytes());
}

fn large_jpeg_bytes() -> Vec<u8> {
    let mut jpeg = Cursor::new(Vec::new());
    DynamicImage::new_rgb8(3, 2).write_to(&mut jpeg, ImageFormat::Jpeg).unwrap();
    // Valid JPEG comment segments exceed the old file cap without expensive pixel fixtures.
    let mut bytes = vec![0xff, 0xd8];
    for _ in 0..272 {
        bytes.extend_from_slice(&[0xff, 0xfe, 0xff, 0xff]);
        bytes.resize(bytes.len() + 65533, b'x');
    }
    bytes.extend_from_slice(&jpeg.get_ref()[2..]);
    bytes
}

#[test]
fn library_large_jpeg_can_render_a_changed_frame_for_native_image_insertion() {
    let bytes = large_jpeg_bytes();
    let visual = json!({
        "localImageId":"camera", "aspectRatio":1.5, "frameWidth":100,"frameHeight":100,
        "fitMode":"cover", "crop":{"x":0.0,"y":0.0,"width":1.0,"height":1.0},
    });
    let rendered = image_material::insertion_bytes(&bytes, &visual).unwrap();
    assert_eq!(files::image_info(&rendered, false).unwrap(), ("image/png", 2, 2));
}

#[test]
#[ignore = "requires PRESHOT_LARGE_JPEG_FIXTURE; source is read-only and all app state is temporary"]
fn library_large_camera_jpeg_fixture_lifecycle() {
    let source = std::env::var("PRESHOT_LARGE_JPEG_FIXTURE").expect("set the camera JPEG fixture path");
    verify_large_jpeg_lifecycle(fs::read(source).unwrap());
}

#[test]
fn image_creation_requires_one_image_and_keeps_kind_through_editing() {
    let fixture = CreateFixture::new();
    let mut store = fixture.store();
    let session = store.begin_create(payload("image")).unwrap();
    assert!(store.commit_edit(create_request(&session)).is_err());
    assert_unpublished(&store);
    let images = store.import_edit_images(&session.session_id, vec![fixture.source().to_string_lossy().into_owned()]).unwrap();
    let mut input = create_request(&session);
    add_image(&mut input, &images[0]);
    let mut two = input.clone();
    let mut second = images_mut(&mut two.payload)[0].clone();
    second["localImageId"] = json!("another");
    images_mut(&mut two.payload).push(second);
    assert!(store.commit_edit(two).is_err());
    let saved = store.commit_edit(input).unwrap();
    assert_eq!(saved.summary.kind, MaterialKind::Image);
    let editing = store.begin_edit(&saved.summary.id, 1).unwrap();
    let mut input = update(&editing);
    input.payload.component["description"] = json!("午后光影");
    let edited = store.commit_edit(input).unwrap();
    assert_eq!(edited.summary.kind, MaterialKind::Image);
    assert_eq!(edited.images, saved.images);
    assert_eq!(store.search(query("午后光影")).unwrap().total, 1);
}

#[test]
fn library_create_all_kinds_publish_only_on_first_atomic_save_without_a_project() {
    for kind in [
        "imageGroup",
        "shootingLocation",
        "modelCard",
        "prop",
        "clothing",
    ] {
        let fixture = CreateFixture::new();
        let mut store = fixture.store();
        let original = payload(kind);
        let session = store.begin_create(original.clone()).unwrap();
        let wire = serde_json::to_value(&session).unwrap();
        assert_eq!(wire["isNew"], true);
        assert_eq!(session.material.summary.revision, 0);
        assert_eq!(session.material.summary.metadata_version, 0);
        assert_eq!(session.material.summary.metadata.name, "");
        assert_eq!(session.material.summary.metadata.description, "");
        assert!(session.material.summary.metadata.tags.is_empty());
        assert!(!session.material.summary.metadata.favorite);
        assert_eq!(session.material.summary.deleted_at, None);
        assert_eq!(
            session.material.summary.preview_state,
            PreviewState::Pending
        );
        assert_eq!(session.material.summary.image_count, 0);
        assert_eq!(session.material.summary.byte_length, 0);
        assert!(session.material.images.is_empty());
        assert_eq!(session.material.payload, original);
        files::uuid(&session.session_id).unwrap();
        files::uuid(&session.material.summary.id).unwrap();
        assert_eq!(
            store.get(&session.material.summary.id).unwrap_err().code,
            "library_not_found"
        );
        assert_unpublished(&store);
        let manifest: Value = serde_json::from_slice(
            &fs::read(draft_path(&store, &session).join("manifest.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(manifest["version"], 2);
        let saved = store.commit_edit(create_request(&session)).unwrap();
        assert_eq!(saved.summary.id, session.material.summary.id);
        assert_eq!(saved.summary.kind, session.material.summary.kind);
        assert_eq!(saved.summary.revision, 1);
        assert_eq!(saved.summary.metadata_version, 1);
        assert_eq!(saved.summary.metadata.name, "新建素材");
        assert_eq!(saved.payload, original);
        assert_eq!(store.get(&saved.summary.id).unwrap(), saved);
        assert_eq!(store.search(query("新建素材")).unwrap().total, 1);
        assert_eq!(count(&store, "edit_receipts"), 1);
        assert_eq!(count(&store, "save_receipts"), 0);
        assert!(!fixture.root.path().join("project").exists());
    }
}

#[test]
fn library_create_rejects_nonempty_or_malformed_payload_before_allocating_a_draft() {
    let fixture = CreateFixture::new();
    let store = fixture.store();
    let mut with_image = payload("prop");
    images_mut(&mut with_image).push(json!({
        "localImageId":"foreign","aspectRatio":1,"frameWidth":100,"frameHeight":100
    }));
    assert_eq!(
        store.begin_create(with_image).unwrap_err().code,
        "library_payload"
    );
    let mut malformed = payload("prop");
    malformed.component["gallery"]["file"] = json!("external.png");
    assert_eq!(
        store.begin_create(malformed).unwrap_err().code,
        "library_validation"
    );
    let mut malformed = payload("prop");
    malformed.version = 3;
    assert_eq!(
        store.begin_create(malformed).unwrap_err().code,
        "library_payload"
    );
    let mut malformed = payload("modelCard");
    malformed.component["modelId"] = json!("");
    assert_eq!(
        store.begin_create(malformed).unwrap_err().code,
        "library_validation"
    );
    let mut malformed = payload("prop");
    malformed.component["source"] = json!("x".repeat(200_001));
    assert_eq!(
        store.begin_create(malformed).unwrap_err().code,
        "library_validation"
    );
    assert_eq!(fs::read_dir(store.root.join("drafts")).unwrap().count(), 0);
    assert_unpublished(&store);
}

#[test]
fn library_create_requires_valid_metadata_at_version_zero_and_the_original_kind() {
    let fixture = CreateFixture::new();
    let mut store = fixture.store();
    let session = store.begin_create(payload("prop")).unwrap();
    assert_eq!(
        store.commit_edit(update(&session)).unwrap_err().code,
        "library_metadata"
    );
    let mut wrong_version = create_request(&session);
    wrong_version
        .metadata_update
        .as_mut()
        .unwrap()
        .expected_version = 1;
    assert_eq!(
        store.commit_edit(wrong_version).unwrap_err().code,
        "library_metadata_conflict"
    );
    let mut blank = create_request(&session);
    blank.metadata_update.as_mut().unwrap().metadata.name = " ".into();
    assert_eq!(
        store.commit_edit(blank).unwrap_err().code,
        "library_validation"
    );
    let mut malformed = create_request(&session);
    malformed.metadata_update.as_mut().unwrap().metadata.tags = vec!["tag".into(); 13];
    assert_eq!(
        store.commit_edit(malformed).unwrap_err().code,
        "library_metadata"
    );
    let mut wrong_kind = create_request(&session);
    wrong_kind.payload = payload("clothing");
    assert_eq!(
        store.commit_edit(wrong_kind).unwrap_err().code,
        "library_kind"
    );
    let mut foreign = create_request(&session);
    images_mut(&mut foreign.payload).push(json!({
        "localImageId":"foreign","aspectRatio":1,"frameWidth":100,"frameHeight":100
    }));
    assert_eq!(
        store.commit_edit(foreign).unwrap_err().code,
        "library_image_not_found"
    );
    assert_unpublished(&store);
}

#[test]
fn library_create_import_crop_cancel_only_touch_owned_draft_files() {
    let fixture = CreateFixture::new();
    let mut store = fixture.store();
    let session = store.begin_create(payload("imageGroup")).unwrap();
    let source = fixture.source();
    let bytes = fs::read(&source).unwrap();
    let staged = store
        .import_edit_images(&session.session_id, vec![source.to_str().unwrap().into()])
        .unwrap()
        .remove(0);
    let cropped = store
        .crop_edit_image(
            &session.session_id,
            &staged.local_image_id,
            MaterialEditCropBounds {
                x: 1,
                y: 0,
                width: 1,
                height: 2,
            },
        )
        .unwrap();
    assert_ne!(staged.local_image_id, cropped.local_image_id);
    assert_ne!(staged.data_url, cropped.data_url);
    assert_eq!(
        store
            .load_edit_image(&session.session_id, &staged.local_image_id)
            .unwrap(),
        staged.data_url
    );
    let mut request = create_request(&session);
    add_image(&mut request, &cropped);
    assert_unpublished(&store);
    store.discard_edit(&session.session_id).unwrap();
    store.discard_edit(&session.session_id).unwrap();
    assert_eq!(fs::read(&source).unwrap(), bytes);
    assert!(!draft_path(&store, &session).exists());
    assert_eq!(
        store.commit_edit(request).unwrap_err().code,
        "library_edit_not_found"
    );
    assert_unpublished(&store);
}

#[test]
fn library_create_first_save_owns_images_and_continued_saves_use_fresh_existing_edit_drafts() {
    let fixture = CreateFixture::new();
    let mut store = fixture.store();
    let session = store.begin_create(payload("prop")).unwrap();
    let source = fixture.source();
    let staged = store
        .import_edit_images(&session.session_id, vec![source.to_str().unwrap().into()])
        .unwrap()
        .remove(0);
    let cropped = store
        .crop_edit_image(
            &session.session_id,
            &staged.local_image_id,
            MaterialEditCropBounds {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
            },
        )
        .unwrap();
    fs::remove_file(&source).unwrap();
    let mut request = create_request(&session);
    add_image(&mut request, &staged);
    add_image(&mut request, &cropped);
    let saved = store.commit_edit(request.clone()).unwrap();
    assert_eq!(saved.images.len(), 2);
    assert_eq!(saved.summary.revision, 1);
    assert_eq!(saved.summary.metadata_version, 1);
    assert_eq!(
        store
            .load_image(&saved.summary.id, 1, &staged.local_image_id)
            .unwrap(),
        staged.data_url
    );
    store.discard_edit(&session.session_id).unwrap();
    let edit = store.begin_edit(&saved.summary.id, 1).unwrap();
    assert!(serde_json::to_value(&edit).unwrap().get("isNew").is_none());
    let mut continued = create_request(&edit);
    continued.metadata_update.as_mut().unwrap().expected_version = 1;
    continued.metadata_update.as_mut().unwrap().metadata.name = "继续保存".into();
    continued.payload.component["source"] = json!("新内容");
    let latest = store.commit_edit(continued).unwrap();
    assert_eq!(latest.summary.id, saved.summary.id);
    assert_eq!(latest.summary.revision, 2);
    assert_eq!(latest.summary.metadata_version, 2);
    assert_eq!(latest.images, saved.images);
    store.discard_edit(&edit.session_id).unwrap();
    assert_eq!(store.commit_edit(request).unwrap(), saved);
    assert_eq!(store.get(&latest.summary.id).unwrap(), latest);
    assert_eq!(count(&store, "materials"), 1);
    assert!(!source.exists());
}

#[test]
fn library_create_receipt_is_exact_and_a_different_operation_cannot_overwrite_the_created_draft() {
    let fixture = CreateFixture::new();
    let mut store = fixture.store();
    let session = store.begin_create(payload("prop")).unwrap();
    let request = create_request(&session);
    let saved = store.commit_edit(request.clone()).unwrap();
    assert_eq!(store.commit_edit(request.clone()).unwrap(), saved);
    let mut different = request.clone();
    different.metadata_update.as_mut().unwrap().metadata.name = "changed".into();
    assert_eq!(
        store.commit_edit(different.clone()).unwrap_err().code,
        "library_operation_conflict"
    );
    different.operation_id = Uuid::new_v4().to_string();
    assert_eq!(
        store.commit_edit(different).unwrap_err().code,
        "library_create_conflict"
    );
    assert_eq!(store.get(&saved.summary.id).unwrap(), saved);
    assert_eq!(count(&store, "materials"), 1);
    assert_eq!(count(&store, "edit_receipts"), 1);
    store.discard_edit(&session.session_id).unwrap();
    drop(store);
    let mut store = fixture.store();
    assert_eq!(store.commit_edit(request).unwrap(), saved);
}

#[test]
fn library_create_database_rollback_keeps_retry_sources_but_no_partial_material_or_owners() {
    let fixture = CreateFixture::new();
    let mut store = fixture.store();
    let session = store.begin_create(payload("prop")).unwrap();
    let source = fixture.source();
    let staged = store
        .import_edit_images(&session.session_id, vec![source.to_str().unwrap().into()])
        .unwrap()
        .remove(0);
    let mut request = create_request(&session);
    add_image(&mut request, &staged);
    store
        .conn
        .execute_batch(
            "CREATE TRIGGER fail_create_receipt BEFORE INSERT ON edit_receipts
         BEGIN SELECT RAISE(ABORT,'sensitive creation transaction failure'); END;",
        )
        .unwrap();
    let error = store.commit_edit(request.clone()).unwrap_err();
    assert_eq!(error.code, "library_database");
    assert!(!error.message.contains("sensitive"));
    assert_unpublished(&store);
    assert_eq!(
        store
            .load_edit_image(&session.session_id, &staged.local_image_id)
            .unwrap(),
        staged.data_url
    );
    store
        .conn
        .execute_batch("DROP TRIGGER fail_create_receipt;")
        .unwrap();
    drop(store);
    let mut store = fixture.store();
    let saved = store.commit_edit(request).unwrap();
    assert_eq!(saved.summary.revision, 1);
    assert_eq!(saved.summary.metadata_version, 1);
    assert_eq!(count(&store, "material_asset_owners"), 0);
    assert_eq!(count(&store, "material_instance_owners"), 1);
    assert_eq!(count(&store, "materials"), 1);
}

#[test]
fn library_create_duplicate_names_never_replace_an_existing_material() {
    let fixture = CreateFixture::new();
    let mut store = fixture.store();
    let first = store.begin_create(payload("prop")).unwrap();
    let saved_first = store.commit_edit(create_request(&first)).unwrap();
    store.discard_edit(&first.session_id).unwrap();
    let second = store.begin_create(payload("clothing")).unwrap();
    let saved_second = store.commit_edit(create_request(&second)).unwrap();
    assert_ne!(saved_first.summary.id, saved_second.summary.id);
    assert_eq!(
        saved_first.summary.metadata.name,
        saved_second.summary.metadata.name
    );
    assert_eq!(saved_first.summary.revision, 1);
    assert_eq!(saved_second.summary.revision, 1);
    assert_eq!(store.get(&saved_first.summary.id).unwrap(), saved_first);
    assert_eq!(count(&store, "materials"), 2);
    assert_eq!(
        store
            .search(
                serde_json::from_value(json!({
                    "query":"","exactName":"新建素材","sort":"recent","offset":0,"limit":20,
                }))
                .unwrap()
            )
            .unwrap()
            .total,
        2
    );
}

#[test]
fn library_create_purge_blocks_retained_creation_drafts_and_never_replays_purged_creations() {
    let fixture = CreateFixture::new();
    let mut store = fixture.store();
    let session = store.begin_create(payload("prop")).unwrap();
    let manifest = fs::read(draft_path(&store, &session).join("manifest.json")).unwrap();
    let request = create_request(&session);
    let saved = store.commit_edit(request.clone()).unwrap();
    let deleted = store.set_deleted(&saved.summary.id, 1, true).unwrap();
    assert_eq!(
        store
            .purge(&saved.summary.id, deleted.metadata_version)
            .unwrap_err()
            .code,
        "library_purge_in_use"
    );
    store.discard_edit(&session.session_id).unwrap();
    store
        .purge(&saved.summary.id, deleted.metadata_version)
        .unwrap();
    drop(store);
    let mut store = fixture.store();
    assert_eq!(
        store.commit_edit(request.clone()).unwrap_err().code,
        "library_purged"
    );
    let mut changed = request.clone();
    changed.metadata_update.as_mut().unwrap().metadata.name = "different intent".into();
    assert_eq!(
        store.commit_edit(changed).unwrap_err().code,
        "library_operation_conflict"
    );
    // A recovered pre-save draft must not recreate its purged UUID under a new operation.
    let directory = draft_path(&store, &session);
    fs::create_dir(&directory).unwrap();
    fs::write(directory.join("manifest.json"), manifest).unwrap();
    let mut different_operation = request;
    different_operation.operation_id = Uuid::new_v4().to_string();
    assert_eq!(
        store.commit_edit(different_operation).unwrap_err().code,
        "library_purged"
    );
    assert_eq!(count(&store, "materials"), 0);
    assert_eq!(count(&store, "edit_receipts"), 0);
    store.discard_edit(&session.session_id).unwrap();
}

#[test]
fn library_create_staged_instances_survive_an_equal_hash_material_purge() {
    let fixture = CreateFixture::new();
    let mut store = fixture.store();
    let source = fixture.source();
    let first = store.begin_create(payload("prop")).unwrap();
    let first_image = store
        .import_edit_images(&first.session_id, vec![source.to_str().unwrap().into()])
        .unwrap()
        .remove(0);
    let mut first_request = create_request(&first);
    add_image(&mut first_request, &first_image);
    let saved = store.commit_edit(first_request).unwrap();
    store.discard_edit(&first.session_id).unwrap();
    let object = store.instance_path(saved.images[0].storage_id.as_deref().unwrap(), "image/png").unwrap();
    let second = store.begin_create(payload("imageGroup")).unwrap();
    let second_image = store
        .import_edit_images(&second.session_id, vec![source.to_str().unwrap().into()])
        .unwrap()
        .remove(0);
    let deleted = store.set_deleted(&saved.summary.id, 1, true).unwrap();
    store
        .purge(&saved.summary.id, deleted.metadata_version)
        .unwrap();
    assert!(
        !object.exists(),
        "Independent creation staging must not retain another material's equal-hash instance"
    );
    let mut request = create_request(&second);
    add_image(&mut request, &second_image);
    let created = store.commit_edit(request).unwrap();
    assert_eq!(created.images[0].blob_id, saved.images[0].blob_id);
    assert_ne!(created.images[0].storage_id, saved.images[0].storage_id);
    assert_eq!(
        store.blob(&created.images[0]).unwrap(),
        fs::read(source).unwrap()
    );
    assert_eq!(count(&store, "materials"), 1);
}

#[test]
fn library_create_v2_snapshots_are_explicitly_provisional_and_old_v1_drafts_remain_readable() {
    let fixture = CreateFixture::new();
    let mut store = fixture.store();
    let session = store.begin_create(payload("prop")).unwrap();
    let source = fixture.source();
    let staged = store
        .import_edit_images(&session.session_id, vec![source.to_str().unwrap().into()])
        .unwrap()
        .remove(0);
    let path = draft_path(&store, &session).join("manifest.json");
    let original: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    for (field, value) in [
        ("revision", json!(1)),
        ("metadataVersion", json!(1)),
        ("name", json!("not a provisional name")),
        ("favorite", json!(true)),
        ("deletedAt", json!(123)),
        ("imageCount", json!(1)),
        ("previewState", json!("ready")),
    ] {
        let mut corrupt = original.clone();
        corrupt["material"][field] = value;
        fs::write(&path, serde_json::to_vec(&corrupt).unwrap()).unwrap();
        assert_eq!(
            store
                .load_edit_image(&session.session_id, &staged.local_image_id)
                .unwrap_err()
                .code,
            "library_edit_corrupt",
            "{field}"
        );
    }
    for version in [0, 1, 3] {
        let mut corrupt = original.clone();
        corrupt["version"] = json!(version);
        fs::write(&path, serde_json::to_vec(&corrupt).unwrap()).unwrap();
        assert_eq!(
            store
                .load_edit_image(&session.session_id, &staged.local_image_id)
                .unwrap_err()
                .code,
            "library_edit_corrupt"
        );
    }
    fs::write(&path, serde_json::to_vec(&original).unwrap()).unwrap();
    let mut request = create_request(&session);
    add_image(&mut request, &staged);
    let saved = store.commit_edit(request).unwrap();
    store.discard_edit(&session.session_id).unwrap();
    let edit = store.begin_edit(&saved.summary.id, 1).unwrap();
    let manifest: Value =
        serde_json::from_slice(&fs::read(draft_path(&store, &edit).join("manifest.json")).unwrap())
            .unwrap();
    assert_eq!(manifest["version"], 1);
    let legacy_wire = json!({"sessionId":edit.session_id,"material":edit.material});
    let parsed: MaterialEditSession = serde_json::from_value(legacy_wire).unwrap();
    assert_eq!(parsed.is_new, None);
    drop(store);
    let mut store = fixture.store();
    assert_eq!(
        store
            .load_edit_image(&edit.session_id, &staged.local_image_id)
            .unwrap(),
        staged.data_url
    );
    let next = store.commit_edit(update(&edit)).unwrap();
    assert_eq!(next.summary.revision, 2);
    assert_eq!(next.summary.metadata_version, 1);
}

#[test]
fn library_create_only_discloses_its_own_completed_staging_and_recovers_interrupted_imports() {
    let fixture = CreateFixture::new();
    let mut store = fixture.store();
    let session = store.begin_create(payload("prop")).unwrap();
    let other = store.begin_create(payload("prop")).unwrap();
    let source = fixture.source();
    let foreign = store
        .import_edit_images(&other.session_id, vec![source.to_str().unwrap().into()])
        .unwrap()
        .remove(0);
    let mut request = create_request(&session);
    add_image(&mut request, &foreign);
    assert_eq!(
        store.commit_edit(request).unwrap_err().code,
        "library_image_not_found"
    );
    let own = store
        .import_edit_images(&session.session_id, vec![source.to_str().unwrap().into()])
        .unwrap()
        .remove(0);
    let path = draft_path(&store, &session).join("manifest.json");
    let mut manifest: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    manifest["pending"] = manifest["staged"].take();
    manifest["staged"] = json!([]);
    fs::write(path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    let mut request = create_request(&session);
    add_image(&mut request, &own);
    assert_eq!(
        store.commit_edit(request).unwrap_err().code,
        "library_image_not_found"
    );
    assert_unpublished(&store);
    let fresh = store
        .import_edit_images(&session.session_id, vec![source.to_str().unwrap().into()])
        .unwrap()
        .remove(0);
    assert_ne!(own.local_image_id, fresh.local_image_id);
    assert!(!draft_path(&store, &session)
        .join(format!("{}.png", own.local_image_id))
        .exists());
    let mut request = create_request(&session);
    add_image(&mut request, &fresh);
    let saved = store.commit_edit(request).unwrap();
    assert_eq!(saved.images.len(), 1);
}

#[test]
fn library_create_respects_encoded_crop_payload_and_session_image_caps() {
    let fixture = CreateFixture::new();
    let mut store = fixture.store();
    let session = store.begin_create(payload("prop")).unwrap();
    let source = fixture.source();
    let staged = store
        .import_edit_images(&session.session_id, vec![source.to_str().unwrap().into()])
        .unwrap()
        .remove(0);
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
            x: 0,
            y: 0,
            width: 4,
            height: 1,
        },
    ] {
        assert_eq!(
            store
                .crop_edit_image(&session.session_id, &staged.local_image_id, bounds)
                .unwrap_err()
                .code,
            "library_crop_bounds"
        );
    }
    let mut request = create_request(&session);
    for _ in 0..129 {
        add_image(&mut request, &staged);
    }
    assert_eq!(
        store.commit_edit(request).unwrap_err().code,
        "library_payload"
    );
    assert_eq!(
        store
            .import_edit_images(
                &session.session_id,
                vec![source.to_str().unwrap().into(); 129]
            )
            .unwrap_err()
            .code,
        "library_edit_limit"
    );
    let oversized = fixture.root.path().join("oversized.png");
    fs::File::create(&oversized)
        .unwrap()
        .set_len(files::MAX_IMAGE_BYTES as u64 + 1)
        .unwrap();
    assert_eq!(
        store
            .import_edit_images(
                &session.session_id,
                vec![oversized.to_str().unwrap().into()]
            )
            .unwrap_err()
            .code,
        "original_image"
    );
    let wide = fixture.root.path().join("wide.png");
    let mut encoded = Cursor::new(Vec::new());
    DynamicImage::new_rgb8(8193, 1)
        .write_to(&mut encoded, ImageFormat::Png)
        .unwrap();
    fs::write(&wide, encoded.into_inner()).unwrap();
    let wide_session = store.begin_create(payload("image")).unwrap();
    assert_eq!(
        store
            .import_edit_images(&wide_session.session_id, vec![wide.to_str().unwrap().into()])
            .unwrap()[0].width,
        8193
    );
    store.discard_edit(&wide_session.session_id).unwrap();
    let path = draft_path(&store, &session).join("manifest.json");
    let mut manifest: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    let mut recorded = manifest["staged"][0].clone();
    let retained: Vec<_> = (0..512)
        .map(|_| {
            recorded["localImageId"] = json!(Uuid::new_v4().to_string());
            recorded["storageId"] = json!(Uuid::new_v4().to_string());
            recorded.clone()
        })
        .collect();
    let original_stage =
        draft_path(&store, &session).join(format!("{}.png", staged.local_image_id));
    fs::remove_file(original_stage).unwrap();
    manifest["staged"] = json!(retained);
    fs::write(path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    assert_eq!(
        store
            .import_edit_images(&session.session_id, vec![source.to_str().unwrap().into()])
            .unwrap_err()
            .code,
        "library_edit_limit"
    );
    assert_unpublished(&store);
    store.discard_edit(&session.session_id).unwrap();
}

#[test]
fn library_create_jpeg_sources_are_independent_and_crops_remain_session_owned() {
    let fixture = CreateFixture::new();
    let mut store = fixture.store();
    let session = store.begin_create(payload("clothing")).unwrap();
    let source = fixture.root.path().join("selected.jpg");
    let mut encoded = Cursor::new(Vec::new());
    DynamicImage::new_rgb8(3, 2)
        .write_to(&mut encoded, ImageFormat::Jpeg)
        .unwrap();
    let bytes = encoded.into_inner();
    fs::write(&source, &bytes).unwrap();
    let staged = store
        .import_edit_images(&session.session_id, vec![source.to_str().unwrap().into()])
        .unwrap()
        .remove(0);
    assert_eq!(staged.mime_type, "image/jpeg");
    let crop = store
        .crop_edit_image(
            &session.session_id,
            &staged.local_image_id,
            MaterialEditCropBounds {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
            },
        )
        .unwrap();
    assert_eq!(crop.mime_type, "image/jpeg");
    let mut request = create_request(&session);
    add_image(&mut request, &crop);
    let saved = store.commit_edit(request).unwrap();
    store.discard_edit(&session.session_id).unwrap();
    assert_eq!(fs::read(&source).unwrap(), bytes);
    assert_eq!(
        store
            .load_image(&saved.summary.id, 1, &crop.local_image_id)
            .unwrap(),
        crop.data_url
    );
}
