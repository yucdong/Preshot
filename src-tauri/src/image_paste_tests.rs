use super::*;
use image::{DynamicImage, ImageFormat};
use serde_json::json;
use std::io::Cursor;

struct Fixture {
    _root: tempfile::TempDir,
    project: PathBuf,
    base: Value,
    image: PasteImage,
}

impl Fixture {
    fn new(kind: &str) -> Self {
        let root = tempfile::Builder::new()
            .prefix("image-paste-test-")
            .tempdir_in(".")
            .unwrap();
        let project = root.path().canonicalize().unwrap();
        let mut png = Cursor::new(Vec::new());
        DynamicImage::new_rgb8(3, 2)
            .write_to(&mut png, ImageFormat::Png)
            .unwrap();
        let sidecar = match kind {
            "imageGroup" => json!({"id":"group","type":"reference","name":"参考",
                "description":"","x":0,"width":1,"height":320,"images":[]}),
            "shootingLocation" => json!({"id":"artifact","kind":kind,"revision":0,
                "venueName":"外景","address":"","description":"",
                "gallery":{"id":"gallery","images":[]}}),
            "modelCard" => json!({"id":"artifact","kind":kind,"revision":0,
                "modelId":"模特","heightCm":null,"weightKg":null,"shoeSize":"",
                "samples":{"id":"gallery","images":[]}}),
            "clothing" => json!({"id":"artifact","kind":kind,"revision":0,
                "title":"服装","source":"","mainGallery":{"id":"gallery","images":[]},
                "tryOn":{"expanded":false,"gallery":{"id":"try-on","images":[]}}}),
            _ => json!({"id":"artifact","kind":"prop","revision":0,
                "title":"道具","source":"","gallery":{"id":"gallery","images":[]}}),
        };
        let group = kind == "imageGroup";
        let base = json!({"schemaVersion":15,"title":"粘贴测试",
            "document":{"format":"preshot-blocks","version":3,
                "blocks":[{"id":"anchor","type":kind,"props":
                    if group { json!({"groupId":"group"}) } else { json!({"artifactId":"artifact"}) },
                    "children":[]}]},
            "imageGroups":if group {vec![sidecar.clone()]} else {vec![]},
            "artifacts":if group {vec![]} else {vec![sidecar]}});
        let fixture = Self {
            _root: root,
            project,
            base,
            image: PasteImage {
                name: "照片.png".into(),
                mime_type: "image/png".into(),
                bytes: png.into_inner(),
            },
        };
        fixture.persist(&fixture.base);
        fixture
    }

