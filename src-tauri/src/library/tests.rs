use super::*;
use image::{DynamicImage, ImageFormat};
use serde_json::{json, Value};
use std::{fs, io::Cursor, path::PathBuf};
use tempfile::TempDir;
use uuid::Uuid;

#[path = "tests_edit.rs"]
mod content_edit;
#[path = "tests_purge.rs"]
mod permanent_delete;
#[path = "tests_image.rs"]
mod single_image;
#[path = "tests_insert_selection.rs"]
mod insert_selection_tests;
#[path = "tests_categories.rs"]
mod categories;

#[test]
fn library_image_kind_schema_preserves_v5_instances() {
    let fixture = Fixture::new("prop");
    let store = fixture.store();
    let version: u32 = store.conn.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap();
    assert_eq!(version, 6);
    assert!(store.conn.prepare("SELECT storage_id FROM image_instances").is_ok());
}

#[test]
fn library_edit_schema_migrates_v1_without_losing_content() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save_legacy_fixture(fixture.save_request()).unwrap();
    store.conn.execute_batch(
        "DROP TRIGGER IF EXISTS revisioned_content;
         DROP TRIGGER IF EXISTS material_identity_insert;
         DROP TABLE IF EXISTS edit_receipts;
         CREATE TRIGGER IF NOT EXISTS immutable_content BEFORE UPDATE OF detail_json ON materials
         WHEN json_extract(old.detail_json,'$.payload') <> json_extract(new.detail_json,'$.payload')
           OR json_extract(old.detail_json,'$.images') <> json_extract(new.detail_json,'$.images')
           OR json_extract(old.detail_json,'$.revision') <> json_extract(new.detail_json,'$.revision')
         BEGIN SELECT RAISE(ABORT,'Material payloads are immutable'); END;
         PRAGMA user_version = 1;"
    ).unwrap();
    drop(store);
    let store = fixture.store();
    let version: u32 = store
        .conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, 6);
    assert_eq!(store.get(&material.summary.id).unwrap(), material);
    assert_eq!(store.blob(&material.images[0]).unwrap(), fixture.bytes);
}

#[test]
fn library_edit_schema_accepts_next_content_revision() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let changed = store.conn.execute(
        "UPDATE materials SET detail_json=json_set(detail_json,'$.revision',2,'$.payload.component.source','新的日落') WHERE id=?1",
        [&material.summary.id],
    );
    assert!(changed.is_ok(), "{changed:?}");
    let revised = store.get(&material.summary.id).unwrap();
    assert_eq!(revised.summary.revision, 2);
    assert_eq!(revised.payload.component["source"], "新的日落");
}

struct Fixture {
    _root: TempDir,
    home: PathBuf,
    project: PathBuf,
    plan: Value,
    bytes: Vec<u8>,
}

impl Store {
    // Seed authentic pre-v5 objects for compatibility/purge tests. Production
    // snapshot saves deliberately no longer expose a legacy-write branch.
    fn save_legacy_fixture(&mut self, mut input: MaterialSaveRequest) -> Result<MaterialDetail> {
        let replay: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM save_receipts WHERE operation_id=?1
             UNION ALL SELECT 1 FROM purged_operations WHERE operation_kind='save' AND operation_id=?1)",
            [&input.operation_id], |r| r.get(0),
        ).map_err(|e| error("database", e))?;
        if replay { return self.save(input); }
        input.metadata = validation::metadata(input.metadata)?;
        validation::snapshot(&input.expected_plan, &input.snapshot)?;
        let intent = files::hash(&serde_json::to_vec(&input).unwrap());
        let project = files::directory(std::path::Path::new(&input.project_path))?;
        let mut images = Vec::new();
        for portable in validation::payload_images(&input.snapshot.payload)? {
            let local_id = portable["localImageId"].as_str().unwrap();
            let source = input.snapshot.sources.iter().find(|image| image.local_image_id == local_id).unwrap();
            let bytes = files::read_limited(&files::reference(&project, &source.file, true)?, files::MAX_IMAGE_BYTES)?;
            let (mime, width, height) = files::image_info(&bytes, false)?;
            let image = MaterialImage {
                local_image_id: local_id.into(), blob_id: files::hash(&bytes), storage_id: None,
                mime_type: mime.into(), byte_length: bytes.len() as u64, width, height,
            };
            let path = self.object_path(&image.blob_id, &image.mime_type)?;
            if !path.exists() { files::atomic(&path, &bytes)?; }
            images.push(image);
        }
        let timestamp = now();
        let detail = MaterialDetail {
            summary: MaterialSummary {
                metadata: input.metadata, id: Uuid::new_v4().to_string(),
                kind: input.snapshot.payload.kind.clone(), revision: 1, metadata_version: 1,
                created_at: timestamp, updated_at: timestamp, deleted_at: None,
                image_count: images.len(), byte_length: images.iter().map(|image| image.byte_length).sum(),
                preview_state: PreviewState::Pending, preview_partial: None,
            },
            payload: input.snapshot.payload, images,
        };
        let tx = self.conn.transaction().map_err(|e| error("database", e))?;
        tx.execute("INSERT INTO materials(id,kind,detail_json) VALUES(?1,?2,?3)",
            params![detail.summary.id, detail.summary.kind.as_str(), serde_json::to_string(&detail).unwrap()])
            .map_err(|e| error("database", e))?;
        let rowid = tx.last_insert_rowid();
        for (position, image) in detail.images.iter().enumerate() {
            instances::insert_blob_metadata(&tx, image)?;
            tx.execute("INSERT INTO material_images(material_id,local_image_id,blob_hash,position) VALUES(?1,?2,?3,?4)",
                params![detail.summary.id, image.local_image_id, image.blob_id, position]).map_err(|e| error("database", e))?;
        }
        search::projection(&tx, rowid, &detail)?;
        tx.execute("INSERT INTO save_receipts(operation_id,intent_hash,material_id) VALUES(?1,?2,?3)",
            params![input.operation_id, intent, detail.summary.id]).map_err(|e| error("database", e))?;
        tx.commit().map_err(|e| error("database", e))?;
        Ok(detail)
    }
}

