use super::*;
use serde_json::json;
use tempfile::TempDir;

fn fixture() -> (TempDir, PathBuf, CopyRequest) {
    let root = tempfile::tempdir().unwrap();
    let home = root.path().join("profile"); fs::create_dir(&home).unwrap();
    let source = root.path().join("南京长江大桥"); fs::create_dir(&source).unwrap();
    crate::bundled_demo::write_assets(&source).unwrap();
    let manifest = super::super::ProjectManifest { schema_version: 1, id: Uuid::new_v4().to_string(), name: "南京长江大桥".into(),
        created_at: "2026-01-01T00:00:00Z".into(), updated_at: "2026-01-01T00:00:00Z".into(),
        cover_image: Some("media/bridge-cover.jpg".into()), plan: Some(crate::bundled_demo::plan()) };
    fs::write(source.join(".preshotproj"), serde_json::to_vec(&manifest).unwrap()).unwrap();
    fs::write(source.join("output.pdf"), b"old export").unwrap();
    fs::write(source.join("references/unused.png"), b"history-only").unwrap();
    let input = CopyRequest { operation_id: Uuid::new_v4().to_string(), source_path: source.to_string_lossy().into_owned(), source_project_id: manifest.id,
        parent_path: root.path().to_string_lossy().into_owned(), name: "南京长江大桥 - 副本".into() };
    (root, home, input)
}

#[test]
fn independent_copy_keeps_complete_document_and_only_referenced_originals() {
    let (_root, home, request) = fixture();
    let before = fs::read(Path::new(&request.source_path).join(".preshotproj")).unwrap();
    let result = copy_in(&home, &request, &AtomicBool::new(false), &|_| {}).unwrap();
    assert_eq!(result.phase, "completed");
    let copied = result.project.unwrap();
    assert_ne!(copied.manifest.id, request.source_project_id);
    assert_eq!(copied.manifest.name, request.name);
    let mut expected = crate::bundled_demo::plan(); expected["title"] = json!(request.name);
    assert_eq!(copied.manifest.plan, Some(expected));
    let destination = Path::new(&copied.path);
    assert!(!destination.join("output.pdf").exists());
    assert!(!destination.join("references/unused.png").exists());
    for relative in ["references/0001.jpg", "media/bridge-motion.mp4", "media/ready-tones.wav", "media/shot-list.txt", "media/bridge-cover.jpg"] {
        assert_eq!(fs::read(destination.join(relative)).unwrap(), fs::read(Path::new(&request.source_path).join(relative)).unwrap());
    }
    assert_eq!(fs::read(Path::new(&request.source_path).join(".preshotproj")).unwrap(), before);
    if let Some(output) = std::env::var_os("PRESHOT_COPY_ACCEPTANCE_OUTPUT") {
        // Explicit opt-in fixture for the real PDF/DOCX/long-image integration suite.
        let output = PathBuf::from(output);
        fs::create_dir(&output).unwrap();
        for directory in ["media", "references"] { fs::create_dir(output.join(directory)).unwrap(); }
        let mut paths = local_files(&copied.manifest).unwrap(); paths.insert(".preshotproj".into());
        for file in paths { fs::copy(destination.join(&file), output.join(file)).unwrap(); }
    }
    // Retry is exact and works even when the source was removed after completion.
    fs::remove_dir_all(&request.source_path).unwrap();
    let retry = copy_in(&home, &request, &AtomicBool::new(false), &|_| {}).unwrap();
    assert_eq!(retry.project.unwrap().manifest.id, copied.manifest.id);
    assert!(destination.join("references/0001.jpg").exists());
}