    fn persist(&self, plan: &Value) {
        let manifest = json!({"schemaVersion":1,"id":"00000000-0000-4000-8000-000000000001","name":"粘贴测试",
            "createdAt":"2026-09-08T00:00:00Z","updatedAt":"2026-09-08T00:00:00Z",
            "plan":plan});
        fs::write(
            self.project.join(".preshotproj"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
    }

    fn prepare(&self, operation: &str, destination: Destination) -> PreparedImagePaste {
        prepare_in(
            &self.project,
            operation,
            self.base.clone(),
            destination,
            self.image.clone(),
        )
        .unwrap()
    }

    fn native_next(&self, prepared: &PreparedImagePaste) -> Value {
        let mut next = self.base.clone();
        next["document"]["blocks"]
            .as_array_mut()
            .unwrap()
            .push(json!({
            "id":uuid::Uuid::new_v4().to_string(),"type":"image","props":{
                "url":prepared.file,"name":prepared.name,"caption":"独立照片",
                "textAlignment":"center","backgroundColor":"default",
                "showPreview":true,"previewWidth":320},
            "children":[]}));
        next
    }

    fn gallery_next(&self, prepared: &PreparedImagePaste, pointer: &str) -> Value {
        let mut next = self.base.clone();
        next.pointer_mut(pointer)
            .unwrap()
            .as_array_mut()
            .unwrap()
            .push(json!({
            "id":uuid::Uuid::new_v4().to_string(),"file":prepared.file,
            "aspectRatio":1.5,"sourceWidth":3,"sourceHeight":2,
            "frameWidth":150,"frameHeight":100,"fitMode":"stretch",
            "crop":{"x":0,"y":0,"width":1,"height":1}}));
        if pointer.starts_with("/artifacts/") {
            next["artifacts"][0]["revision"] =
                json!(self.base["artifacts"][0]["revision"].as_u64().unwrap() + 1);
        }
        next
    }

    fn commit(&self, operation: &str, next: Value) -> Result<()> {
        commit_in(&self.project, operation, self.base.clone(), next)
    }
}

fn operation() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[test]
fn fresh_native_files_commit_retry_and_undo_retention() {
    let fixture = Fixture::new("imageGroup");
    let op = operation();
    let prepared = fixture.prepare(&op, Destination::Media);
    assert_eq!(fixture.prepare(&op, Destination::Media), prepared);
    assert_eq!(
        manifest(&fixture.project).unwrap().plan,
        Some(fixture.base.clone())
    );
    assert_eq!(
        fs::read(fixture.project.join(&prepared.file)).unwrap(),
        fixture.image.bytes
    );
    let next = fixture.native_next(&prepared);
    fixture.commit(&op, next.clone()).unwrap();
    fixture.commit(&op, next.clone()).unwrap();
    assert_eq!(
        status_in(&fixture.project, &op).unwrap().status,
        PasteStatus::Committed
    );
    assert!(abort_in(&fixture.project, &op).is_err());
    crate::plan::save_project_plan_in(&fixture.project, fixture.base.clone()).unwrap();
    crate::plan::remove_plan_media_from(&fixture.project, &prepared.file).unwrap();
    assert!(fixture.project.join(&prepared.file).is_file());
    fixture.commit(&op, next.clone()).unwrap();
    assert_eq!(
        manifest(&fixture.project).unwrap().plan,
        Some(fixture.base.clone())
    );
    crate::plan::save_project_plan_in(&fixture.project, next).unwrap();
    let second = prepare_in(
        &fixture.project,
        &operation(),
        manifest(&fixture.project).unwrap().plan.unwrap(),
        Destination::Media,
        fixture.image.clone(),
    )
    .unwrap();
    assert_ne!(second.file, prepared.file);
}

#[test]
fn all_existing_gallery_kinds_accept_one_image_and_retain_original_on_crop() {
    for (kind, pointer) in [
        ("imageGroup", "/imageGroups/0/images"),
        ("shootingLocation", "/artifacts/0/gallery/images"),
        ("modelCard", "/artifacts/0/samples/images"),
        ("prop", "/artifacts/0/gallery/images"),
        ("clothing", "/artifacts/0/mainGallery/images"),
        ("clothing", "/artifacts/0/tryOn/gallery/images"),
    ] {
        let fixture = Fixture::new(kind);
        let op = operation();
        let prepared = fixture.prepare(&op, Destination::References);
        let next = fixture.gallery_next(&prepared, pointer);
        fixture.commit(&op, next).unwrap();
        assert!(crate::plan::is_reference_image_retained_for_history(
            fixture.project.to_string_lossy().into_owned(),
            prepared.file.clone(),
        )
        .unwrap());
        let bounds = crate::plan::ReferenceCropBounds {
            x: 0,
            y: 0,
            width: 2,
            height: 2,
        };
        assert!(
            crate::plan::crop_reference_image_in(&fixture.project, &prepared.file, bounds).is_err()
        );
        let copied =
            crate::plan::copy_reference_image_crop_in(&fixture.project, &prepared.file, bounds)
                .unwrap();
        assert_ne!(copied.file, prepared.file);
        assert!(!crate::plan::is_reference_image_retained_for_history(
            fixture.project.to_string_lossy().into_owned(),
            copied.file.clone(),
        )
        .unwrap());
        assert_eq!(
            fs::read(fixture.project.join(&prepared.file)).unwrap(),
            fixture.image.bytes
        );
        crate::plan::save_project_plan_in(&fixture.project, fixture.base.clone()).unwrap();
        let disposition =
            crate::plan::remove_reference_image_from(&fixture.project, &prepared.file).unwrap();
        assert_eq!(
            disposition,
            crate::plan::ReferenceRemovalDisposition::RetainedForMaterialHistory
        );
        assert!(fixture.project.join(&prepared.file).is_file());
    }
}

#[test]
fn closed_native_delta_rejects_other_edits_and_reused_or_nested_ids() {
    let fixture = Fixture::new("imageGroup");
    let op = operation();
    let prepared = fixture.prepare(&op, Destination::Media);
    let valid = fixture.native_next(&prepared);
    let mut variants = Vec::new();
    let mut value = valid.clone();
    value["title"] = json!("changed");
    variants.push(value);
    let mut value = valid.clone();
    value["document"]["blocks"][0]["props"]["groupId"] = json!("other");
    variants.push(value);
    let mut value = valid.clone();
    value["document"]["blocks"][1]["id"] = json!("anchor");
    variants.push(value);
    let mut value = valid.clone();
    value["document"]["blocks"][1]["id"] = json!("group");
    variants.push(value);
    let mut value = valid.clone();
    value["document"]["blocks"][1]["props"]["url"] = json!("https://example.com/image.png");
    variants.push(value);
    let mut value = valid.clone();
    value["document"]["blocks"][1]["props"]["unexpected"] = json!(true);
    variants.push(value);
    let mut value = valid.clone();
    value["document"]["blocks"][1]["children"] =
        json!([{"id":"nested","type":"paragraph","props":{},"children":[]}]);
    variants.push(value);
    let mut value = valid.clone();
    let image = value["document"]["blocks"]
        .as_array_mut()
        .unwrap()
        .pop()
        .unwrap();
    value["document"]["blocks"][0]["children"] = json!([image]);
    variants.push(value);
    for invalid in variants {
        assert!(fixture.commit(&op, invalid).is_err());
        assert_eq!(
            manifest(&fixture.project).unwrap().plan,
            Some(fixture.base.clone())
        );
    }
    fixture.commit(&op, valid).unwrap();
}

#[test]
fn closed_gallery_delta_rejects_sidecar_edits_extra_images_and_unowned_galleries() {
    let fixture = Fixture::new("clothing");
    let op = operation();
    let prepared = fixture.prepare(&op, Destination::References);
    let valid = fixture.gallery_next(&prepared, "/artifacts/0/mainGallery/images");
    let mut variants = Vec::new();
    let mut value = valid.clone();
    value["artifacts"][0]["revision"] = json!(0);
    variants.push(value);
    let mut value = valid.clone();
    value["artifacts"][0]["revision"] = json!(2);
    variants.push(value);
    let mut value = valid.clone();
    value["artifacts"][0]["title"] = json!("changed");
    variants.push(value);
    let mut value = valid.clone();
    value["artifacts"][0]["mainGallery"]["images"][0]["id"] = json!("anchor");
    variants.push(value);
    let mut value = valid.clone();
    value["artifacts"][0]["mainGallery"]["images"][0]["file"] = json!("references/0000.png");
    variants.push(value);
    let mut value = valid.clone();
    value["artifacts"][0]["mainGallery"]["images"][0]["crop"]["width"] = json!(2);
    variants.push(value);
    let mut value = valid.clone();
    value["artifacts"][0]["tryOn"]["gallery"]["images"] =
        value["artifacts"][0]["mainGallery"]["images"].clone();
    variants.push(value);
    for invalid in variants {
        assert!(fixture.commit(&op, invalid).is_err());
    }
    fixture.commit(&op, valid).unwrap();
}

#[test]
fn source_validation_and_operation_intent_are_independent_of_the_renderer() {
    let fixture = Fixture::new("imageGroup");
    for image in [
        PasteImage {
            name: "x.png".into(),
            mime_type: "image/jpeg".into(),
            bytes: fixture.image.bytes.clone(),
        },
        PasteImage {
            name: "..\\x.png".into(),
            ..fixture.image.clone()
        },
        PasteImage {
            bytes: b"not an image".to_vec(),
            ..fixture.image.clone()
        },
        PasteImage {
            bytes: vec![0; 16 * 1024 * 1024 + 1],
            ..fixture.image.clone()
        },
    ] {
        assert!(prepare_in(
            &fixture.project,
            &operation(),
            fixture.base.clone(),
            Destination::References,
            image
        )
        .is_err());
    }
    let op = operation();
    fixture.prepare(&op, Destination::References);
    assert!(prepare_in(
        &fixture.project,
        &op,
        fixture.base.clone(),
        Destination::Media,
        fixture.image.clone()
    )
    .is_err());
    assert!(prepare_in(
        &fixture.project,
        &op,
        fixture.base.clone(),
        Destination::References,
        PasteImage {
            name: "renamed.png".into(),
            ..fixture.image.clone()
        }
    )
    .is_err());
    assert!(prepare_in(
        &fixture.project,
        "../escape",
        fixture.base.clone(),
        Destination::Media,
        fixture.image.clone()
    )
    .is_err());
}

#[test]
fn interrupted_prepare_reopen_aborts_owned_file_but_never_unknown_files() {
    let fixture = Fixture::new("imageGroup");
    let op = operation();
    let prepared = fixture.prepare(&op, Destination::References);
    let unknown = fixture.project.join("references").join("keep.png");
    fs::write(&unknown, b"user file").unwrap();
    assert_eq!(
        crate::plan::read_project_plan_in(&fixture.project).unwrap(),
        fixture.base
    );
    assert_eq!(
        status_in(&fixture.project, &op).unwrap().status,
        PasteStatus::Aborted
    );
    assert!(!fixture.project.join(&prepared.file).exists());
    assert_eq!(fs::read(unknown).unwrap(), b"user file");
    abort_in(&fixture.project, &op).unwrap();
    assert_eq!(
        status_in(&fixture.project, &operation()).unwrap().status,
        PasteStatus::Missing
    );
}

#[test]
fn manifest_written_receipt_failure_is_resolved_before_an_undo_save() {
    let fixture = Fixture::new("imageGroup");
    let op = operation();
    let prepared = fixture.prepare(&op, Destination::Media);
    let next = fixture.native_next(&prepared);
    let mut journal = read(&fixture.project, &op).unwrap().unwrap();
    journal.next_plan = Some(next.clone());
    journal.phase = Phase::Committing;
    write(&fixture.project, &journal).unwrap();
    fixture.persist(&next);
    crate::plan::save_project_plan_in(&fixture.project, fixture.base.clone()).unwrap();
    assert_eq!(
        status_in(&fixture.project, &op).unwrap().status,
        PasteStatus::Committed
    );
    crate::plan::remove_plan_media_from(&fixture.project, &prepared.file).unwrap();
    assert!(fixture.project.join(&prepared.file).exists());
}

#[test]
fn changed_manifest_or_owned_bytes_fail_closed_without_deleting_files() {
    for changed_manifest in [false, true] {
        let fixture = Fixture::new("imageGroup");
        let op = operation();
        let prepared = fixture.prepare(&op, Destination::Media);
        if changed_manifest {
            let mut newer = fixture.base.clone();
            newer["title"] = json!("External edit");
            fixture.persist(&newer);
        } else {
            fs::write(fixture.project.join(&prepared.file), b"user replacement").unwrap();
        }
        assert!(fixture.commit(&op, fixture.native_next(&prepared)).is_err());
        assert!(abort_in(&fixture.project, &op).is_err());
        assert!(crate::plan::read_project_plan_in(&fixture.project).is_err());
        assert!(fixture.project.join(&prepared.file).exists());
    }
}

#[test]
fn interrupted_publish_collision_does_not_delete_identical_foreign_destination() {
    let fixture = Fixture::new("imageGroup");
    let op = operation();
    let prepared = fixture.prepare(&op, Destination::References);
    let mut journal = read(&fixture.project, &op).unwrap().unwrap();
    journal.phase = Phase::Preparing;
    journal.published = false;
    journal.publishing = true;
    write(&fixture.project, &journal).unwrap();
    fs::write(staging(&fixture.project, &op), &fixture.image.bytes).unwrap();
    abort_in(&fixture.project, &op).unwrap();
    assert!(fixture.project.join(&prepared.file).exists());
    assert!(!staging(&fixture.project, &op).exists());
}

fn collision_fixture() -> (Fixture, String, PreparedImagePaste) {
    let fixture = Fixture::new("imageGroup");
    let op = operation();
    let prepared = fixture.prepare(&op, Destination::References);
    let mut journal = read(&fixture.project, &op).unwrap().unwrap();
    journal.phase = Phase::Preparing;
    journal.published = false;
    journal.publishing = true;
    write(&fixture.project, &journal).unwrap();
    fs::write(staging(&fixture.project, &op), &fixture.image.bytes).unwrap();
    (fixture, op, prepared)
}

fn assert_collision_survives_recovery(
    fixture: &Fixture,
    operation: &str,
    prepared: &PreparedImagePaste,
) {
    for _ in 0..3 {
        assert_eq!(
            crate::plan::read_project_plan_in(&fixture.project).unwrap(),
            fixture.base,
        );
        abort_in(&fixture.project, operation).unwrap();
        assert_eq!(
            fs::read(fixture.project.join(&prepared.file)).unwrap(),
            fixture.image.bytes,
            "A destination never owned by this operation must survive every recovery",
        );
        assert_eq!(
            status_in(&fixture.project, operation).unwrap().status,
            PasteStatus::Aborted,
        );
    }
}

#[test]
fn collision_cleanup_crash_after_staging_removal_never_claims_the_foreign_destination() {
    let (fixture, op, prepared) = collision_fixture();
    {
        let _lock = files::project_lock(&fixture.project).unwrap();
        let mut journal = read(&fixture.project, &op).unwrap().unwrap();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            cleanup_with_writer(
                &fixture.project,
                &mut journal,
                &manifest(&fixture.project).unwrap(),
                |project, journal| {
                    if journal.phase == Phase::Aborted {
                        assert!(!staging(project, &op).exists());
                        panic!("Injected process interruption before final cleanup receipt");
                    }
                    write(project, journal)
                },
            )
            .unwrap();
        }));
        assert!(result.is_err());
    }
    assert!(!staging(&fixture.project, &op).exists());
    assert_collision_survives_recovery(&fixture, &op, &prepared);
}

