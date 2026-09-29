use std::collections::HashSet;

use serde_json::{json, Map, Value};
use unicode_normalization::UnicodeNormalization;

use super::{error, insert_selection, models::*, Result};

pub fn metadata(mut value: MaterialMetadata) -> Result<MaterialMetadata> {
    value.name = material_name(&value.name)?;
    value.description = value.description.nfc().collect();
    text(&value.description, 1000, true)?;
    if value.tags.len() > 12 {
        return Err(error("metadata", "At most 12 tags are supported"));
    }
    let mut seen = HashSet::new();
    let mut tags = Vec::new();
    for tag in value.tags {
        let tag: String = tag.trim().nfc().collect();
        text(&tag, 24, false)?;
        if tag.chars().any(char::is_control) {
            return Err(error("metadata", "Tags cannot contain control characters"));
        }
        if seen.insert(normalized(&tag)) {
            tags.push(tag);
        }
    }
    value.tags = tags;
    Ok(value)
}

pub fn material_name(value: &str) -> Result<String> {
    let name: String = value.trim().nfc().collect();
    text(&name, 80, false)?;
    if name.chars().any(char::is_control) {
        return Err(error(
            "metadata",
            "Material names cannot contain control characters",
        ));
    }
    Ok(name)
}

pub fn normalized(value: &str) -> String {
    value.nfkc().collect::<String>().to_lowercase()
}

fn text(value: &str, limit: usize, empty: bool) -> Result<()> {
    if (!empty && value.is_empty())
        || value.chars().count() > limit
        || value
            .chars()
            .any(|c| c.is_control() && c != '\r' && c != '\n' && c != '\t')
    {
        return Err(error(
            "validation",
            "Text is empty, too long, or contains control characters",
        ));
    }
    Ok(())
}

fn identifier(value: &str) -> Result<()> {
    if value.is_empty() || value.chars().count() > 128 || value.chars().any(char::is_control) {
        return Err(error("validation", "Invalid local identifier"));
    }
    Ok(())
}

pub(super) fn local_image_identifier(value: &str) -> Result<()> {
    identifier(value)?;
    if !value.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_')) {
        return Err(error("validation", "Local image identifiers must be portable ASCII identifiers"));
    }
    Ok(())
}

fn object<'a>(
    value: &'a Value,
    required: &[&str],
    optional: &[&str],
) -> Result<&'a Map<String, Value>> {
    let object = value
        .as_object()
        .ok_or_else(|| error("validation", "Expected an object"))?;
    if required.iter().any(|key| !object.contains_key(*key))
        || object
            .keys()
            .any(|key| !required.contains(&key.as_str()) && !optional.contains(&key.as_str()))
    {
        return Err(error(
            "validation",
            "Unsupported or missing component field",
        ));
    }
    Ok(object)
}

fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| error("validation", format!("Expected text field {key}")))
}

fn array<'a>(value: &'a Value, key: &str) -> Result<&'a Vec<Value>> {
    value
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| error("validation", format!("Expected array {key}")))
}

fn numeric(value: &Value, key: &str, positive: bool) -> Result<()> {
    if !value[key]
        .as_f64()
        .is_some_and(|n| n.is_finite() && (!positive || n > 0.0))
    {
        return Err(error("validation", format!("Invalid image number {key}")));
    }
    Ok(())
}

pub fn payload_images(payload: &MaterialPayload) -> Result<&Vec<Value>> {
    let c = &payload.component;
    match payload.kind {
        MaterialKind::Image | MaterialKind::ImageGroup => array(c, "images"),
        MaterialKind::ShootingLocation | MaterialKind::Prop => array(&c["gallery"], "images"),
        MaterialKind::ModelCard => array(&c["samples"], "images"),
        MaterialKind::Clothing => array(&c["mainGallery"], "images"),
    }
}

