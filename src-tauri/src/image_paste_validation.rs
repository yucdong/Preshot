use std::collections::HashSet;

use serde_json::{Map, Value};

use super::{error, Destination, PreparedImagePaste, Result};

fn object<'a>(
    value: &'a Value,
    required: &[&str],
    optional: &[&str],
) -> Result<&'a Map<String, Value>> {
    let object = value
        .as_object()
        .ok_or_else(|| error("delta", "Expected an object"))?;
    if required.iter().any(|key| !object.contains_key(*key))
        || object
            .keys()
            .any(|key| !required.contains(&key.as_str()) && !optional.contains(&key.as_str()))
    {
        return Err(error("delta", "Unsupported or missing image-paste field"));
    }
    Ok(object)
}

fn array<'a>(value: &'a Value, key: &str) -> Result<&'a Vec<Value>> {
    value
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| error("plan", format!("Expected array {key}")))
}

fn identifier(value: &Value) -> Result<&str> {
    let id = value.as_str().filter(|id| {
        !id.is_empty()
            && id.len() <= 128
            && id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    });
    id.ok_or_else(|| error("delta", "Expected a portable image/block identifier"))
}

fn blocks_valid(blocks: &[Value], seen: &mut HashSet<String>) -> Result<()> {
    for block in blocks {
        let id = block
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .ok_or_else(|| error("plan", "Document block is missing its identity"))?;
        if !seen.insert(id.to_owned())
            || matches!(block["type"].as_str(), None | Some("column" | "columnList"))
            || !block["props"].is_object()
        {
            return Err(error(
                "plan",
                "Document block identity or structure is unsupported",
            ));
        }
        if let Some(children) = block.get("children") {
            blocks_valid(
                children
                    .as_array()
                    .ok_or_else(|| error("plan", "Invalid document children"))?,
                seen,
            )?;
        }
    }
    Ok(())
}

pub(super) fn plan(value: &Value) -> Result<()> {
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
    object(&value["document"], &["format", "version", "blocks"], &[])?;
    if value["schemaVersion"] != 15
        || value["document"]["format"] != "preshot-blocks"
        || value["document"]["version"] != 3
        || !value["title"].is_string()
        || serde_json::to_vec(value)
            .map_err(|_| error("plan", "Invalid plan"))?
            .len()
            > 32 * 1024 * 1024
    {
        return Err(error(
            "plan",
            "Image paste requires a bounded active v15 plan and v3 document",
        ));
    }
    array(value, "imageGroups")?;
    array(value, "artifacts")?;
    blocks_valid(array(&value["document"], "blocks")?, &mut HashSet::new())
}

fn contains_id(value: &Value, id: &str) -> bool {
    match value {
        Value::Array(values) => values.iter().any(|value| contains_id(value, id)),
        Value::Object(values) => {
            values.get("id").and_then(Value::as_str) == Some(id)
                || values.values().any(|value| contains_id(value, id))
        }
        _ => false,
    }
}

fn finite(value: &Value, positive: bool) -> bool {
    value
        .as_f64()
        .is_some_and(|n| n.is_finite() && (!positive || n > 0.0))
}

fn text(value: &Value) -> bool {
    value.as_str().is_some_and(|text| {
        text.chars().count() <= 200_000
            && !text
                .chars()
                .any(|c| c.is_control() && !matches!(c, '\r' | '\n' | '\t'))
    })
}

fn native_image(base: &Value, block: &Value, prepared: &PreparedImagePaste) -> Result<()> {
    object(block, &["id", "type", "props"], &["children"])?;
    let id = identifier(&block["id"])?;
    if contains_id(base, id)
        || block["type"] != "image"
        || block
            .get("children")
            .is_some_and(|v| v.as_array().is_none_or(|children| !children.is_empty()))
    {
        return Err(error(
            "delta",
            "Paste must add one fresh native image row without nested content",
        ));
    }
    let props = object(
        &block["props"],
        &["url", "name", "caption", "showPreview"],
        &["textAlignment", "backgroundColor", "previewWidth"],
    )?;
    if props["url"] != prepared.file
        || props["name"] != prepared.name
        || !text(&props["caption"])
        || !props["showPreview"].is_boolean()
        || props
            .get("textAlignment")
            .is_some_and(|v| !matches!(v.as_str(), Some("left" | "center" | "right" | "justify")))
        || props.get("backgroundColor").is_some_and(|v| v != "default")
        || props
            .get("previewWidth")
            .is_some_and(|v| !finite(v, true) || v.as_f64().unwrap() > 8192.0)
    {
        return Err(error(
            "delta",
            "Unsupported native image properties or prepared file mismatch",
        ));
    }
    Ok(())
}