impl Fixture {
    fn new(kind: &str) -> Self {
        // Keep native test artifacts inside the checkout, never in the OS temp directory.
        let root = tempfile::Builder::new()
            .prefix("library-test-")
            .tempdir_in(".")
            .unwrap();
        let home = root.path().join("home");
        let project = root.path().join("project");
        fs::create_dir_all(project.join("references")).unwrap();
        let mut png = Cursor::new(Vec::new());
        DynamicImage::new_rgb8(3, 2)
            .write_to(&mut png, ImageFormat::Png)
            .unwrap();
        let bytes = png.into_inner();
        fs::write(project.join("references").join("0001.png"), &bytes).unwrap();
        let image = json!({"id":"source-image","file":"references/0001.png","aspectRatio":1.5,
            "frameWidth":150,"frameHeight":100,"fitMode":"stretch","caption":"窗边逆光"});
        let mut sidecar = match kind {
            "imageGroup" => json!({"id":"source","type":"reference","name":"杭州摄影",
                "description":"西湖日落","x":0,"width":1,"height":320,"images":[image]}),
            "shootingLocation" => json!({"id":"source","kind":kind,"revision":0,
                "venueName":"杭州摄影","address":"西湖日落","description":"窗边",
                "gallery":{"id":"collection","images":[image]}}),
            "modelCard" => json!({"id":"source","kind":kind,"revision":0,
                "modelId":"杭州摄影","heightCm":170,"weightKg":null,"shoeSize":"38","notes":"西湖日落",
                "samples":{"id":"collection","images":[image]}}),
            "clothing" => json!({"id":"source","kind":kind,"revision":0,
                "title":"杭州摄影","source":"西湖日落","mainGallery":{"id":"collection","images":[image]},
                "tryOn":{"expanded":false,"gallery":{"id":"legacy","images":[]}}}),
            _ => json!({"id":"source","kind":"prop","revision":0,
                "title":"杭州摄影","source":"西湖日落","gallery":{"id":"collection","images":[image]}}),
        };
        // Deliberately nonportable layout proves snapshot normalization.
        if kind != "imageGroup" {
            sidecar["layout"] = json!({"widthRatio":0.6,"offsetRatio":0.1});
        }
        let props = if kind == "imageGroup" {
            json!({"groupId":"source"})
        } else {
            json!({"artifactId":"source"})
        };
        let plan = json!({"schemaVersion":15,"title":"测试项目",
            "document":{"format":"preshot-blocks","version":3,
                "blocks":[{"id":"block-source","type":kind,"props":props,"children":[]}]},
            "imageGroups":if kind=="imageGroup" {vec![sidecar.clone()]} else {vec![]},
            "artifacts":if kind!="imageGroup" {vec![sidecar]} else {vec![]}});
        let fixture = Self {
            _root: root,
            home,
            project,
            plan,
            bytes,
        };
        fixture.write_plan(&fixture.plan);
        fixture
    }

    fn write_plan(&self, plan: &Value) {
        fs::write(
            self.project.join(".preshotproj"),
            serde_json::to_vec(&json!({
                "schemaVersion":1,"id":"10000000-0000-4000-8000-000000000001","name":"测试",
                "createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","plan":plan
            }))
            .unwrap(),
        )
        .unwrap();
    }

    fn save_request(&self) -> models::MaterialSaveRequest {
        let (payload, sources, omitted) =
            validation::snapshot_from_plan(&self.plan, "block-source").unwrap();
        serde_json::from_value(json!({
            "operationId":Uuid::new_v4().to_string(),"projectId":"10000000-0000-4000-8000-000000000001",
            "projectPath":self.project.to_str().unwrap(),"expectedPlan":self.plan,
            "snapshot":{"sourceBlockId":"block-source","payload":payload,
                "sources":sources,"omittedLegacyImages":omitted},
            "metadata":{"name":"同名素材","description":"可复用","tags":["摄影"],"favorite":false}
        })).unwrap()
    }

    fn store(&self) -> Store {
        Store::open(&self.home).unwrap()
    }

    fn insert_request(&self, material: &models::MaterialDetail) -> models::MaterialInsertRequest {
        models::MaterialInsertRequest {
            target_group_id: None,
            selection: None,
            operation_id: Uuid::new_v4().to_string(),
            material_id: material.summary.id.clone(),
            revision: material.summary.revision,
            project_id: self.save_request().project_id,
            project_path: self.project.to_str().unwrap().into(),
            expected_plan: self.plan.clone(),
        }
    }

    fn next_plan(&self, prepared: &models::PreparedMaterialInsert) -> Value {
        let mut next = self.plan.clone();
        let kind = prepared.payload.kind.as_str();
        if kind == "image" || insert_selection::separate_images(prepared.selection.as_ref()) {
            let component = &prepared.payload.component;
            for image in component["images"].as_array().unwrap() {
            let source = prepared.images.iter().find(|source| image["localImageId"] == source.local_image_id).unwrap();
            next["document"]["blocks"].as_array_mut().unwrap().push(json!({
                "id": Uuid::new_v4().to_string(), "type":"image", "children":[],
                "props": {"url":source.file,"name":component["name"],
                    "caption":image["caption"].as_str().unwrap_or(""),
                    "showPreview":true,"previewWidth":image["frameWidth"]}
            }));
            }
            return next;
        }
        let mut record = prepared.payload.component.clone();
        let record_id = Uuid::new_v4().to_string();
        record["id"] = json!(record_id);
        let images = if kind == "imageGroup" {
            &mut record["images"]
        } else {
            record["revision"] = json!(0);
            let key = match kind {
                "modelCard" => "samples",
                "clothing" => "mainGallery",
                _ => "gallery",
            };
            record[key]["id"] = json!(Uuid::new_v4().to_string());
            &mut record[key]["images"]
        };
        for image in images.as_array_mut().unwrap() {
            let local = image
                .as_object_mut()
                .unwrap()
                .remove("localImageId")
                .unwrap();
            image["id"] = json!(Uuid::new_v4().to_string());
            image["file"] = json!(
                prepared
                    .images
                    .iter()
                    .find(|i| i.local_image_id == local.as_str().unwrap())
                    .unwrap()
                    .file
            );
        }
        if kind == "imageGroup" {
            record.as_object_mut().unwrap().remove("kind");
            record["type"] = json!("reference");
            record["x"] = json!(0);
            record["width"] = json!(1008);
            record["height"] = json!(320);
        }
        if kind == "clothing" {
            record["tryOn"] =
                json!({"expanded":false,"gallery":{"id":Uuid::new_v4().to_string(),"images":[]}});
        }
        let sidecars = if kind == "imageGroup" {
            "imageGroups"
        } else {
            "artifacts"
        };
        next[sidecars].as_array_mut().unwrap().push(record);
        next["document"]["blocks"].as_array_mut().unwrap().push(json!({
            "id":Uuid::new_v4().to_string(),"type":kind,"children":[],
            "props":if kind == "imageGroup" { json!({"groupId":record_id}) } else { json!({"artifactId":record_id}) }
        }));
        next
    }

    fn commit_request(
        &self,
        prepared: &models::PreparedMaterialInsert,
        next: &Value,
    ) -> models::MaterialInsertCommit {
        models::MaterialInsertCommit {
            operation_id: prepared.operation_id.clone(),
            project_id: self.save_request().project_id,
            project_path: self.project.to_str().unwrap().into(),
            expected_plan: self.plan.clone(),
            next_plan: next.clone(),
        }
    }

    fn journal_path(&self, operation: &str) -> PathBuf {
        self.project
            .join(".preshot-library")
            .join(format!("{operation}.json"))
    }

    fn change_journal(&self, operation: &str, phase: &str, next: Option<&Value>) {
        let path = self.journal_path(operation);
        let mut journal: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        journal["phase"] = json!(phase);
        journal["nextPlan"] = json!(next);
        fs::write(path, serde_json::to_vec(&journal).unwrap()).unwrap();
    }
}