fn image(value: &Value) -> Result<()> {
    object(
        value,
        &["localImageId", "aspectRatio", "frameWidth", "frameHeight"],
        &[
            "caption",
            "sourceWidth",
            "sourceHeight",
            "frameOffsetX",
            "frameOffsetY",
            "fitMode",
            "crop",
        ],
    )?;
    local_image_identifier(string(value, "localImageId")?)?;
    for key in ["aspectRatio", "frameWidth", "frameHeight"] {
        numeric(value, key, true)?;
    }
    for key in [
        "sourceWidth",
        "sourceHeight",
        "frameOffsetX",
        "frameOffsetY",
    ] {
        if value.get(key).is_some() {
            numeric(value, key, key.starts_with("source"))?;
        }
    }
    for key in ["sourceWidth", "sourceHeight"] {
        if value.get(key).is_some() && value[key].as_f64().unwrap().fract() != 0.0 {
            return Err(error(
                "validation",
                "Source image dimensions must be integers",
            ));
        }
    }
    if let Some(caption) = value.get("caption") {
        text(
            caption
                .as_str()
                .ok_or_else(|| error("validation", "Invalid caption"))?,
            200_000,
            true,
        )?;
    }
    if value.get("fitMode").is_some()
        && !matches!(value["fitMode"].as_str(), Some("cover" | "stretch"))
    {
        return Err(error("validation", "Invalid image fit mode"));
    }
    if let Some(crop) = value.get("crop") {
        object(crop, &["x", "y", "width", "height"], &[])?;
        for key in ["x", "y", "width", "height"] {
            numeric(crop, key, key == "width" || key == "height")?;
        }
        let x = crop["x"].as_f64().unwrap();
        let y = crop["y"].as_f64().unwrap();
        if x < 0.0
            || y < 0.0
            || x + crop["width"].as_f64().unwrap() > 1.000001
            || y + crop["height"].as_f64().unwrap() > 1.000001
        {
            return Err(error("validation", "Crop is outside the image"));
        }
    }
    Ok(())
}

pub fn payload(value: &MaterialPayload) -> Result<()> {
    if value.format != "preshot-material"
        || value.version != 1
        || string(&value.component, "kind")? != value.kind.as_str()
        || serde_json::to_vec(value)
            .map_err(|e| error("validation", e))?
            .len()
            > 1024 * 1024
    {
        return Err(error("payload", "Unsupported material payload"));
    }
    let (fields, optional, strings, collection): (&[&str], &[&str], &[&str], Option<&str>) =
        match value.kind {
            MaterialKind::Image | MaterialKind::ImageGroup => (
                &["kind", "name", "description", "images"],
                &[],
                &["name", "description"],
                None,
            ),
            MaterialKind::ShootingLocation => (
                &["kind", "venueName", "address", "description", "gallery"],
                &[],
                &["venueName", "address", "description"],
                Some("gallery"),
            ),
            MaterialKind::ModelCard => (
                &[
                    "kind", "modelId", "heightCm", "weightKg", "shoeSize", "samples",
                ],
                &["notes"],
                &["modelId", "shoeSize"],
                Some("samples"),
            ),
            MaterialKind::Prop => (
                &["kind", "title", "source", "gallery"],
                &[],
                &["title", "source"],
                Some("gallery"),
            ),
            MaterialKind::Clothing => (
                &["kind", "title", "source", "mainGallery"],
                &[],
                &["title", "source"],
                Some("mainGallery"),
            ),
        };
    object(&value.component, fields, optional)?;
    for key in strings {
        text(string(&value.component, key)?, 200_000, true)?;
    }
    if let Some(notes) = value.component.get("notes") {
        text(
            notes
                .as_str()
                .ok_or_else(|| error("validation", "Invalid notes"))?,
            200_000,
            true,
        )?;
    }
    if value.kind == MaterialKind::ModelCard {
        for key in ["heightCm", "weightKg"] {
            if !value.component[key].is_null() {
                numeric(&value.component, key, true)?;
            }
            if value.kind != MaterialKind::ImageGroup {
                let key = match value.kind {
                    MaterialKind::ShootingLocation => "venueName",
                    MaterialKind::ModelCard => "modelId",
                    _ => "title",
                };
                let title = string(&value.component, key)?;
                if title.trim().is_empty() || title.trim() != title {
                    return Err(error(
                        "validation",
                        "Artifact titles must be nonempty trimmed text",
                    ));
                }
            }
        }
    }
    if let Some(key) = collection {
        object(&value.component[key], &["images"], &[])?;
    }
    let images = payload_images(value)?;
    if value.kind == MaterialKind::Image && images.len() > 1 {
        return Err(error("image_count", "An image material can contain only one image"));
    }
    if images.len() > 128 {
        return Err(error(
            "payload",
            "At most 128 images per material are supported",
        ));
    }
    let mut ids = HashSet::new();
    for value in images {
        image(value)?;
        if !ids.insert(string(value, "localImageId")?) {
            return Err(error("payload", "Duplicate local image identifier"));
        }
    }
    Ok(())
}