#[test]
fn collision_cleanup_terminal_receipt_failure_never_claims_the_foreign_destination() {
    let (fixture, op, prepared) = collision_fixture();
    {
        let _lock = files::project_lock(&fixture.project).unwrap();
        let mut journal = read(&fixture.project, &op).unwrap().unwrap();
        let result = cleanup_with_writer(
            &fixture.project,
            &mut journal,
            &manifest(&fixture.project).unwrap(),
            |project, journal| {
                if journal.phase == Phase::Aborted {
                    assert!(!staging(project, &op).exists());
                    return Err(error("journal", "Injected cleanup receipt write failure"));
                }
                write(project, journal)
            },
        );
        assert_eq!(result.unwrap_err().code, "image_paste_journal");
    }
    assert!(!staging(&fixture.project, &op).exists());
    assert_collision_survives_recovery(&fixture, &op, &prepared);
}

#[test]
fn collision_cleanup_resumes_after_ownership_is_durable_but_staging_still_exists() {
    let (fixture, op, prepared) = collision_fixture();
    {
        let _lock = files::project_lock(&fixture.project).unwrap();
        let mut journal = read(&fixture.project, &op).unwrap().unwrap();
        cleanup_with_writer(
            &fixture.project,
            &mut journal,
            &manifest(&fixture.project).unwrap(),
            |project, journal| {
                write(project, journal)?;
                if journal.phase == Phase::Aborting {
                    return Err(error(
                        "journal",
                        "Interrupted after durable ownership resolution",
                    ));
                }
                Ok(())
            },
        )
        .unwrap_err();
    }
    assert!(staging(&fixture.project, &op).exists());
    let receipt = read(&fixture.project, &op).unwrap().unwrap();
    assert_eq!(receipt.phase, Phase::Aborting);
    assert!(!receipt.published);
    assert!(!receipt.publishing);
    assert!(receipt.cleanup_staged);
    assert_collision_survives_recovery(&fixture, &op, &prepared);
}