#[test]
fn library_insert_resolves_pending_image_paste_before_replacing_the_manifest() {
    for paste_was_written in [false, true] {
        let mut fixture = Fixture::new("prop");
        let mut store = fixture.store();
        let material = store.save(fixture.save_request()).unwrap();
        let project_path = fixture.project.to_str().unwrap().to_owned();
        let pasted = crate::image_paste::prepare_image_paste(
            project_path.clone(),
            Uuid::new_v4().to_string(),
            fixture.plan.clone(),
            crate::image_paste::Destination::References,
            crate::image_paste::PasteImage {
                name: "clipboard.png".into(), mime_type: "image/png".into(), bytes: fixture.bytes.clone(),
            },
        ).unwrap();
        let paste_file = fixture.project.join("references").join(files::reference_name(&pasted.file).unwrap());
        let receipt_path = fixture.project.join(".preshot-image-paste").join(format!("{}.json", pasted.operation_id));
        assert!(paste_file.exists());
        if paste_was_written {
            let mut next = fixture.plan.clone();
            let mut image = next["artifacts"][0]["gallery"]["images"][0].clone();
            image["id"] = json!(Uuid::new_v4().to_string());
            image["file"] = json!(pasted.file);
            next["artifacts"][0]["gallery"]["images"].as_array_mut().unwrap().push(image);
            next["artifacts"][0]["revision"] = json!(fixture.plan["artifacts"][0]["revision"].as_u64().unwrap() + 1);
            crate::image_paste::commit_image_paste(
                project_path.clone(), pasted.operation_id.clone(), fixture.plan.clone(), next.clone(),
            ).unwrap();
            fixture.plan = next;
            let mut receipt: Value = serde_json::from_slice(&fs::read(&receipt_path).unwrap()).unwrap();
            receipt["phase"] = json!("committing");
            fs::write(&receipt_path, serde_json::to_vec(&receipt).unwrap()).unwrap();
        }
        let prepared = store.prepare_insert(fixture.insert_request(&material)).unwrap();
        let next = fixture.next_plan(&prepared);
        insert::commit(fixture.commit_request(&prepared, &next)).unwrap();
        let durable: Value = serde_json::from_slice(&fs::read(&receipt_path).unwrap()).unwrap();
        assert_eq!(durable["phase"], if paste_was_written { "committed" } else { "aborted" });
        let status = crate::image_paste::get_image_paste_status(project_path, pasted.operation_id).unwrap();
        assert_eq!(status.status, if paste_was_written {
            crate::image_paste::PasteStatus::Committed
        } else {
            crate::image_paste::PasteStatus::Aborted
        });
        assert_eq!(paste_file.exists(), paste_was_written);
        assert_eq!(crate::workspace::read_manifest(&fixture.project).unwrap().plan, Some(next));
    }
}

#[test]
fn library_roundtrip_all_payloads_and_copied_image_independence() {
    for kind in [
        "imageGroup",
        "shootingLocation",
        "modelCard",
        "prop",
        "clothing",
    ] {
        let fixture = Fixture::new(kind);
        let mut store = fixture.store();
        let request = fixture.save_request();
        let material = store.save(request.clone()).unwrap();
        assert_eq!(material.payload, request.snapshot.payload);
        assert_eq!(material.summary.image_count, 1);
        assert_eq!(store.save(request).unwrap().summary.id, material.summary.id);
        fs::remove_file(fixture.project.join("references").join("0001.png")).unwrap();
        assert!(store
            .load_image(&material.summary.id, 1, &material.images[0].local_image_id)
            .unwrap()
            .starts_with("data:image/png;base64,"));
        assert_eq!(store.get(&material.summary.id).unwrap(), material);
    }
}

#[test]
fn library_search_exact_names_is_literal_normalized_and_excludes_deleted_materials() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let name = "Caf\u{e9} %_\" OR";
    for index in 0..52 {
        let mut request = fixture.save_request();
        request.metadata.name = format!("{name} {index}");
        request.metadata.description = name.into();
        store.save(request).unwrap();
    }
    let mut request = fixture.save_request();
    request.metadata.name = format!("  {name}  ");
    let exact = store.save(request).unwrap();
    let lookup = |name: &str| {
        serde_json::from_value(json!({
            "query":"", "exactName":name, "sort":"name", "offset":0, "limit":1
        }))
        .unwrap()
    };
    let result = store.search(lookup(" Cafe\u{301} %_\" OR ")).unwrap();
    assert_eq!(result.total, 1);
    assert_eq!(result.items[0].id, exact.summary.id);
    assert_eq!(store.search(lookup("café %_\" OR")).unwrap().total, 0);
    assert_eq!(store.search(lookup("不存在")).unwrap().total, 0);
    store.set_deleted(&exact.summary.id, 1, true).unwrap();
    assert_eq!(store.search(lookup(name)).unwrap().total, 0);
    store.set_deleted(&exact.summary.id, 2, false).unwrap();
    assert_eq!(store.search(lookup(name)).unwrap().total, 1);
    assert!(store.search(lookup("   ")).is_err());
    assert!(store.search(lookup(&"字".repeat(81))).is_err());
}

#[test]
fn library_search_chinese_short_chunks_and_metadata_cas() {
    let fixture = Fixture::new("modelCard");
    let mut store = fixture.store();
    let first = store.save(fixture.save_request()).unwrap();
    let second = store.save(fixture.save_request()).unwrap();
    assert_ne!(first.summary.id, second.summary.id);
    for query in ["杭", "西湖", "摄影 日落", "窗", "同名"] {
        let result = store
            .search(
                serde_json::from_value(
                    json!({"query":query,"sort":"relevance","offset":0,"limit":20}),
                )
                .unwrap(),
            )
            .unwrap();
        assert_eq!(result.total, 2, "{query}");
    }
    let mut metadata = first.summary.metadata.clone();
    metadata.name = "新的名字".into();
    store
        .update_metadata(&first.summary.id, 1, metadata.clone())
        .unwrap();
    assert!(store
        .update_metadata(&first.summary.id, 1, metadata)
        .is_err());
    store.set_deleted(&first.summary.id, 2, true).unwrap();
    let search = |query| {
        serde_json::from_value(json!({"query":query,"sort":"recent","offset":0,"limit":20}))
            .unwrap()
    };
    assert_eq!(store.search(search("新的名字")).unwrap().total, 0);
    store.set_deleted(&first.summary.id, 3, false).unwrap();
    assert_eq!(store.search(search("新的名字")).unwrap().total, 1);
    assert_eq!(store.search(search("\" OR *")).unwrap().total, 0);
}

#[test]
fn library_description_is_searchable_and_updates_fts_atomically() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let mut request = fixture.save_request();
    request.metadata.description = "穹顶预约 Zephyr".into();
    let material = store.save(request).unwrap();
    let search = |query| {
        serde_json::from_value(json!({
            "query":query,"sort":"relevance","offset":0,"limit":20
        }))
        .unwrap()
    };
    assert_eq!(store.search(search("zephyr")).unwrap().total, 1);
    assert_eq!(store.search(search("穹")).unwrap().total, 1);

    let mut metadata = material.summary.metadata.clone();
    metadata.description = "极光预约 Nimbus".into();
    store
        .update_metadata(&material.summary.id, 1, metadata)
        .unwrap();
    assert_eq!(store.search(search("zephyr")).unwrap().total, 0);
    assert_eq!(store.search(search("穹")).unwrap().total, 0);
    assert_eq!(store.search(search("nimbus")).unwrap().total, 1);
    assert_eq!(store.search(search("极")).unwrap().total, 1);
    for (word, expected) in [("\"zephyr\"", 0i64), ("\"nimbus\"", 1)] {
        let count: i64 = store
            .conn
            .query_row(
                "SELECT count(*) FROM material_fts WHERE material_fts MATCH ?1",
                [word],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, expected);
    }
}