pub fn plan(value: &Value) -> Result<()> {
    object(
        value,
        &[
            "schemaVersion",
            "title",
            "document",
            "imageGroups",
            "artifacts",
        ],
        &[],
    )?;
    let active = value["schemaVersion"] == 16 && value["document"]["version"] == 4;
    let legacy = value["schemaVersion"] == 15 && value["document"]["version"] == 3;
    if (!active && !legacy) || value["document"]["format"] != "preshot-blocks"
    {
        return Err(error(
            "plan",
            "Library operations require a supported v16 or legacy v15 plan",
        ));
    }
    object(&value["document"], &["format", "version", "blocks"], &[])?;
    string(value, "title")?;
    array(&value["document"], "blocks")?;
    array(value, "imageGroups")?;
    array(value, "artifacts")?;
    crate::column_document::validate(&value["document"], active).map_err(|e| error("plan", e))?;
    if serde_json::to_vec(value)
        .map_err(|e| error("plan", e))?
        .len()
        > 32 * 1024 * 1024
    {
        return Err(error("plan", "Project plan exceeds its safe journal limit"));
    }
    Ok(())
}

fn find_blocks<'a>(blocks: &'a [Value], id: &str, found: &mut Vec<&'a Value>) -> Result<()> {
    for block in blocks {
        if block["id"] == id {
            found.push(block);
        }
        if let Some(children) = block.get("children") {
            let children = children
                .as_array()
                .ok_or_else(|| error("plan", "Invalid document children"))?;
            find_blocks(children, id, found)?;
        }
    }
    Ok(())
}

pub fn snapshot_from_plan(
    plan_value: &Value,
    block_id: &str,
) -> Result<(MaterialPayload, Vec<MaterialImageSource>, u32)> {
    plan(plan_value)?;
    let mut found = Vec::new();
    find_blocks(
        array(&plan_value["document"], "blocks")?,
        block_id,
        &mut found,
    )?;
    if found.len() != 1 {
        return Err(error(
            "source",
            "Select one uniquely owned component",
        ));
    }
    let block = found[0];
    if block
        .get("children")
        .is_some_and(|v| v.as_array().is_none_or(|children| !children.is_empty()))
    {
        return Err(error(
            "source",
            "A material cannot contain nested document blocks",
        ));
    }
    let kind: MaterialKind = serde_json::from_value(block["type"].clone())
        .map_err(|_| error("source", "Unsupported selected block"))?;
    let (sidecars, prop) = if kind == MaterialKind::ImageGroup {
        ("imageGroups", "groupId")
    } else {
        ("artifacts", "artifactId")
    };
    let source_id = string(&block["props"], prop)?;
    fn count_marker_uses(blocks: &[Value], key: &str, id: &str) -> usize {
        blocks
            .iter()
            .map(|block| {
                usize::from(block["props"][key] == id)
                    + block["children"]
                        .as_array()
                        .map(|children| count_marker_uses(children, key, id))
                        .unwrap_or(0)
            })
            .sum()
    }
    if count_marker_uses(array(&plan_value["document"], "blocks")?, prop, source_id) != 1 {
        return Err(error(
            "source",
            "Selected sidecar must belong to exactly one document marker",
        ));
    }
    let matches: Vec<_> = array(plan_value, sidecars)?
        .iter()
        .filter(|s| s["id"] == source_id)
        .collect();
    if matches.len() != 1 {
        return Err(error(
            "source",
            "Selected component sidecar is missing or ambiguous",
        ));
    }
    let sidecar = matches[0];
    if (kind == MaterialKind::ImageGroup && sidecar["type"] != "reference")
        || (kind != MaterialKind::ImageGroup && sidecar["kind"] != kind.as_str())
    {
        return Err(error(
            "source",
            "Component kind does not match selected block",
        ));
    }
    let fields: &[&str] = match kind {
        MaterialKind::Image | MaterialKind::ImageGroup => &["name", "description", "images"],
        MaterialKind::ShootingLocation => &["venueName", "address", "description", "gallery"],
        MaterialKind::ModelCard => &[
            "modelId", "heightCm", "weightKg", "shoeSize", "notes", "samples",
        ],
        MaterialKind::Prop => &["title", "source", "gallery"],
        MaterialKind::Clothing => &["title", "source", "mainGallery"],
    };
    let mut component = Map::new();
    component.insert("kind".into(), json!(kind));
    for key in fields {
        if let Some(value) = sidecar.get(*key) {
            component.insert((*key).into(), value.clone());
        }
    }
    let images = match kind {
        MaterialKind::Image | MaterialKind::ImageGroup => component.get_mut("images"),
        _ => {
            let key = match kind {
                MaterialKind::ModelCard => "samples",
                MaterialKind::Clothing => "mainGallery",
                _ => "gallery",
            };
            let collection = component
                .get_mut(key)
                .and_then(Value::as_object_mut)
                .ok_or_else(|| error("source", "Missing image collection"))?;
            collection.remove("id");
            collection.get_mut("images")
        }
    }
    .and_then(Value::as_array_mut)
    .ok_or_else(|| error("source", "Missing component images"))?;
    let mut sources = Vec::new();
    for (index, image) in images.iter_mut().enumerate() {
        let image = image
            .as_object_mut()
            .ok_or_else(|| error("source", "Invalid source image"))?;
        let file = image
            .remove("file")
            .and_then(|v| v.as_str().map(str::to_owned))
            .ok_or_else(|| error("source", "Missing source image file"))?;
        image
            .remove("id")
            .ok_or_else(|| error("source", "Missing source image id"))?;
        let local_image_id = format!("image-{}", index + 1);
        image.insert("localImageId".into(), json!(local_image_id));
        sources.push(MaterialImageSource {
            local_image_id,
            file,
        });
    }
    let result = MaterialPayload {
        format: "preshot-material".into(),
        version: 1,
        kind,
        component: Value::Object(component),
    };
    payload(&result)?;
    let omitted = if result.kind == MaterialKind::Clothing {
        array(&sidecar["tryOn"]["gallery"], "images")?.len() as u32
    } else {
        0
    };
    Ok((result, sources, omitted))
}