#[test]
fn aborting_collision_cannot_commit_and_status_finishes_only_its_owned_cleanup() {
    let (fixture, op, prepared) = collision_fixture();
    {
        let _lock = files::project_lock(&fixture.project).unwrap();
        let mut journal = read(&fixture.project, &op).unwrap().unwrap();
        cleanup_with_writer(
            &fixture.project,
            &mut journal,
            &manifest(&fixture.project).unwrap(),
            |project, journal| {
                if journal.phase == Phase::Aborted {
                    return Err(error("journal", "Injected final receipt failure"));
                }
                write(project, journal)
            },
        )
        .unwrap_err();
    }
    let next = fixture.gallery_next(&prepared, "/imageGroups/0/images");
    assert_eq!(
        fixture.commit(&op, next).unwrap_err().code,
        "image_paste_operation_conflict",
    );
    assert_eq!(
        manifest(&fixture.project).unwrap().plan,
        Some(fixture.base.clone())
    );
    assert_eq!(
        status_in(&fixture.project, &op).unwrap().status,
        PasteStatus::Aborted
    );
    assert_collision_survives_recovery(&fixture, &op, &prepared);
}

#[test]
fn owned_publication_cleanup_resumes_on_either_side_of_file_deletion() {
    for interrupt_before_delete in [true, false] {
        let fixture = Fixture::new("imageGroup");
        let op = operation();
        let prepared = fixture.prepare(&op, Destination::Media);
        {
            let _lock = files::project_lock(&fixture.project).unwrap();
            let mut journal = read(&fixture.project, &op).unwrap().unwrap();
            cleanup_with_writer(
                &fixture.project,
                &mut journal,
                &manifest(&fixture.project).unwrap(),
                |project, journal| {
                    if journal.phase == Phase::Aborted {
                        return Err(error("journal", "Interrupted after owned file deletion"));
                    }
                    write(project, journal)?;
                    if interrupt_before_delete {
                        return Err(error("journal", "Interrupted before owned file deletion"));
                    }
                    Ok(())
                },
            )
            .unwrap_err();
        }
        assert_eq!(
            fixture.project.join(&prepared.file).exists(),
            interrupt_before_delete
        );
        let receipt = read(&fixture.project, &op).unwrap().unwrap();
        assert_eq!(receipt.phase, Phase::Aborting);
        assert!(receipt.published);
        assert!(!receipt.publishing);
        assert!(!receipt.cleanup_staged);
        assert_eq!(
            status_in(&fixture.project, &op).unwrap().status,
            PasteStatus::Aborted
        );
        assert!(!fixture.project.join(&prepared.file).exists());
        abort_in(&fixture.project, &op).unwrap();
        assert_eq!(
            crate::plan::read_project_plan_in(&fixture.project).unwrap(),
            fixture.base
        );
    }
}