#[test]
fn library_description_projection_rebuilds_old_generation() {
    let fixture = Fixture::new("modelCard");
    let mut store = fixture.store();
    let mut request = fixture.save_request();
    request.metadata.description = "nebulaonly".into();
    store.save(request).unwrap();
    store
        .conn
        .execute(
            "UPDATE material_search SET body_raw='legacy body',body_tokens='legacy body'",
            [],
        )
        .unwrap();
    store.conn.execute(
        "UPDATE library_meta SET value='jieba-0.8.1-default-search-nfc-v1' WHERE key='index_generation'", [],
    ).unwrap();
    drop(store);
    let store = fixture.store();
    let result = store
        .search(
            serde_json::from_value(json!({
                "query":"nebulaonly","sort":"relevance","offset":0,"limit":20
            }))
            .unwrap(),
        )
        .unwrap();
    assert_eq!(result.total, 1);
    let generation: String = store
        .conn
        .query_row(
            "SELECT value FROM library_meta WHERE key='index_generation'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(generation, search::GENERATION);
    assert_ne!(generation, "jieba-0.8.1-default-search-nfc-v1");
}

#[test]
fn library_contract_nfkc_search_preserves_display_and_rebuilds_nfc_generation() {
    let mut fixture = Fixture::new("imageGroup");
    fixture.plan["imageGroups"][0]["name"] = json!("ＣＡＮＯＮ Ｒ５");
    fixture.write_plan(&fixture.plan);
    let mut store = fixture.store();
    let mut request = fixture.save_request();
    request.metadata.name = "ＡＢＣ１２３".into();
    request.metadata.description = "３０ｍｍ镜头".into();
    request.metadata.tags = vec!["ＰＯＲＴＲＡＩＴ".into()];
    let material = store.save(request).unwrap();
    assert_eq!(material.summary.metadata.name, "ＡＢＣ１２３");
    assert_eq!(material.summary.metadata.description, "３０ｍｍ镜头");
    assert_eq!(material.summary.metadata.tags, ["ＰＯＲＴＲＡＩＴ"]);
    assert_eq!(material.payload.component["name"], json!("ＣＡＮＯＮ Ｒ５"));
    let search = |query| {
        serde_json::from_value(json!({
            "query":query,"sort":"relevance","offset":0,"limit":20
        }))
        .unwrap()
    };
    for query in ["abc123", "ＡＢＣ１２３", "portrait", "canon r5", "30mm"] {
        assert_eq!(store.search(search(query)).unwrap().total, 1, "{query}");
    }
    store
        .conn
        .execute_batch(
            "UPDATE material_search SET name_raw='ＡＢＣ１２３',name_tokens='ＡＢＣ１２３',
        tags_raw='ＰＯＲＴＲＡＩＴ',tags_tokens='ＰＯＲＴＲＡＩＴ',
        body_raw='ＣＡＮＯＮ Ｒ５ ３０ｍｍ镜头',body_tokens='ＣＡＮＯＮ Ｒ５ ３０ｍｍ 镜头';
        UPDATE library_meta SET value='jieba-0.8.1-default-search-nfc-description-v2'
        WHERE key='index_generation';",
        )
        .unwrap();
    drop(store);
    let store = fixture.store();
    for query in ["abc123", "portrait", "canon r5", "30mm"] {
        assert_eq!(store.search(search(query)).unwrap().total, 1, "{query}");
    }
    let generation: String = store
        .conn
        .query_row(
            "SELECT value FROM library_meta WHERE key='index_generation'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(generation, search::GENERATION);
    assert_ne!(generation, "jieba-0.8.1-default-search-nfc-description-v2");
}

#[test]
fn library_contract_crlf_free_text_roundtrips_but_names_and_tags_remain_control_free() {
    let mut fixture = Fixture::new("prop");
    fixture.plan["artifacts"][0]["source"] = json!("说明\r\n换行\t内容");
    fixture.write_plan(&fixture.plan);
    let mut request = fixture.save_request();
    request.metadata.description = "第一行\r\n第二行\t备注".into();
    let mut store = fixture.store();
    let material = store.save(request).unwrap();
    let loaded = store.get(&material.summary.id).unwrap();
    assert_eq!(
        loaded.summary.metadata.description,
        "第一行\r\n第二行\t备注"
    );
    assert_eq!(
        loaded.payload.component["source"],
        json!("说明\r\n换行\t内容")
    );
    let mut metadata = loaded.summary.metadata.clone();
    metadata.name = "bad\r\nname".into();
    assert!(store
        .update_metadata(&loaded.summary.id, 1, metadata)
        .is_err());
    let mut metadata = loaded.summary.metadata;
    metadata.tags = vec!["bad\rtag".into()];
    assert!(store
        .update_metadata(&material.summary.id, 1, metadata)
        .is_err());
}

#[test]
fn library_contract_schema_creation_and_version_roll_back_together_on_failure() {
    let fixture = Fixture::new("prop");
    let database = fixture.project.join("atomic-schema-test.db");
    let schema = include_str!("schema.sql");
    let interrupted = schema.replace(
        "PRAGMA user_version = 4;",
        "SELECT * FROM missing_library_schema_fixture;\nPRAGMA user_version = 4;",
    );
    assert_ne!(schema, interrupted);
    {
        let connection = rusqlite::Connection::open(&database).unwrap();
        assert!(connection.execute_batch(&interrupted).is_err());
    }
    let connection = rusqlite::Connection::open(&database).unwrap();
    let count: i64 = connection
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name='materials'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        count, 0,
        "An interrupted schema creation must not publish partial tables"
    );
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, 0);
    connection.execute_batch(schema).unwrap();
    assert!(connection.is_autocommit());
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, 4);
}

#[test]
fn library_rejects_stale_source_and_forged_payload_before_publication() {
    let fixture = Fixture::new("imageGroup");
    let mut store = fixture.store();
    let mut request = fixture.save_request();
    request.expected_plan["title"] = json!("stale");
    assert!(store.save(request).is_err());
    let mut request = fixture.save_request();
    request.snapshot.sources[0].file = "../outside.png".into();
    assert!(store.save(request).is_err());
    fs::remove_file(fixture.project.join("references").join("0001.png")).unwrap();
    assert!(store.save(fixture.save_request()).is_err());
}

#[test]
fn library_insert_accepts_the_first_row_without_changing_existing_document_content() {
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
        let prepared = store
            .prepare_insert(fixture.insert_request(&material))
            .unwrap();
        let mut next = fixture.next_plan(&prepared);
        let blocks = next["document"]["blocks"].as_array_mut().unwrap();
        let inserted = blocks.pop().unwrap();
        blocks.insert(0, inserted);
        assert_eq!(
            &blocks[1..],
            fixture.plan["document"]["blocks"].as_array().unwrap()
        );
        insert::commit(fixture.commit_request(&prepared, &next)).unwrap();
        assert_eq!(
            crate::plan::read_project_plan_in(&fixture.project).unwrap(),
            next
        );
    }
}

#[test]
fn library_insert_roundtrips_all_kinds_and_receipt_preserves_newer_plan_and_undo_files() {
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
        let request = fixture.insert_request(&material);
        let prepared = store.prepare_insert(request.clone()).unwrap();
        assert_eq!(store.prepare_insert(request).unwrap(), prepared);
        assert_eq!(
            crate::workspace::read_manifest(&fixture.project)
                .unwrap()
                .plan
                .as_ref(),
            Some(&fixture.plan)
        );
        assert_ne!(prepared.images[0].file, "references/0001.png");
        let copied = fixture
            .project
            .join(prepared.images[0].file.replace('/', "\\"));
        assert_eq!(fs::read(&copied).unwrap(), fixture.bytes);
        let next = fixture.next_plan(&prepared);
        let commit = fixture.commit_request(&prepared, &next);
        insert::commit(commit.clone()).unwrap();
        assert_eq!(
            insert::status(&commit.project_path, &commit.operation_id).unwrap(),
            models::MaterialInsertStatus::Committed
        );
        assert!(insert::abort(&commit.project_path, &commit.operation_id).is_err());
        let mut newer = next;
        newer["title"] = json!("later edit");
        crate::plan::save_project_plan_in(&fixture.project, newer.clone()).unwrap();
        insert::commit(commit).unwrap();
        assert_eq!(
            crate::plan::read_project_plan_in(&fixture.project).unwrap(),
            newer
        );
        crate::plan::save_project_plan_in(&fixture.project, fixture.plan.clone()).unwrap();
        assert_eq!(
            crate::plan::read_project_plan_in(&fixture.project).unwrap(),
            fixture.plan
        );
        assert_eq!(
            insert::status(fixture.project.to_str().unwrap(), &prepared.operation_id).unwrap(),
            models::MaterialInsertStatus::Committed
        );
        assert!(
            copied.exists(),
            "Undo must retain project references for redo"
        );
        assert_eq!(
            crate::plan::remove_reference_image_from(&fixture.project, &prepared.images[0].file)
                .unwrap(),
            crate::plan::ReferenceRemovalDisposition::RetainedForMaterialHistory
        );
        assert_eq!(
            crate::plan::remove_reference_image_from(
                &fixture.project,
                &prepared.images[0].file.replace('/', "\\")
            )
            .unwrap(),
            crate::plan::ReferenceRemovalDisposition::RetainedForMaterialHistory
        );
    }
}