pub fn snapshot(plan_value: &Value, input: &MaterialSnapshot) -> Result<()> {
    if input.payload.kind == MaterialKind::Image { return super::image_material::snapshot(plan_value, input); }
    payload(&input.payload)?;
    let (mut expected, expected_sources, omitted) =
        snapshot_from_plan(plan_value, &input.source_block_id)?;
    if input.sources.len() != expected_sources.len() || omitted != input.omitted_legacy_images {
        return Err(error(
            "source",
            "Snapshot does not disclose exactly the selected component images",
        ));
    }
    let images = payload_images(&input.payload)?;
    let expected_images = match expected.kind {
        MaterialKind::Image | MaterialKind::ImageGroup => &mut expected.component["images"],
        MaterialKind::ModelCard => &mut expected.component["samples"]["images"],
        MaterialKind::Clothing => &mut expected.component["mainGallery"]["images"],
        _ => &mut expected.component["gallery"]["images"],
    }
    .as_array_mut()
    .unwrap();
    for ((portable, expected_image), source) in
        images.iter().zip(expected_images).zip(expected_sources)
    {
        let id = string(portable, "localImageId")?;
        let mapped: Vec<_> = input
            .sources
            .iter()
            .filter(|s| s.local_image_id == id)
            .collect();
        if mapped.len() != 1 || mapped[0].file != source.file {
            return Err(error(
                "source",
                "Snapshot image mapping does not belong to the selected component",
            ));
        }
        expected_image["localImageId"] = json!(id);
    }
    if expected != input.payload {
        return Err(error(
            "source",
            "Snapshot does not match committed component content",
        ));
    }
    Ok(())
}

pub(super) fn collect_ids(value: &Value, ids: &mut HashSet<String>) {
    match value {
        Value::Object(object) => {
            if let Some(id) = object.get("id").and_then(Value::as_str) {
                ids.insert(id.to_owned());
            }
            for value in object.values() {
                collect_ids(value, ids);
            }
        }
        Value::Array(array) => {
            for value in array {
                collect_ids(value, ids);
            }
        }
        _ => (),
    }
}

pub(super) fn fresh_ids(value: &Value, ids: &mut HashSet<String>) -> Result<()> {
    match value {
        Value::Object(object) => {
            if let Some(id) = object.get("id") {
                let id = id
                    .as_str()
                    .ok_or_else(|| error("insert", "Invalid inserted identifier"))?;
                identifier(id)?;
                if !ids.insert(id.to_owned()) {
                    return Err(error(
                        "insert",
                        "Inserted identifiers must be fresh and unique",
                    ));
                }
            }
            for value in object.values() {
                fresh_ids(value, ids)?;
            }
        }
        Value::Array(array) => {
            for value in array {
                fresh_ids(value, ids)?;
            }
        }
        _ => (),
    }
    Ok(())
}

