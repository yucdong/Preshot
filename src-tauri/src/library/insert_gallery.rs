use std::collections::HashSet;
use serde_json::Value;
use super::{error, insert_selection, models::*, validation, Result};

pub(super) fn validate_target(base: &Value, payload: &MaterialPayload, target: Option<&str>, selection: Option<&MaterialImageSelection>) -> Result<()> {
    let Some(id) = target else { return Ok(()); };
    let group = base["imageGroups"].as_array().and_then(|groups| groups.iter().find(|group| group["id"] == id))
        .ok_or_else(|| error("insert_target", "Target image group no longer exists"))?;
    let count = validation::payload_images(payload)?.len();
    if id.is_empty() || !matches!(payload.kind, MaterialKind::Image | MaterialKind::ImageGroup) ||
        insert_selection::separate_images(selection) || count == 0 ||
        group["images"].as_array().is_none_or(|images| images.len() + count > 128) {
        return Err(error("insert_target", "Insert images into an existing group with at most 128 images"));
    }
    Ok(())
}

pub(super) fn validate(base: &Value, next: &Value, prepared: &PreparedMaterialInsert) -> Result<()> {
    validation::plan(base)?;
    validation::plan(next)?;
    validate_target(base, &prepared.payload, prepared.target_group_id.as_deref(), prepared.selection.as_ref())?;
    let id = prepared.target_group_id.as_ref().unwrap();
    let index = base["imageGroups"].as_array().unwrap().iter().position(|group| group["id"] == *id).unwrap();
    let before = base["imageGroups"][index]["images"].as_array().unwrap();
    let after = next["imageGroups"][index]["images"].as_array()
        .ok_or_else(|| error("insert_target", "Target image group changed"))?;
    let visuals = validation::payload_images(&prepared.payload)?;
    if after.len() != before.len() + visuals.len() || after[..before.len()] != before[..] {
        return Err(error("insert_target", "Insertion must append the selected images without changing existing images"));
    }
    let mut ids = HashSet::new();
    validation::collect_ids(base, &mut ids);
    for visual in visuals { ids.insert(visual["localImageId"].as_str().unwrap().to_owned()); }
    let mut paths = HashSet::new();
    fn mentions(value: &Value, file: &str) -> bool {
        match value {
            Value::String(text) => text.replace('\\', "/").eq_ignore_ascii_case(file),
            Value::Array(values) => values.iter().any(|v| mentions(v, file)),
            Value::Object(values) => values.values().any(|v| mentions(v, file)),
            _ => false,
        }
    }
    for (image, visual) in after[before.len()..].iter().zip(visuals) {
        validation::fresh_ids(image, &mut ids)?;
        let source = prepared.images.iter().find(|source| visual["localImageId"] == source.local_image_id)
            .ok_or_else(|| error("insert_target", "Missing selected image copy"))?;
        if !source.file.starts_with("references/") || mentions(base, &source.file) || !paths.insert(source.file.to_lowercase()) {
            return Err(error("insert_target", "Insertion requires independent reference files"));
        }
        let mut expected = visual.clone();
        expected.as_object_mut().unwrap().remove("localImageId");
        expected["id"] = image["id"].clone();
        expected["file"] = Value::String(source.file.clone());
        if expected != *image { return Err(error("insert_target", "Inserted image order, identity or presentation changed")); }
    }
    let mut expected = base.clone();
    expected["imageGroups"][index]["images"] = Value::Array(after.clone());
    let mut comparable = next.clone();
    crate::column_document::restore_version_for_comparison(base, next, &mut comparable);
    if expected != comparable { return Err(error("insert_target", "Insertion changed unrelated project content")); }
    Ok(())
}