#[test]
fn library_insert_closed_mutation_checks_and_conflict_do_not_overwrite_or_delete() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let prepared = store
        .prepare_insert(fixture.insert_request(&material))
        .unwrap();
    let next = fixture.next_plan(&prepared);
    for wrong in ["title", "image", "identity", "layout"] {
        let mut forged = next.clone();
        match wrong {
            "title" => forged["title"] = json!("Unrelated edit"),
            "image" => {
                forged["artifacts"][1]["gallery"]["images"][0]["file"] =
                    json!("references/0001.png")
            }
            "identity" => forged["artifacts"][1]["gallery"]["id"] = json!("collection"),
            _ => forged["artifacts"][1]["layout"] = json!({"widthRatio":1,"offsetRatio":0}),
        }
        assert!(
            insert::commit(fixture.commit_request(&prepared, &forged)).is_err(),
            "{wrong}"
        );
    }
    let mut concurrent = fixture.plan.clone();
    concurrent["title"] = json!("concurrent save");
    fixture.write_plan(&concurrent);
    let commit = fixture.commit_request(&prepared, &next);
    assert!(insert::commit(commit.clone()).is_err());
    assert_eq!(
        insert::status(&commit.project_path, &commit.operation_id).unwrap(),
        models::MaterialInsertStatus::Conflict
    );
    assert!(insert::abort(&commit.project_path, &commit.operation_id).is_err());
    assert!(crate::plan::read_project_plan_in(&fixture.project).is_err());
    for file in [&prepared.images[0].file[..], "references/0001.png"] {
        assert_eq!(
            crate::plan::remove_reference_image_from(&fixture.project, file)
                .unwrap_err()
                .code,
            "library_insert_conflict"
        );
    }
    assert_eq!(
        crate::workspace::read_manifest(&fixture.project)
            .unwrap()
            .plan
            .unwrap(),
        concurrent
    );
    assert!(fixture
        .project
        .join(prepared.images[0].file.replace('/', "\\"))
        .exists());
}

#[test]
fn library_reopen_recovers_interrupted_prepare_and_lost_commit_receipt() {
    let fixture = Fixture::new("clothing");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let prepared = store
        .prepare_insert(fixture.insert_request(&material))
        .unwrap();
    fixture.change_journal(&prepared.operation_id, "preparing", None);
    assert_eq!(
        crate::plan::read_project_plan_in(&fixture.project).unwrap(),
        fixture.plan
    );
    assert_eq!(
        insert::status(fixture.project.to_str().unwrap(), &prepared.operation_id).unwrap(),
        models::MaterialInsertStatus::Cancelled
    );
    assert!(!fixture
        .project
        .join(prepared.images[0].file.replace('/', "\\"))
        .exists());
    insert::abort(fixture.project.to_str().unwrap(), &prepared.operation_id).unwrap();

    let prepared = store
        .prepare_insert(fixture.insert_request(&material))
        .unwrap();
    let next = fixture.next_plan(&prepared);
    fixture.change_journal(&prepared.operation_id, "committing", Some(&next));
    fixture.write_plan(&next);
    assert_eq!(
        crate::plan::read_project_plan_in(&fixture.project).unwrap(),
        next
    );
    assert_eq!(
        insert::status(fixture.project.to_str().unwrap(), &prepared.operation_id).unwrap(),
        models::MaterialInsertStatus::Committed
    );
    insert::commit(fixture.commit_request(&prepared, &next)).unwrap();
}

#[test]
fn library_retry_interrupted_commit_before_manifest_and_abort_prepared() {
    let fixture = Fixture::new("shootingLocation");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let prepared = store
        .prepare_insert(fixture.insert_request(&material))
        .unwrap();
    let next = fixture.next_plan(&prepared);
    fixture.change_journal(&prepared.operation_id, "committing", Some(&next));
    insert::commit(fixture.commit_request(&prepared, &next)).unwrap();
    assert_eq!(
        crate::plan::read_project_plan_in(&fixture.project).unwrap(),
        next
    );
}

#[test]
fn library_failed_prepare_cleans_only_its_copies() {
    let mut fixture = Fixture::new("imageGroup");
    let mut second = fixture.plan["imageGroups"][0]["images"][0].clone();
    second["id"] = json!("second-image");
    second["file"] = json!("references/0002.png");
    fixture.plan["imageGroups"][0]["images"]
        .as_array_mut()
        .unwrap()
        .push(second);
    let mut png = Cursor::new(Vec::new());
    DynamicImage::new_rgb8(4, 3)
        .write_to(&mut png, ImageFormat::Png)
        .unwrap();
    fs::write(
        fixture.project.join("references").join("0002.png"),
        png.into_inner(),
    )
    .unwrap();
    fixture.write_plan(&fixture.plan);
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let missing = store
        .instance_path(material.images[1].storage_id.as_deref().unwrap(), &material.images[1].mime_type)
        .unwrap();
    fs::remove_file(missing).unwrap();
    let request = fixture.insert_request(&material);
    assert!(store.prepare_insert(request.clone()).is_err());
    assert_eq!(
        insert::status(&request.project_path, &request.operation_id).unwrap(),
        models::MaterialInsertStatus::Cancelled
    );
    assert_eq!(
        fs::read_dir(fixture.project.join("references"))
            .unwrap()
            .count(),
        2
    );
    assert_eq!(
        fs::read(fixture.project.join("references").join("0001.png")).unwrap(),
        fixture.bytes
    );
}

#[test]
fn library_preview_limits_magic_revision_and_state() {
    let fixture = Fixture::new("imageGroup");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let id = &material.summary.id;
    assert_eq!(store.load_preview(id, 1).unwrap(), None);
    store.mark_preview_failed(id, 1).unwrap();
    assert_eq!(
        store.get(id).unwrap().summary.preview_state,
        models::PreviewState::Failed
    );
    let preview = || models::MaterialPreviewInput {
        bytes: fixture.bytes.clone(),
        width: 3,
        height: 2,
        render_key: "v1-light".into(),
        is_partial: false,
    };
    assert!(store.save_preview(id, 2, preview()).is_err());
    let mut bad = preview();
    bad.width = 480;
    assert!(store.save_preview(id, 1, bad).is_err());
    let mut bad = preview();
    bad.bytes = b"not a PNG".to_vec();
    assert!(store.save_preview(id, 1, bad).is_err());
    store.save_preview(id, 1, preview()).unwrap();
    store.mark_preview_failed(id, 1).unwrap();
    assert_eq!(
        store.get(id).unwrap().summary.preview_state,
        models::PreviewState::Ready
    );
    assert!(store
        .load_preview(id, 1)
        .unwrap()
        .unwrap()
        .starts_with("data:image/png;base64,"));
}