#[cfg(windows)]
#[test]
fn collision_cleanup_cannot_delete_staging_before_ownership_is_durable() {
    struct RestorePermissions(PathBuf, fs::Permissions);
    impl Drop for RestorePermissions {
        fn drop(&mut self) {
            fs::set_permissions(&self.0, self.1.clone()).unwrap();
        }
    }
    let (fixture, op, prepared) = collision_fixture();
    let path = fixture.project.join(JOURNAL_DIR).join(format!("{op}.json"));
    let permissions = fs::metadata(&path).unwrap().permissions();
    let restore = RestorePermissions(path.clone(), permissions.clone());
    let mut read_only = permissions;
    read_only.set_readonly(true);
    fs::set_permissions(&path, read_only).unwrap();
    assert!(abort_in(&fixture.project, &op).is_err());
    assert!(staging(&fixture.project, &op).exists());
    assert_eq!(
        fs::read(fixture.project.join(&prepared.file)).unwrap(),
        fixture.image.bytes,
    );
    drop(restore);
    assert_collision_survives_recovery(&fixture, &op, &prepared);
}

#[test]
fn interrupted_commit_before_manifest_reopen_never_publishes_document() {
    let fixture = Fixture::new("imageGroup");
    let op = operation();
    let prepared = fixture.prepare(&op, Destination::Media);
    let mut journal = read(&fixture.project, &op).unwrap().unwrap();
    journal.next_plan = Some(fixture.native_next(&prepared));
    journal.phase = Phase::Committing;
    write(&fixture.project, &journal).unwrap();
    assert_eq!(
        crate::plan::read_project_plan_in(&fixture.project).unwrap(),
        fixture.base
    );
    assert_eq!(
        status_in(&fixture.project, &op).unwrap().status,
        PasteStatus::Aborted
    );
    assert!(!fixture.project.join(&prepared.file).exists());
}

#[test]
fn unknown_staged_image_is_retained_with_an_explicit_recovery_failure() {
    let fixture = Fixture::new("imageGroup");
    let op = operation();
    let prepared = fixture.prepare(&op, Destination::References);
    fs::remove_file(fixture.project.join(&prepared.file)).unwrap();
    let mut journal = read(&fixture.project, &op).unwrap().unwrap();
    journal.phase = Phase::Preparing;
    journal.published = false;
    write(&fixture.project, &journal).unwrap();
    let staged = staging(&fixture.project, &op);
    fs::write(&staged, b"unknown or interrupted bytes").unwrap();
    assert!(crate::plan::read_project_plan_in(&fixture.project).is_err());
    assert_eq!(fs::read(staged).unwrap(), b"unknown or interrupted bytes");
    assert_eq!(manifest(&fixture.project).unwrap().plan, Some(fixture.base));
}