pub fn insertion(base: &Value, next: &Value, prepared: &PreparedMaterialInsert) -> Result<()> {
    insert_selection::validate_prepared(prepared)?;
    if prepared.target_group_id.is_some() { return super::insert_gallery::validate(base, next, prepared); }
    if insert_selection::separate_images(prepared.selection.as_ref()) {
        return native_image_insertion(base, next, prepared);
    }
    if prepared.payload.kind == MaterialKind::Image {
        ready_payload(&prepared.payload)?;
        if prepared.images.first().is_some_and(|source| source.file.starts_with("media/")) {
            return native_image_insertion(base, next, prepared);
        }
        // Older durable receipts published image materials as image groups.
        // Keep validating those exact receipts for recovery and retained history.
        let mut expanded = prepared.clone();
        expanded.payload.kind = MaterialKind::ImageGroup;
        expanded.payload.component["kind"] = json!("imageGroup");
        return insertion(base, next, &expanded);
    }
    plan(base)?;
    plan(next)?;
    let (path, index, added) = crate::column_document::insertion(&base["document"], &next["document"], 1)
        .map_err(|e| error("insert", e))?;
    let marker = &added[0];
    if marker["type"] != prepared.payload.kind.as_str() { return Err(error("insert", "Inserted component kind differs from the receipt")); }
    object(marker, &["id", "type", "props", "children"], &[])?;
    if !array(marker, "children")?.is_empty() {
        return Err(error(
            "insert",
            "Inserted marker must not contain text or children",
        ));
    }
    let (sidecars, prop) = if prepared.payload.kind == MaterialKind::ImageGroup {
        ("imageGroups", "groupId")
    } else {
        ("artifacts", "artifactId")
    };
    object(&marker["props"], &[prop], &[])?;
    let records = array(next, sidecars)?;
    let previous = array(base, sidecars)?;
    if records.len() != previous.len() + 1 || records[..previous.len()] != previous[..] {
        return Err(error(
            "insert",
            "Insertion must append one independent component sidecar",
        ));
    }
    let record = records.last().unwrap();
    if record["id"] != marker["props"][prop] {
        return Err(error("insert", "Inserted marker does not own its sidecar"));
    }
    if prepared.payload.kind == MaterialKind::ImageGroup {
        object(
            record,
            &[
                "id",
                "type",
                "name",
                "description",
                "x",
                "width",
                "height",
                "images",
            ],
            &[],
        )?;
        if record["type"] != "reference"
            || record["x"] != 0
            || record["width"] != 1008
            || record["height"] != 320
        {
            return Err(error(
                "insert",
                "Inserted image group must use the full-row factory defaults",
            ));
        }
    } else {
        let required: &[&str] = match prepared.payload.kind {
            MaterialKind::ShootingLocation => &[
                "id",
                "kind",
                "revision",
                "venueName",
                "address",
                "description",
                "gallery",
            ],
            MaterialKind::ModelCard => &[
                "id", "kind", "revision", "modelId", "heightCm", "weightKg", "shoeSize", "samples",
            ],
            MaterialKind::Prop => &["id", "kind", "revision", "title", "source", "gallery"],
            MaterialKind::Clothing => &[
                "id",
                "kind",
                "revision",
                "title",
                "source",
                "mainGallery",
                "tryOn",
            ],
            _ => unreachable!(),
        };
        object(
            record,
            required,
            if prepared.payload.kind == MaterialKind::ModelCard {
                &["notes"]
            } else {
                &[]
            },
        )?;
        if record["revision"] != 0 {
            return Err(error("insert", "Invalid initial artifact revision"));
        }
        let collection = match prepared.payload.kind {
            MaterialKind::ModelCard => "samples",
            MaterialKind::Clothing => "mainGallery",
            _ => "gallery",
        };
        object(&record[collection], &["id", "images"], &[])?;
        if prepared.payload.kind == MaterialKind::Clothing {
            object(&record["tryOn"], &["expanded", "gallery"], &[])?;
            object(&record["tryOn"]["gallery"], &["id", "images"], &[])?;
            if record["tryOn"]["expanded"] != false
                || !array(&record["tryOn"]["gallery"], "images")?.is_empty()
            {
                return Err(error(
                    "insert",
                    "Legacy try-on collection must be fresh and empty",
                ));
            }
        }
    }
    let mut ids = HashSet::new();
    collect_ids(base, &mut ids);
    for image in payload_images(&prepared.payload)? {
        ids.insert(string(image, "localImageId")?.to_owned());
    }
    fresh_ids(marker, &mut ids)?;
    fresh_ids(record, &mut ids)?;
    let mut remainder = next.clone();
    remainder.pointer_mut(&format!("/document{path}")).unwrap()
        .as_array_mut()
        .unwrap()
        .remove(index);
    remainder[sidecars].as_array_mut().unwrap().pop();
    if remainder != *base {
        return Err(error("insert", "Insertion changed unrelated plan content"));
    }
    let check = MaterialSnapshot {
        source_block_id: string(marker, "id")?.into(),
        payload: prepared.payload.clone(),
        sources: prepared.images.clone(),
        omitted_legacy_images: 0,
    };
    snapshot(next, &check)
}