#[test]
fn library_index_rebuild_and_transaction_rollback_leave_no_phantom_search_results() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    store.save(fixture.save_request()).unwrap();
    {
        let tx = store.conn.transaction().unwrap();
        tx.execute(
            "UPDATE material_search SET name_raw='phantom',name_tokens='phantom'",
            [],
        )
        .unwrap();
        // Drop without commit exercises the external-content FTS triggers' rollback.
    }
    let search = |query| {
        serde_json::from_value(json!({"query":query,"sort":"relevance","offset":0,"limit":20}))
            .unwrap()
    };
    assert_eq!(store.search(search("phantom")).unwrap().total, 0);
    store
        .conn
        .execute(
            "UPDATE library_meta SET value='obsolete-generation' WHERE key='index_generation'",
            [],
        )
        .unwrap();
    drop(store);
    let store = fixture.store();
    assert_eq!(store.search(search("西湖")).unwrap().total, 1);
    let generation: String = store
        .conn
        .query_row(
            "SELECT value FROM library_meta WHERE key='index_generation'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(generation, search::GENERATION);
}

#[test]
fn library_concurrent_metadata_compare_and_swap_has_one_winner() {
    let fixture = Fixture::new("modelCard");
    let material = fixture.store().save(fixture.save_request()).unwrap();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let handles: Vec<_> = (0..2)
        .map(|index| {
            let home = fixture.home.clone();
            let id = material.summary.id.clone();
            let mut metadata = material.summary.metadata.clone();
            metadata.name = format!("writer-{index}");
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                Store::open(&home)
                    .unwrap()
                    .update_metadata(&id, 1, metadata)
            })
        })
        .collect();
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert_eq!(
        fixture
            .store()
            .get(&material.summary.id)
            .unwrap()
            .summary
            .metadata_version,
        2
    );
}

#[test]
fn library_path_and_image_validation_rejects_traversal_aliases_and_wrong_magic() {
    let fixture = Fixture::new("imageGroup");
    let project = files::directory(&fixture.project).unwrap();
    for path in [
        "../0001.png",
        "references/../0001.png",
        "references\\0001.png",
        "references/0001.png:stream",
        "references//0001.png",
        "references/0001.png.",
        "C:\\private.png",
        "references/0001.gif",
        "references/CON.png",
        "references/LPT1.jpg",
    ] {
        assert!(files::reference(&project, path, false).is_err(), "{path}");
    }
    fs::write(
        fixture.project.join("references").join("0001.png"),
        b"not an image",
    )
    .unwrap();
    assert!(fixture.store().save(fixture.save_request()).is_err());
    let mut store = fixture.store();
    fs::write(
        fixture.project.join("references").join("0001.png"),
        &fixture.bytes,
    )
    .unwrap();
    let material = store.save(fixture.save_request()).unwrap();
    let path = store
        .instance_path(material.images[0].storage_id.as_deref().unwrap(), &material.images[0].mime_type)
        .unwrap();
    fs::write(path, b"changed").unwrap();
    assert!(store
        .load_image(&material.summary.id, 1, &material.images[0].local_image_id)
        .is_err());
}

#[test]
fn library_interrupted_staging_and_identical_foreign_filename_are_not_confused() {
    for foreign_exists in [false, true] {
        let fixture = Fixture::new("imageGroup");
        let mut store = fixture.store();
        let material = store.save(fixture.save_request()).unwrap();
        let prepared = store
            .prepare_insert(fixture.insert_request(&material))
            .unwrap();
        let path = fixture.journal_path(&prepared.operation_id);
        let mut journal: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        journal["phase"] = json!("preparing");
        journal["publishedCount"] = json!(0);
        journal["publishing"] = json!(foreign_exists);
        fs::write(&path, serde_json::to_vec(&journal).unwrap()).unwrap();
        let copy = fixture
            .project
            .join(prepared.images[0].file.replace('/', "\\"));
        if !foreign_exists {
            fs::remove_file(&copy).unwrap();
        }
        let staged = fixture
            .project
            .join(".preshot-library")
            .join(format!("{}.copy", prepared.operation_id));
        fs::write(
            &staged,
            if foreign_exists {
                fixture.bytes.as_slice()
            } else {
                b"interrupted partial bytes"
            },
        )
        .unwrap();
        assert_eq!(
            crate::plan::read_project_plan_in(&fixture.project).unwrap(),
            fixture.plan
        );
        assert!(!staged.exists());
        assert_eq!(
            copy.exists(),
            foreign_exists,
            "A failed no-replace publication cannot delete an identical foreign file"
        );
        assert_eq!(
            insert::status(fixture.project.to_str().unwrap(), &prepared.operation_id).unwrap(),
            models::MaterialInsertStatus::Cancelled
        );
    }
}

#[test]
fn library_hidden_legacy_images_are_disclosed_but_never_copied_and_empty_galleries_work() {
    let mut fixture = Fixture::new("clothing");
    fixture.plan["artifacts"][0]["tryOn"]["gallery"]["images"] =
        fixture.plan["artifacts"][0]["mainGallery"]["images"].clone();
    fixture.plan["artifacts"][0]["tryOn"]["gallery"]["images"][0]["file"] =
        json!("references/missing-hidden.png");
    fixture.plan["artifacts"][0]["tryOn"]["gallery"]["images"][0]["id"] = json!("hidden-image");
    fixture.plan["artifacts"][0]["mainGallery"]["images"] = json!([]);
    fixture.write_plan(&fixture.plan);
    let request = fixture.save_request();
    assert_eq!(request.snapshot.omitted_legacy_images, 1);
    let mut store = fixture.store();
    let material = store.save(request).unwrap();
    assert_eq!(material.summary.image_count, 0);
    let prepared = store
        .prepare_insert(fixture.insert_request(&material))
        .unwrap();
    assert!(prepared.images.is_empty());
    let next = fixture.next_plan(&prepared);
    insert::commit(fixture.commit_request(&prepared, &next)).unwrap();
}

#[test]
fn library_operation_receipt_rejects_id_reuse_and_metadata_is_normalized() {
    let fixture = Fixture::new("imageGroup");
    let mut store = fixture.store();
    let mut request = fixture.save_request();
    request.metadata.name = "  Cafe\u{301}  ".into();
    request.metadata.tags = vec![
        "  摄影 ".into(),
        "摄影".into(),
        "Portrait".into(),
        "portrait".into(),
    ];
    let saved = store.save(request.clone()).unwrap();
    assert_eq!(saved.summary.metadata.name, "Café");
    assert_eq!(saved.summary.metadata.tags, ["摄影", "Portrait"]);
    request.metadata.name = "different".into();
    assert!(store.save(request).is_err());
    let mut bad = fixture.save_request();
    bad.metadata.name = "line\nbreak".into();
    assert!(store.save(bad).is_err());
}

#[cfg(windows)]
#[test]
fn library_rejects_contained_directory_junctions() {
    let fixture = Fixture::new("imageGroup");
    let original = fixture.project.join("references");
    let relocated = fixture.project.join("original-references");
    fs::rename(&original, &relocated).unwrap();
    let output = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(original.canonicalize().unwrap_or(original.clone()))
        .arg(relocated.canonicalize().unwrap())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let project = files::directory(&fixture.project).unwrap();
    assert!(files::reference(&project, "references/0001.png", true).is_err());
    assert!(fixture.store().save(fixture.save_request()).is_err());
    fs::remove_dir(original).unwrap();
}