#[test]
fn exif_project_copy_preserves_schema_axes_shared_references_and_original_hashes() {
    let (_root, home, request) = fixture();
    let source = Path::new(&request.source_path);
    let path = source.join(".preshotproj");
    let mut manifest: ProjectManifest = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    let plan = manifest.plan.as_mut().unwrap();
    plan["schemaVersion"] = json!(18); plan["document"]["version"] = json!(5);
    plan["imageGroups"][0]["images"][0]["presentationAxes"] = json!("exif");
    let first = plan["imageGroups"][0]["images"][0].clone();
    let mut raw_view = first.clone(); raw_view["id"] = json!("same-file-legacy-raw");
    raw_view.as_object_mut().unwrap().remove("presentationAxes");
    plan["imageGroups"][0]["images"].as_array_mut().unwrap().push(raw_view);
    fs::write(&path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    let copied = copy_in(&home, &request, &AtomicBool::new(false), &|_| {}).unwrap().project.unwrap();
    let copied_plan = copied.manifest.plan.unwrap();
    assert_eq!(copied_plan["schemaVersion"], 18);
    assert_eq!(copied_plan["imageGroups"], manifest.plan.unwrap()["imageGroups"]);
    let file = first["file"].as_str().unwrap();
    assert_eq!(crate::original_image::fingerprint(&Path::new(&copied.path).join(file)).unwrap(), crate::original_image::fingerprint(&source.join(file)).unwrap());
}

#[test]
fn copy_refuses_collisions_missing_files_and_descendant_targets_without_publication() {
    for failure in ["collision", "missing", "descendant", "identity", "invalid-name"] {
        let (root, home, mut request) = fixture();
        match failure {
            "collision" => { fs::create_dir(root.path().join(&request.name)).unwrap(); fs::write(root.path().join(&request.name).join("keep.txt"), b"keep").unwrap(); },
            "missing" => fs::remove_file(Path::new(&request.source_path).join("references/0001.jpg")).unwrap(),
            "descendant" => request.parent_path = request.source_path.clone(),
            "identity" => request.source_project_id = Uuid::new_v4().to_string(),
            _ => request.name = "../escaped".into(),
        }
        assert!(copy_in(&home, &request, &AtomicBool::new(false), &|_| {}).is_err(), "{failure}");
        assert!(Path::new(&request.source_path).join(".preshotproj").exists());
        assert!(!root.path().join(&request.name).join(".preshotproj").exists());
        if failure == "collision" { assert_eq!(fs::read(root.path().join(&request.name).join("keep.txt")).unwrap(), b"keep"); }
    }
}

#[test]
fn cancellation_during_streaming_removes_only_owned_staging() {
    let (root, home, request) = fixture();
    let cancelled = AtomicBool::new(false);
    let result = copy_in(&home, &request, &cancelled, &|p| { if p.copied_bytes > 0 { cancelled.store(true, Ordering::Relaxed); } }).unwrap();
    assert_eq!(result.phase, "cancelled");
    assert!(!root.path().join(&request.name).exists());
    assert!(!root.path().join(format!(".preshot-copy-{}", request.operation_id)).exists());
    assert!(Path::new(&request.source_path).join("references/0001.jpg").exists());
}

#[test]
fn source_changes_and_unknown_staging_files_are_not_silently_published_or_removed() {
    let (root, home, request) = fixture();
    let changed = AtomicBool::new(false);
    let result = copy_in(&home, &request, &AtomicBool::new(false), &|p| {
        if p.copied_bytes > 0 && !changed.swap(true, Ordering::Relaxed) {
            let path = Path::new(&request.source_path).join(".preshotproj");
            let mut value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            value["name"] = json!("另一处修改"); fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
        }
    });
    assert!(result.unwrap_err().message.contains("变化"));
    assert!(!root.path().join(&request.name).exists());
    let receipt = read(&home, &request.operation_id).unwrap().unwrap();
    assert_eq!(receipt.phase, "failed");
    let temporary = stage(&receipt); fs::create_dir(&temporary).unwrap();
    create_file(&temporary.join(".preshot-copy-owner"), request.operation_id.as_bytes()).unwrap();
    fs::write(temporary.join("unknown.txt"), b"not owned").unwrap();
    assert!(cleanup(&receipt).is_err());
    assert_eq!(fs::read(temporary.join("unknown.txt")).unwrap(), b"not owned");
}

#[test]
fn durable_recovery_distinguishes_interrupted_staging_from_already_published_copies() {
    let (_root, home, request) = fixture();
    let first = copy_in(&home, &request, &AtomicBool::new(false), &|_| {}).unwrap();
    let mut receipt = read(&home, &request.operation_id).unwrap().unwrap();
    receipt.phase = "finishing".into(); save(&home, &receipt).unwrap();
    let recovered = recover(&home, receipt.clone()).unwrap();
    assert_eq!(recovered.phase, "completed");
    assert_eq!(exposed(&recovered).unwrap().project.unwrap().manifest.id, first.project.unwrap().manifest.id);
    // Simulate an interrupted next copy with only an owned prefix file.
    receipt.request.operation_id = Uuid::new_v4().to_string(); receipt.request.name = "中断副本".into();
    receipt.project_id = Uuid::new_v4().to_string(); receipt.manifest_hash.clear(); receipt.phase = "copying".into();
    let temporary = stage(&receipt); fs::create_dir(&temporary).unwrap();
    create_file(&temporary.join(".preshot-copy-owner"), receipt.request.operation_id.as_bytes()).unwrap();
    fs::create_dir(temporary.join("media")).unwrap();
    fs::write(temporary.join("media/bridge-motion.mp4"), b"partial").unwrap();
    save(&home, &receipt).unwrap();
    assert_eq!(recover(&home, receipt).unwrap().phase, "failed");
    assert!(!temporary.exists());
}

#[test]
fn external_urls_and_legacy_documents_are_preserved_without_rewriting_the_source() {
    for version in 13..=17 {
        let (_root, home, request) = fixture();
        let source = Path::new(&request.source_path);
        let path = source.join(".preshotproj");
        let mut manifest: ProjectManifest = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let mut plan = json!({"schemaVersion":version,"title":"源标题","document":{"format":"preshot-blocks","version":version-12,
          "blocks":[{"id":"web-image","type":"image","props":{"url":"https://example.com/photo.jpg","name":"网络图片","caption":"","showPreview":true},"children":[]},
          {"id":"text","type":"paragraph","props":{},"content":[{"type":"text","text":"正文源标题","styles":{}}],"children":[]}]},"imageGroups":[]});
        if version >= 15 { plan["artifacts"] = json!([]); }
        manifest.plan = Some(plan.clone()); fs::write(&path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        let legacy = source.join(".preshot"); fs::rename(&path, &legacy).unwrap();
        let copied = copy_in(&home, &request, &AtomicBool::new(false), &|_| {}).unwrap().project.unwrap();
        let copied_plan = copied.manifest.plan.unwrap();
        assert_eq!(copied_plan["document"], plan["document"]);
        assert_eq!(copied_plan["schemaVersion"], version);
        assert!(legacy.exists() && !path.exists());
    }
}

#[cfg(windows)]
#[test]
fn locked_output_file_aborts_without_removing_the_original_or_publishing_a_project() {
    use std::os::windows::fs::OpenOptionsExt;
    let (root, home, request) = fixture();
    let handle = OpenOptions::new().read(true).share_mode(0).open(Path::new(&request.source_path).join("references/0001.jpg")).unwrap();
    assert!(copy_in(&home, &request, &AtomicBool::new(false), &|_| {}).is_err());
    assert!(!root.path().join(&request.name).exists());
    drop(handle);
    assert_eq!(copy_in(&home, &request, &AtomicBool::new(false), &|_| {}).unwrap().phase, "completed");
}

#[test]
fn late_destination_collision_preserves_foreign_files_and_cleans_owned_staging() {
    let (root, home, request) = fixture();
    let target = root.path().join(&request.name);
    let result = copy_in(&home, &request, &AtomicBool::new(false), &|status| {
        if status.phase == "finishing" {
            fs::create_dir(&target).unwrap();
            fs::write(target.join("keep.txt"), b"another operation").unwrap();
        }
    });
    assert!(result.is_err());
    assert_eq!(fs::read(target.join("keep.txt")).unwrap(), b"another operation");
    assert!(!target.join(".preshotproj").exists());
    assert!(!root.path().join(format!(".preshot-copy-{}", request.operation_id)).exists());
    let receipt = read(&home, &request.operation_id).unwrap().unwrap();
    assert_eq!(receipt.phase, "failed");
    let mut changed = request.clone(); changed.name = "different operation input".into();
    assert!(copy_in(&home, &changed, &AtomicBool::new(false), &|_| {}).is_err());
}

#[test]
#[ignore = "uses generated real >256 MiB images; set PRESHOT_COPY_LARGE_FIXTURES"]
fn real_large_originals_copy_independently_without_byte_caps() {
    let fixtures = PathBuf::from(std::env::var_os("PRESHOT_COPY_LARGE_FIXTURES").expect("large fixture directory"));
    let png = fixtures.join("original-10000x10000.png");
    assert!(fs::metadata(&png).unwrap().len() > 256 * 1024 * 1024);
    let (_root, home, request) = fixture();
    let source = Path::new(&request.source_path);
    for name in ["large-a.png", "large-b.png"] { fs::copy(&png, source.join("references").join(name)).unwrap(); }
    let path = source.join(".preshotproj");
    let mut manifest: ProjectManifest = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    let plan = manifest.plan.as_mut().unwrap();
    let mut image = plan["imageGroups"][0]["images"][0].clone();
    image["id"] = json!("large-a"); image["file"] = json!("references/large-a.png");
    image["sourceWidth"] = json!(10000); image["sourceHeight"] = json!(10000); image["aspectRatio"] = json!(1);
    let mut second = image.clone(); second["id"] = json!("large-b"); second["file"] = json!("references/large-b.png");
    plan["imageGroups"][0]["images"] = json!([image, second]);
    fs::write(path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    let result = copy_in(&home, &request, &AtomicBool::new(false), &|_| {}).unwrap();
    assert!(result.total_bytes > 512 * 1024 * 1024);
    let target = PathBuf::from(result.project.unwrap().path);
    for name in ["large-a.png", "large-b.png"] {
        assert_eq!(crate::original_image::fingerprint(&target.join("references").join(name)).unwrap(), crate::original_image::fingerprint(&png).unwrap());
    }
    fs::write(target.join("references/large-a.png"), b"changed copy").unwrap();
    assert!(fs::metadata(target.join("references/large-b.png")).unwrap().len() > 256 * 1024 * 1024);
    assert_eq!(crate::original_image::fingerprint(&source.join("references/large-a.png")).unwrap(), crate::original_image::fingerprint(&png).unwrap());
}