#[test]
fn corrupt_receipt_paths_and_unsupported_manifests_do_not_authorize_file_access() {
    let fixture = Fixture::new("imageGroup");
    let op = operation();
    let prepared = fixture.prepare(&op, Destination::Media);
    let mut journal = read(&fixture.project, &op).unwrap().unwrap();
    journal.prepared.file = "media/../.preshotproj".into();
    write(&fixture.project, &journal).unwrap();
    assert!(abort_in(&fixture.project, &op).is_err());
    assert!(crate::plan::read_project_plan_in(&fixture.project).is_err());
    assert!(fixture.project.join(&prepared.file).exists());
    let fixture = Fixture::new("imageGroup");
    let path = fixture.project.join(".preshotproj");
    let mut manifest: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    manifest["schemaVersion"] = json!(2);
    fs::write(path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    assert!(prepare_in(
        &fixture.project,
        &operation(),
        fixture.base.clone(),
        Destination::Media,
        fixture.image.clone()
    )
    .is_err());
    assert!(!fixture.project.join(JOURNAL_DIR).exists());
}

#[test]
fn paste_validation_cannot_bypass_the_shared_bounded_decoder() {
    let source = include_str!("image_paste.rs");
    for direct_decoder in [
        "ImageReader",
        "image::load_from_memory",
        "DynamicImage::from_decoder",
        "decode_local",
    ] {
        assert!(
            !source.contains(direct_decoder),
            "Project image paste must use the shared memory-bounded decoder, not {direct_decoder}"
        );
    }
}

#[test]
fn malformed_webp_decode_never_creates_a_paste_journal_or_project_file() {
    let fixture = Fixture::new("imageGroup");
    let mut bytes = b"RIFF".to_vec();
    bytes.extend_from_slice(&18u32.to_le_bytes());
    bytes.extend_from_slice(b"WEBPVP8L");
    bytes.extend_from_slice(&5u32.to_le_bytes());
    bytes.extend_from_slice(&[0x2f, 1, 0, 0, 0, 0]);
    assert_eq!(image::guess_format(&bytes).unwrap(), ImageFormat::WebP);
    let image = PasteImage {
        name: "broken.webp".into(),
        mime_type: "image/webp".into(),
        bytes,
    };
    let error = prepare_in(
        &fixture.project,
        &operation(),
        fixture.base.clone(),
        Destination::Media,
        image,
    )
    .unwrap_err();
    assert_eq!(error.code, "image_paste_image_decode");
    assert!(!fixture.project.join(JOURNAL_DIR).exists());
    assert!(!fixture.project.join("media").exists());
    assert_eq!(manifest(&fixture.project).unwrap().plan, Some(fixture.base));
}

#[test]
fn dimension_limits_are_enforced_before_large_decodes() {
    let mut encoded = Cursor::new(Vec::new());
    DynamicImage::new_rgb8(8193, 1)
        .write_to(&mut encoded, ImageFormat::Png)
        .unwrap();
    let image = PasteImage {
        name: "wide.png".into(),
        mime_type: "image/png".into(),
        bytes: encoded.into_inner(),
    };
    assert_eq!(
        validate_image(&image, Destination::Media).unwrap_err().code,
        "image_paste_image_dimensions"
    );
}

#[test]
fn media_preserves_native_gif_webp_and_references_reject_them() {
    for (format, name, mime) in [
        (ImageFormat::Gif, "animation.gif", "image/gif"),
        (ImageFormat::WebP, "photo.webp", "image/webp"),
        (ImageFormat::Jpeg, "photo.jpeg", "image/jpeg"),
    ] {
        let fixture = Fixture::new("imageGroup");
        let mut encoded = Cursor::new(Vec::new());
        if format == ImageFormat::Gif {
            let mut encoder = image::codecs::gif::GifEncoder::new(&mut encoded);
            for color in [[255, 0, 0, 255], [0, 0, 255, 255]] {
                encoder
                    .encode_frame(image::Frame::new(image::RgbaImage::from_pixel(
                        3,
                        2,
                        image::Rgba(color),
                    )))
                    .unwrap();
            }
        } else {
            DynamicImage::new_rgb8(3, 2)
                .write_to(&mut encoded, format)
                .unwrap();
        }
        let image = PasteImage {
            name: name.into(),
            mime_type: mime.into(),
            bytes: encoded.into_inner(),
        };
        let op = operation();
        let prepared = prepare_in(
            &fixture.project,
            &op,
            fixture.base.clone(),
            Destination::Media,
            image.clone(),
        )
        .unwrap();
        assert_eq!(
            fs::read(fixture.project.join(&prepared.file)).unwrap(),
            image.bytes
        );
        fixture.commit(&op, fixture.native_next(&prepared)).unwrap();
        if format != ImageFormat::Jpeg {
            assert!(validate_image(&image, Destination::References).is_err());
        }
    }
}

#[test]
fn gallery_limit_and_ambiguous_document_ownership_fail_closed() {
    let fixture = Fixture::new("imageGroup");
    let op = operation();
    let prepared = fixture.prepare(&op, Destination::References);
    let mut base = fixture.base.clone();
    base["document"]["blocks"]
        .as_array_mut()
        .unwrap()
        .push(json!({
        "id":"second-marker","type":"imageGroup","props":{"groupId":"group"},"children":[]}));
    let mut next = base.clone();
    next["imageGroups"][0]["images"] = fixture.gallery_next(&prepared, "/imageGroups/0/images")
        ["imageGroups"][0]["images"]
        .clone();
    assert!(validation::insertion(&base, &next, Destination::References, &prepared).is_err());
    let mut base = fixture.base.clone();
    base["imageGroups"][0]["images"] = Value::Array(
        (0..128)
            .map(|index| {
                json!({
        "id":format!("existing-{index}"),"file":"references/old.png",
        "aspectRatio":1.5,"frameWidth":150,"frameHeight":100})
            })
            .collect(),
    );
    let mut next = base.clone();
    next["imageGroups"][0]["images"]
        .as_array_mut()
        .unwrap()
        .push(
            fixture.gallery_next(&prepared, "/imageGroups/0/images")["imageGroups"][0]["images"][0]
                .clone(),
        );
    assert!(validation::insertion(&base, &next, Destination::References, &prepared).is_err());
}

#[cfg(windows)]
#[test]
fn project_reparse_destination_is_rejected_without_writing_outside_project() {
    let fixture = Fixture::new("imageGroup");
    let outside = fixture.project.join("outside");
    fs::create_dir(&outside).unwrap();
    let link = fixture.project.join("media");
    let result = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&link)
        .arg(&outside)
        .output()
        .unwrap();
    assert!(result.status.success());
    assert!(prepare_in(
        &fixture.project,
        &operation(),
        fixture.base.clone(),
        Destination::Media,
        fixture.image.clone()
    )
    .is_err());
    assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
    fs::remove_dir(link).unwrap();
}