fn native_image_insertion(base: &Value, next: &Value, prepared: &PreparedMaterialInsert) -> Result<()> {
    plan(base)?;
    plan(next)?;
    let images = payload_images(&prepared.payload)?;
    let count = images.len();
    if count == 0 { return Err(error("insert", "Select at least one image")); }
    fn mentions(value: &Value, file: &str) -> bool {
        match value {
            Value::String(text) => text.replace('\\', "/").eq_ignore_ascii_case(file),
            Value::Array(values) => values.iter().any(|value| mentions(value, file)),
            Value::Object(values) => values.values().any(|value| mentions(value, file)),
            _ => false,
        }
    }
    let (path, index, added) = crate::column_document::insertion(&base["document"], &next["document"], count)
        .map_err(|e| error("insert", e))?;
    if added.iter().any(|block| block["type"] != "image") { return Err(error("insert", "Expected only native image blocks")); }
    let mut ids = HashSet::new();
    collect_ids(base, &mut ids);
    for image in images { ids.insert(string(image, "localImageId")?.to_owned()); }
    let mut files = HashSet::new();
    for (block, image) in added.iter().zip(images) {
        let source = prepared.images.iter().find(|source| image["localImageId"] == source.local_image_id)
            .ok_or_else(|| error("insert", "Missing selected image copy"))?;
        let file = &source.file;
        if !file.starts_with("media/") { return Err(error("insert", "Expected a native media copy")); }
        super::files::reference_name(&file.replacen("media/", "references/", 1))?;
        if mentions(base, file) || !files.insert(file.to_lowercase()) {
            return Err(error("insert", "Inserted native images must own independent new files"));
        }
        object(block, &["id", "type", "props", "children"], &[])?;
        if !array(block, "children")?.is_empty() { return Err(error("insert", "Inserted image must not contain child blocks")); }
        let expected = json!({"url":file,"name":prepared.payload.component["name"],
            "caption":image["caption"].as_str().unwrap_or(""),"showPreview":true,"previewWidth":image["frameWidth"]});
        if block["props"] != expected { return Err(error("insert", "Inserted image does not match prepared order and content")); }
        string(block, "id")?;
        fresh_ids(block, &mut ids)?;
    }
    let mut remainder = next.clone();
    remainder.pointer_mut(&format!("/document{path}")).unwrap().as_array_mut().unwrap().drain(index..index + count);
    if remainder != *base { return Err(error("insert", "Image insertion changed unrelated plan content")); }
    Ok(())
}

pub fn body(payload: &MaterialPayload) -> String {
    let fields: &[&str] = match payload.kind {
        MaterialKind::Image | MaterialKind::ImageGroup => &["name", "description"],
        MaterialKind::ShootingLocation => &["venueName", "address", "description"],
        MaterialKind::ModelCard => &["modelId", "heightCm", "weightKg", "shoeSize", "notes"],
        _ => &["title", "source"],
    };
    let mut values: Vec<String> = fields
        .iter()
        .filter_map(|key| match &payload.component[key] {
            Value::String(text) => Some(text.clone()),
            Value::Number(number) => Some(number.to_string()),
            _ => None,
        })
        .collect();
    if let Ok(images) = payload_images(payload) {
        values.extend(
            images
                .iter()
                .filter_map(|image| image["caption"].as_str().map(str::to_owned)),
        );
    }
    values.join("\n")
}

/// Empty single-image payloads are draft-only.
pub fn ready_payload(value: &MaterialPayload) -> Result<()> {
    payload(value)?;
    if value.kind == MaterialKind::Image && payload_images(value)?.len() != 1 {
        return Err(error("image_count", "Add exactly one image before saving the image material"));
    }
    Ok(())
}
