use super::{error, models::*, validation, Result};
use serde_json::Value;
use std::collections::HashSet;

pub(super) fn select_payload(payload: &MaterialPayload, selection: Option<&MaterialImageSelection>) -> Result<MaterialPayload> {
    validation::payload(payload)?;
    let Some(selection) = selection else { return Ok(payload.clone()); };
    if payload.kind != MaterialKind::ImageGroup || selection.image_ids.is_empty() || selection.image_ids.len() > 128 {
        return Err(error("insert_selection", "Select one or more images from an image-group material"));
    }
    let ids: HashSet<_> = selection.image_ids.iter().map(String::as_str).collect();
    let images = validation::payload_images(payload)?;
    if ids.len() != selection.image_ids.len() || ids.iter().any(|id| !images.iter().any(|image| image["localImageId"] == *id)) {
        return Err(error("insert_selection", "Selected images are duplicated or no longer belong to this material"));
    }
    let mut selected = payload.clone();
    selected.component["images"] = Value::Array(images.iter()
        .filter(|image| ids.contains(image["localImageId"].as_str().unwrap())).cloned().collect());
    Ok(selected)
}

pub(super) fn separate_images(selection: Option<&MaterialImageSelection>) -> bool {
    selection.is_some_and(|selection| selection.mode == MaterialImageInsertMode::Images)
}

pub(super) fn validate_prepared(prepared: &PreparedMaterialInsert) -> Result<()> {
    if let Some(target) = &prepared.target_group_id {
        if target.is_empty() || !matches!(prepared.payload.kind, MaterialKind::Image | MaterialKind::ImageGroup) ||
            separate_images(prepared.selection.as_ref()) || prepared.images.is_empty() ||
            prepared.images.iter().any(|source| !source.file.starts_with("references/")) {
            return Err(error("insert_target", "Invalid target group insertion receipt"));
        }
    }
    if select_payload(&prepared.payload, prepared.selection.as_ref())? != prepared.payload {
        return Err(error("insert_selection", "Prepared content contains unselected images"));
    }
    let images = validation::payload_images(&prepared.payload)?;
    let sources: HashSet<_> = prepared.images.iter().map(|source| source.local_image_id.as_str()).collect();
    if sources.len() != images.len() || prepared.images.len() != images.len() ||
        images.iter().any(|image| !sources.contains(image["localImageId"].as_str().unwrap())) {
        return Err(error("insert_selection", "Prepared copies must match selected images exactly"));
    }
    if prepared.selection.is_some() {
        let directory = if separate_images(prepared.selection.as_ref()) { "media/" } else { "references/" };
        if prepared.images.iter().any(|source| !source.file.starts_with(directory)) {
            return Err(error("insert_selection", "Prepared copy directory does not match the insertion mode"));
        }
    }
    Ok(())
}