#[test]
#[ignore = "Worker invoked only by the cross-process locking regression"]
fn library_lock_worker() {
    let home = std::env::var_os("PRESHOT_LIBRARY_LOCK_TEST_HOME").expect("isolated test home");
    let home = PathBuf::from(home);
    let _store = Store::open(&home).unwrap();
    fs::write(home.join("worker-done"), b"done").unwrap();
}

#[test]
fn library_lock_is_exclusive_across_processes() {
    let fixture = Fixture::new("imageGroup");
    let store = fixture.store();
    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "library::tests::library_lock_worker",
            "--ignored",
            "--quiet",
        ])
        .env(
            "PRESHOT_LIBRARY_LOCK_TEST_HOME",
            fixture.home.canonicalize().unwrap(),
        )
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(150));
    assert!(child.try_wait().unwrap().is_none());
    assert!(!fixture.home.join("worker-done").exists());
    drop(store);
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(fixture.home.join("worker-done").exists());
}

#[test]
fn library_regular_import_reconciles_interrupted_filename_reservation_first() {
    let fixture = Fixture::new("imageGroup");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let prepared = store
        .prepare_insert(fixture.insert_request(&material))
        .unwrap();
    let path = fixture.journal_path(&prepared.operation_id);
    let mut journal: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    journal["phase"] = json!("preparing");
    journal["publishedCount"] = json!(0);
    journal["publishing"] = json!(true);
    fs::write(path, serde_json::to_vec(&journal).unwrap()).unwrap();
    fs::remove_file(
        fixture
            .project
            .join(prepared.images[0].file.replace('/', "\\")),
    )
    .unwrap();
    let imported = crate::plan::import_reference_image_into(
        &fixture.project,
        &fixture.project.join("references").join("0001.png"),
    )
    .unwrap();
    assert_eq!(imported.file, prepared.images[0].file);
    assert_eq!(
        insert::status(fixture.project.to_str().unwrap(), &prepared.operation_id).unwrap(),
        models::MaterialInsertStatus::Cancelled
    );
    crate::plan::read_project_plan_in(&fixture.project).unwrap();
    assert_eq!(
        fs::read(fixture.project.join(imported.file.replace('/', "\\"))).unwrap(),
        fixture.bytes
    );
}

#[test]
fn library_committed_receipt_rejects_changed_project_identity() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let prepared = store
        .prepare_insert(fixture.insert_request(&material))
        .unwrap();
    let next = fixture.next_plan(&prepared);
    let commit = fixture.commit_request(&prepared, &next);
    insert::commit(commit.clone()).unwrap();
    let path = fixture.project.join(".preshotproj");
    let mut manifest: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    manifest["id"] = json!(Uuid::new_v4().to_string());
    fs::write(path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    assert!(insert::commit(commit.clone()).is_err());
    assert_eq!(
        insert::status(&commit.project_path, &commit.operation_id).unwrap(),
        models::MaterialInsertStatus::Conflict
    );
}

#[test]
fn library_sql_failure_does_not_publish_material_receipt_or_search_projection() {
    let fixture = Fixture::new("imageGroup");
    let mut store = fixture.store();
    store
        .conn
        .execute_batch(
            "CREATE TRIGGER fail_test_projection BEFORE INSERT ON material_search
        BEGIN SELECT RAISE(ABORT,'injected index failure'); END;",
        )
        .unwrap();
    let request = fixture.save_request();
    assert!(store.save(request.clone()).is_err());
    for table in [
        "materials",
        "material_images",
        "save_receipts",
        "material_search",
        "blobs",
    ] {
        let count: i64 = store
            .conn
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0, "{table}");
    }
    store
        .conn
        .execute_batch("DROP TRIGGER fail_test_projection;")
        .unwrap();
    assert!(store.save(request).is_ok());
}

#[test]
fn library_unavailable_database_does_not_break_project_loading() {
    let fixture = Fixture::new("imageGroup");
    fs::create_dir_all(fixture.home.join("library")).unwrap();
    fs::write(
        fixture.home.join("library").join("library.db"),
        b"not a SQLite database",
    )
    .unwrap();
    assert!(Store::open(&fixture.home).is_err());
    assert_eq!(
        crate::plan::read_project_plan_in(&fixture.project).unwrap(),
        fixture.plan
    );
    assert!(!fixture.home.join("agent.db").exists());
}

#[test]
fn library_prepared_copy_pins_payload_after_material_is_trashed() {
    let fixture = Fixture::new("modelCard");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let prepared = store
        .prepare_insert(fixture.insert_request(&material))
        .unwrap();
    store.set_deleted(&material.summary.id, 1, true).unwrap();
    assert!(store
        .prepare_insert(fixture.insert_request(&material))
        .is_err());
    let next = fixture.next_plan(&prepared);
    insert::commit(fixture.commit_request(&prepared, &next)).unwrap();
    assert_eq!(
        crate::plan::read_project_plan_in(&fixture.project).unwrap(),
        next
    );
}

#[test]
fn library_corrupt_storage_errors_do_not_echo_content_or_paths() {
    let secret = r"PRIVATE_COMPONENT_BODY C:\private\photo.png";
    for damaged in ["journal", "database", "manifest"] {
        let fixture = Fixture::new("imageGroup");
        let mut store = fixture.store();
        let material = store.save(fixture.save_request()).unwrap();
        let prepared = store
            .prepare_insert(fixture.insert_request(&material))
            .unwrap();
        let error =
            if damaged == "database" {
                store.conn.execute(
                "UPDATE materials SET detail_json=json_set(detail_json,'$.previewState',?1)",
                [secret],
            ).unwrap();
                store.get(&material.summary.id).unwrap_err()
            } else {
                let path = if damaged == "journal" {
                    fixture.journal_path(&prepared.operation_id)
                } else {
                    fixture.project.join(".preshotproj")
                };
                let mut data: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
                data[if damaged == "journal" {
                    "phase"
                } else {
                    "schemaVersion"
                }] = json!(secret);
                fs::write(path, serde_json::to_vec(&data).unwrap()).unwrap();
                insert::status(fixture.project.to_str().unwrap(), &prepared.operation_id)
                    .unwrap_err()
            };
        assert!(
            !error.message.contains("PRIVATE_COMPONENT_BODY"),
            "{damaged}"
        );
        assert!(!error.message.contains("private"), "{damaged}");
    }
}

#[test]
fn library_missing_operation_has_explicit_status_code_and_abort_is_idempotent() {
    let fixture = Fixture::new("prop");
    let operation = Uuid::new_v4().to_string();
    assert_eq!(
        insert::status(fixture.project.to_str().unwrap(), &operation)
            .unwrap_err()
            .code,
        "library_operation_not_found"
    );
    insert::abort(fixture.project.to_str().unwrap(), &operation).unwrap();
    insert::abort(fixture.project.to_str().unwrap(), &operation).unwrap();
}

#[test]
fn library_abort_lost_prepare_response_works_without_database_and_cancelled_manifest() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let prepared = store
        .prepare_insert(fixture.insert_request(&material))
        .unwrap();
    drop(store);
    fs::write(
        fixture.home.join("library").join("library.db"),
        b"unavailable database",
    )
    .unwrap();
    assert!(Store::open(&fixture.home).is_err());
    insert::abort(fixture.project.to_str().unwrap(), &prepared.operation_id).unwrap();
    assert!(!fixture
        .project
        .join(prepared.images[0].file.replace('/', "\\"))
        .exists());
    assert!(fixture.project.join("references").join("0001.png").exists());
    fs::remove_file(fixture.project.join(".preshotproj")).unwrap();
    insert::abort(fixture.project.to_str().unwrap(), &prepared.operation_id).unwrap();
}