fn reference_image(base: &Value, image: &Value, prepared: &PreparedImagePaste) -> Result<()> {
    object(
        image,
        &["id", "file", "aspectRatio", "frameWidth", "frameHeight"],
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
    let id = identifier(&image["id"])?;
    if contains_id(base, id) || image["file"] != prepared.file {
        return Err(error(
            "delta",
            "Reference image identity must be fresh and use the prepared file",
        ));
    }
    for key in ["aspectRatio", "frameWidth", "frameHeight"] {
        if !finite(&image[key], true) {
            return Err(error("delta", "Invalid reference image dimensions"));
        }
    }
    for key in [
        "sourceWidth",
        "sourceHeight",
        "frameOffsetX",
        "frameOffsetY",
    ] {
        if let Some(value) = image.get(key) {
            if !finite(value, key.starts_with("source"))
                || key.starts_with("source")
                    && (value.as_f64().unwrap().fract() != 0.0 || value.as_f64().unwrap() > 8192.0)
            {
                return Err(error("delta", "Invalid reference image geometry"));
            }
        }
    }
    if image.get("caption").is_some_and(|v| !text(v))
        || image
            .get("fitMode")
            .is_some_and(|v| !matches!(v.as_str(), Some("cover" | "stretch")))
    {
        return Err(error("delta", "Invalid reference image display settings"));
    }
    if let Some(crop) = image.get("crop") {
        object(crop, &["x", "y", "width", "height"], &[])?;
        for key in ["x", "y", "width", "height"] {
            if !finite(&crop[key], matches!(key, "width" | "height")) {
                return Err(error("delta", "Invalid reference image crop"));
            }
        }
        let x = crop["x"].as_f64().unwrap();
        let y = crop["y"].as_f64().unwrap();
        if x < 0.0
            || y < 0.0
            || x + crop["width"].as_f64().unwrap() > 1.000001
            || y + crop["height"].as_f64().unwrap() > 1.000001
        {
            return Err(error("delta", "Reference image crop exceeds its image"));
        }
    }
    Ok(())
}

fn addition<'a>(before: &[Value], after: &'a [Value]) -> Result<(usize, &'a Value)> {
    if after.len() != before.len() + 1 {
        return Err(error("delta", "Paste must insert exactly one image"));
    }
    let index = before
        .iter()
        .zip(after)
        .position(|(a, b)| a != b)
        .unwrap_or(before.len());
    if before[index..] != after[index + 1..] {
        return Err(error(
            "delta",
            "Paste cannot change or reorder existing images or document rows",
        ));
    }
    Ok((index, &after[index]))
}

fn marker_count(blocks: &[Value], kind: &str, prop: &str, id: &Value) -> usize {
    blocks
        .iter()
        .map(|block| {
            usize::from(block["type"] == kind && block["props"][prop] == *id)
                + block["children"]
                    .as_array()
                    .map(|children| marker_count(children, kind, prop, id))
                    .unwrap_or(0)
        })
        .sum()
}