#[test]
fn concurrent_retries_share_one_owned_file_and_receipt() {
    let fixture = Fixture::new("imageGroup");
    let op = operation();
    let workers: Vec<_> = (0..2)
        .map(|_| {
            let project = fixture.project.clone();
            let base = fixture.base.clone();
            let image = fixture.image.clone();
            let op = op.clone();
            std::thread::spawn(move || {
                prepare_in(&project, &op, base, Destination::Media, image).unwrap()
            })
        })
        .collect();
    let results: Vec<_> = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect();
    assert_eq!(results[0], results[1]);
    assert_eq!(
        fs::read_dir(fixture.project.join("media")).unwrap().count(),
        1
    );
    assert_eq!(journal_operations(&fixture.project).unwrap(), vec![op]);
}

#[test]
fn committed_retry_must_keep_exact_target_intent() {
    let fixture = Fixture::new("imageGroup");
    let op = operation();
    let prepared = fixture.prepare(&op, Destination::Media);
    let next = fixture.native_next(&prepared);
    fixture.commit(&op, next.clone()).unwrap();
    let mut changed = next.clone();
    changed["document"]["blocks"][1]["props"]["caption"] = json!("Different intent");
    assert_eq!(
        fixture.commit(&op, changed).unwrap_err().code,
        "image_paste_operation_conflict"
    );
    assert_eq!(manifest(&fixture.project).unwrap().plan, Some(next));
}

#[test]
fn native_insertion_accepts_beginning_without_changing_existing_rows() {
    let fixture = Fixture::new("imageGroup");
    let op = operation();
    let prepared = fixture.prepare(&op, Destination::Media);
    let mut next = fixture.native_next(&prepared);
    next["document"]["blocks"]
        .as_array_mut()
        .unwrap()
        .rotate_right(1);
    fixture.commit(&op, next.clone()).unwrap();
    assert_eq!(
        next["document"]["blocks"][1],
        fixture.base["document"]["blocks"][0]
    );
}

#[test]
fn wire_results_use_the_requested_camel_case_contract() {
    let fixture = Fixture::new("imageGroup");
    let op = operation();
    let prepared = fixture.prepare(&op, Destination::Media);
    let value = serde_json::to_value(&prepared).unwrap();
    assert_eq!(
        value,
        json!({"operationId":op,"file":prepared.file,
        "name":fixture.image.name,"mimeType":"image/png"})
    );
    assert_eq!(
        serde_json::to_value(status_in(&fixture.project, &op).unwrap()).unwrap(),
        json!({"status":"prepared"})
    );
    assert_eq!(
        serde_json::to_value(Destination::References).unwrap(),
        json!("references")
    );
    assert!(serde_json::from_value::<PasteImage>(
        json!({"name":"x.png","mimeType":"image/png","bytes":[0],
        "sourcePath":"outside"})
    )
    .is_err());
}

#[test]
fn aborted_receipt_does_not_require_a_retired_destination_directory() {
    let fixture = Fixture::new("imageGroup");
    let op = operation();
    fixture.prepare(&op, Destination::References);
    abort_in(&fixture.project, &op).unwrap();
    fs::remove_dir(fixture.project.join("references")).unwrap();
    assert_eq!(
        status_in(&fixture.project, &op).unwrap().status,
        PasteStatus::Aborted
    );
    assert_eq!(
        crate::plan::read_project_plan_in(&fixture.project).unwrap(),
        fixture.base
    );
}

#[test]
fn artifact_paste_requires_exactly_one_bounded_owning_revision_increment() {
    let mut fixture = Fixture::new("modelCard");
    fixture.base["artifacts"][0]["revision"] = json!(41);
    fixture.persist(&fixture.base);
    let op = operation();
    let prepared = fixture.prepare(&op, Destination::References);
    let valid = fixture.gallery_next(&prepared, "/artifacts/0/samples/images");
    assert_eq!(valid["artifacts"][0]["revision"], json!(42));
    for revision in [json!(41), json!(43), json!(-1), json!(41.5), Value::Null] {
        let mut invalid = valid.clone();
        invalid["artifacts"][0]["revision"] = revision;
        assert!(fixture.commit(&op, invalid).is_err());
    }
    fixture.commit(&op, valid).unwrap();
}

#[test]
fn standalone_paste_cannot_change_group_height_or_add_a_revision() {
    let fixture = Fixture::new("imageGroup");
    let op = operation();
    let prepared = fixture.prepare(&op, Destination::References);
    let valid = fixture.gallery_next(&prepared, "/imageGroups/0/images");
    let mut resized = valid.clone();
    resized["imageGroups"][0]["height"] = json!(640);
    assert!(fixture.commit(&op, resized).is_err());
    let mut revision = valid.clone();
    revision["imageGroups"][0]["revision"] = json!(1);
    assert!(fixture.commit(&op, revision).is_err());
    fixture.commit(&op, valid).unwrap();
}