#[test]
fn library_terminal_receipts_do_not_require_retired_reference_directories() {
    let fixture = Fixture::new("imageGroup");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let prepared = store
        .prepare_insert(fixture.insert_request(&material))
        .unwrap();
    let next = fixture.next_plan(&prepared);
    insert::commit(fixture.commit_request(&prepared, &next)).unwrap();
    crate::plan::save_project_plan_in(&fixture.project, fixture.plan.clone()).unwrap();
    fs::remove_dir_all(fixture.project.join("references")).unwrap();
    assert_eq!(
        crate::plan::read_project_plan_in(&fixture.project).unwrap(),
        fixture.plan
    );
}

#[test]
fn library_reference_removal_returns_retention_after_plan_save_and_removes_ordinary_images() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let prepared = store
        .prepare_insert(fixture.insert_request(&material))
        .unwrap();
    let mut next = fixture.next_plan(&prepared);
    insert::commit(fixture.commit_request(&prepared, &next)).unwrap();
    next["artifacts"][1]["gallery"]["images"] = json!([]);
    next["artifacts"][0]["gallery"]["images"] = json!([]);
    crate::plan::save_project_plan_in(&fixture.project, next.clone()).unwrap();

    let disposition =
        crate::plan::remove_reference_image_from(&fixture.project, &prepared.images[0].file)
            .unwrap();
    assert_eq!(
        serde_json::to_value(disposition).unwrap(),
        json!("retainedForMaterialHistory")
    );
    assert_eq!(
        fs::read(
            fixture
                .project
                .join(prepared.images[0].file.replace('/', "\\"))
        )
        .unwrap(),
        fixture.bytes
    );
    assert_eq!(
        crate::plan::read_project_plan_in(&fixture.project).unwrap(),
        next
    );

    let disposition =
        crate::plan::remove_reference_image_from(&fixture.project, "references/0001.png").unwrap();
    assert_eq!(serde_json::to_value(disposition).unwrap(), json!("removed"));
    assert!(!fixture.project.join("references").join("0001.png").exists());
}

#[test]
fn library_regular_save_cancels_prepared_insert_before_image_removal_changes_base() {
    let fixture = Fixture::new("prop");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let prepared = store
        .prepare_insert(fixture.insert_request(&material))
        .unwrap();
    let stale_next = fixture.next_plan(&prepared);
    let mut edited = fixture.plan.clone();
    edited["title"] = json!("normal edit supersedes insertion");
    edited["artifacts"][0]["gallery"]["images"] = json!([]);
    crate::plan::save_project_plan_in(&fixture.project, edited.clone()).unwrap();
    assert_eq!(
        crate::plan::remove_reference_image_from(&fixture.project, "references/0001.png").unwrap(),
        crate::plan::ReferenceRemovalDisposition::Removed
    );
    assert_eq!(
        insert::status(fixture.project.to_str().unwrap(), &prepared.operation_id).unwrap(),
        models::MaterialInsertStatus::Cancelled
    );
    assert!(!fixture
        .project
        .join(prepared.images[0].file.replace('/', "\\"))
        .exists());
    assert!(!fixture.project.join("references").join("0001.png").exists());
    assert_eq!(
        crate::plan::read_project_plan_in(&fixture.project).unwrap(),
        edited
    );
    assert!(insert::commit(fixture.commit_request(&prepared, &stale_next)).is_err());
    assert_eq!(
        insert::status(fixture.project.to_str().unwrap(), &prepared.operation_id).unwrap(),
        models::MaterialInsertStatus::Cancelled
    );
    assert_eq!(
        crate::plan::read_project_plan_in(&fixture.project).unwrap(),
        edited
    );
}

#[test]
fn library_cancelled_receipt_does_not_retain_a_later_ordinary_import() {
    let fixture = Fixture::new("imageGroup");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let prepared = store
        .prepare_insert(fixture.insert_request(&material))
        .unwrap();
    insert::abort(fixture.project.to_str().unwrap(), &prepared.operation_id).unwrap();
    let imported = crate::plan::import_reference_image_into(
        &fixture.project,
        &fixture.project.join("references").join("0001.png"),
    )
    .unwrap();
    assert_eq!(imported.file, prepared.images[0].file);
    let disposition =
        crate::plan::remove_reference_image_from(&fixture.project, &imported.file).unwrap();
    assert_eq!(serde_json::to_value(disposition).unwrap(), json!("removed"));
    assert!(!fixture
        .project
        .join(imported.file.replace('/', "\\"))
        .exists());
}

#[test]
fn library_preview_partial_is_exposed_in_detail_and_search_json() {
    let fixture = Fixture::new("imageGroup");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    assert!(serde_json::to_value(&material)
        .unwrap()
        .get("previewPartial")
        .is_none());
    for partial in [true, false] {
        store
            .save_preview(
                &material.summary.id,
                1,
                models::MaterialPreviewInput {
                    bytes: fixture.bytes.clone(),
                    width: 3,
                    height: 2,
                    render_key: "partial-wire-test".into(),
                    is_partial: partial,
                },
            )
            .unwrap();
        let detail = store.get(&material.summary.id).unwrap();
        assert_eq!(detail.summary.preview_partial, Some(partial));
        assert_eq!(
            serde_json::to_value(detail).unwrap()["previewPartial"],
            json!(partial)
        );
        let result = store
            .search(
                serde_json::from_value(json!({
                    "query":"","sort":"recent","offset":0,"limit":10
                }))
                .unwrap(),
            )
            .unwrap();
        assert_eq!(
            serde_json::to_value(result).unwrap()["items"][0]["previewPartial"],
            json!(partial)
        );
    }
}

#[test]
fn library_tall_component_preview_uses_480_width_and_8192_height_caps() {
    use base64::Engine as _;

    let fixture = Fixture::new("imageGroup");
    let mut store = fixture.store();
    let material = store.save(fixture.save_request()).unwrap();
    let png = |width, height| {
        let mut encoded = Cursor::new(Vec::new());
        DynamicImage::new_rgb8(width, height)
            .write_to(&mut encoded, ImageFormat::Png)
            .unwrap();
        encoded.into_inner()
    };
    for (height, explicitly_partial) in [(533, false), (1000, true)] {
        let bytes = png(480, height);
        assert_eq!(
            files::image_info(&bytes, true).unwrap(),
            ("image/png", 480, height)
        );
        store
            .save_preview(
                &material.summary.id,
                1,
                models::MaterialPreviewInput {
                    bytes: bytes.clone(),
                    width: 480,
                    height,
                    render_key: "tall-component-preview".into(),
                    is_partial: explicitly_partial,
                },
            )
            .unwrap();
        let loaded = store
            .load_preview(&material.summary.id, 1)
            .unwrap()
            .unwrap();
        assert_eq!(
            STANDARD
                .decode(loaded.strip_prefix("data:image/png;base64,").unwrap())
                .unwrap(),
            bytes
        );
        assert_eq!(
            store
                .get(&material.summary.id)
                .unwrap()
                .summary
                .preview_partial,
            Some(explicitly_partial)
        );
    }
    assert!(files::image_info(&png(481, 1), true).is_err());
    assert!(files::image_info(&png(1, 8193), true).is_err());
}