fn collection_paths(base: &Value) -> Result<Vec<String>> {
    let blocks = array(&base["document"], "blocks")?;
    let mut result = Vec::new();
    for (index, group) in array(base, "imageGroups")?.iter().enumerate() {
        if group["type"] == "reference"
            && group["id"].is_string()
            && marker_count(blocks, "imageGroup", "groupId", &group["id"]) == 1
            && array(base, "imageGroups")?
                .iter()
                .filter(|other| other["id"] == group["id"])
                .count()
                == 1
        {
            result.push(format!("/imageGroups/{index}/images"));
        }
    }
    for (index, artifact) in array(base, "artifacts")?.iter().enumerate() {
        let Some(kind) = artifact["kind"].as_str() else {
            continue;
        };
        if !artifact["id"].is_string()
            || marker_count(blocks, kind, "artifactId", &artifact["id"]) != 1
            || array(base, "artifacts")?
                .iter()
                .filter(|other| other["id"] == artifact["id"])
                .count()
                != 1
        {
            continue;
        }
        let names: &[&str] = match kind {
            "shootingLocation" | "prop" => &["gallery"],
            "modelCard" => &["samples"],
            "clothing" => &["mainGallery", "tryOn/gallery"],
            _ => &[],
        };
        for name in names {
            let path = format!("/artifacts/{index}/{name}");
            if base.pointer(&path).is_some_and(|collection| {
                collection["id"].is_string() && collection["images"].is_array()
            }) {
                result.push(format!("{path}/images"));
            }
        }
    }
    Ok(result)
}

pub(super) fn insertion(
    base: &Value,
    next: &Value,
    destination: Destination,
    prepared: &PreparedImagePaste,
) -> Result<()> {
    plan(base)?;
    plan(next)?;
    let mut restored = next.clone();
    match destination {
        Destination::Media => {
            let (index, image) = addition(
                array(&base["document"], "blocks")?,
                array(&next["document"], "blocks")?,
            )?;
            native_image(base, image, prepared)?;
            restored["document"]["blocks"]
                .as_array_mut()
                .unwrap()
                .remove(index);
        }
        Destination::References => {
            let paths = collection_paths(base)?;
            let artifact_images: usize = paths
                .iter()
                .filter(|path| path.starts_with("/artifacts/"))
                .filter_map(|path| next.pointer(path).and_then(Value::as_array))
                .map(Vec::len)
                .sum();
            if artifact_images > 2048 {
                return Err(error(
                    "delta",
                    "The plan exceeds its 2048-artifact-image limit",
                ));
            }
            let changed: Vec<_> = paths
                .into_iter()
                .filter(|path| base.pointer(path) != next.pointer(path))
                .collect();
            if changed.len() != 1 {
                return Err(error(
                    "delta",
                    "Paste must target exactly one uniquely owned existing gallery",
                ));
            }
            let path = &changed[0];
            let before = base.pointer(path).and_then(Value::as_array).unwrap();
            let after = next
                .pointer(path)
                .and_then(Value::as_array)
                .ok_or_else(|| error("delta", "Existing gallery was removed"))?;
            if after.len() > 128 {
                return Err(error("delta", "The gallery exceeds its 128-image limit"));
            }
            let (index, image) = addition(before, after)?;
            reference_image(base, image, prepared)?;
            restored
                .pointer_mut(path)
                .unwrap()
                .as_array_mut()
                .unwrap()
                .remove(index);
            if let Some((artifact_index, _)) = path
                .strip_prefix("/artifacts/")
                .and_then(|path| path.split_once('/'))
            {
                let revision_path = format!("/artifacts/{artifact_index}/revision");
                let revision = base
                    .pointer(&revision_path)
                    .and_then(Value::as_u64)
                    .filter(|revision| *revision < 9_007_199_254_740_991)
                    .ok_or_else(|| {
                        error(
                            "delta",
                            "Owning artifact revision cannot be safely incremented",
                        )
                    })?;
                if next.pointer(&revision_path).and_then(Value::as_u64) != Some(revision + 1) {
                    return Err(error(
                        "delta",
                        "An artifact-gallery paste must increment only its owning artifact revision by one",
                    ));
                }
                *restored.pointer_mut(&revision_path).unwrap() =
                    base.pointer(&revision_path).unwrap().clone();
            }
        }
    }
    if restored != *base {
        return Err(error(
            "delta",
            "Image paste cannot modify unrelated plan content or sidecars",
        ));
    }
    Ok(())
}