#[test]
fn allocation_reserves_references_across_native_rows_and_all_sidecars() {
    let mut fixture = Fixture::new("prop");
    fixture.base["document"]["blocks"]
        .as_array_mut()
        .unwrap()
        .push(json!({
        "id":"native-existing","type":"image","props":{"url":"media/0001.png",
        "name":"existing.png","caption":"","showPreview":true},"children":[]}));
    fixture.base["artifacts"][0]["gallery"]["images"] = json!([{
        "id":"reference-existing","file":"references/0001.png",
        "aspectRatio":1.5,"frameWidth":150,"frameHeight":100}]);
    fixture.persist(&fixture.base);
    let media = fixture.prepare(&operation(), Destination::Media);
    assert_ne!(media.file, "media/0001.png");
    abort_in(&fixture.project, &media.operation_id).unwrap();
    let reference = fixture.prepare(&operation(), Destination::References);
    assert_ne!(reference.file, "references/0001.png");
    let mut reused_id = fixture.gallery_next(&reference, "/artifacts/0/gallery/images");
    reused_id["artifacts"][0]["gallery"]["images"][1]["id"] = json!("native-existing");
    assert!(fixture.commit(&reference.operation_id, reused_id).is_err());
}

#[test]
fn retention_query_validates_paths_without_mutating_pending_operations() {
    let fixture = Fixture::new("imageGroup");
    let op = operation();
    let prepared = fixture.prepare(&op, Destination::References);
    let project = fixture.project.to_string_lossy().into_owned();
    assert!(crate::plan::is_reference_image_retained_for_history(
        project.clone(),
        prepared.file.clone(),
    )
    .is_err());
    assert_eq!(
        status_in(&fixture.project, &op).unwrap().status,
        PasteStatus::Prepared
    );
    assert!(fixture.project.join(&prepared.file).is_file());
    for invalid in [
        "references/../.preshotproj",
        "media/0001.png",
        "references/missing.png",
    ] {
        assert!(crate::plan::is_reference_image_retained_for_history(
            project.clone(),
            invalid.into(),
        )
        .is_err());
    }
    assert!(crate::plan::is_reference_image_retained_for_history(
        project,
        fixture
            .project
            .join(&prepared.file)
            .to_string_lossy()
            .into_owned(),
    )
    .is_err());
}

#[test]
fn retention_query_recognizes_existing_material_history_without_changing_unretained_crops() {
    let fixture = Fixture::new("imageGroup");
    let references = fixture.project.join("references");
    fs::create_dir(&references).unwrap();
    for name in ["0001.png", "0002.png"] {
        fs::write(references.join(name), &fixture.image.bytes).unwrap();
    }
    let op = operation();
    let file = "references/0001.png";
    let material_journal = json!({
        "version":1,"projectId":manifest(&fixture.project).unwrap().id,"phase":"committed",
        "basePlan":fixture.base,"nextPlan":null,"publishedCount":1,"publishing":false,
        "prepared":{"operationId":op,"materialId":operation(),"revision":1,
            "payload":{"format":"preshot-material","version":1,"kind":"imageGroup",
                "component":{"kind":"imageGroup","name":"历史素材","description":"","images":[{
                    "localImageId":"material-image","aspectRatio":1.5,"frameWidth":150,"frameHeight":100}]}},
            "images":[{"localImageId":"material-image","file":file}]},
        "owned":[{"file":file,"image":{"localImageId":"material-image","blobId":files::hash(&fixture.image.bytes),
            "mimeType":"image/png","byteLength":fixture.image.bytes.len(),"width":3,"height":2}}]
    });
    let journal_dir = fixture.project.join(".preshot-library");
    fs::create_dir(&journal_dir).unwrap();
    fs::write(
        journal_dir.join(format!("{op}.json")),
        serde_json::to_vec(&material_journal).unwrap(),
    )
    .unwrap();
    let project = fixture.project.to_string_lossy().into_owned();
    assert!(crate::plan::is_reference_image_retained_for_history(
        project.clone(),
        "references\\0001.png".into(),
    )
    .unwrap());
    assert!(!crate::plan::is_reference_image_retained_for_history(
        project,
        "references/0002.png".into(),
    )
    .unwrap());
    let bounds = crate::plan::ReferenceCropBounds {
        x: 0,
        y: 0,
        width: 2,
        height: 2,
    };
    assert_eq!(
        crate::plan::crop_reference_image_in(&fixture.project, file, bounds,)
            .unwrap_err()
            .code,
        "reference_retained_for_history"
    );
    let crop =
        crate::plan::crop_reference_image_in(&fixture.project, "references/0002.png", bounds)
            .unwrap();
    assert_eq!(crop.file, "references/0002.png");
    crate::plan::rollback_reference_image_crop_in(
        &fixture.project,
        &crop.file,
        &crop.transaction_id,
    )
    .unwrap();
    assert_eq!(
        fs::read(references.join("0001.png")).unwrap(),
        fixture.image.bytes
    );
    assert_eq!(
        fs::read(references.join("0002.png")).unwrap(),
        fixture.image.bytes
    );
}
