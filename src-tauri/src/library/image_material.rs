use super::{error, files, models::*, validation, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// Insertion owns either a native media copy or a legacy/gallery reference copy.
pub(super) fn insertion_path(project: &Path, file: &str, exists: bool) -> Result<PathBuf> {
    if file.starts_with("references/") { return files::reference(project, file, exists); }
    let name = file.strip_prefix("media/").ok_or_else(|| error("path", "Invalid inserted image directory"))?;
    files::reference_name(&format!("references/{name}"))?;
    let path = project.join("media").join(name);
    files::check_leaf(&path)?;
    if exists {
        let canonical = path.canonicalize().map_err(|e| error("image_missing", e))?;
        if !canonical.starts_with(project) || !canonical.is_file() { return Err(error("path", "Inserted image escaped its project")); }
    }
    Ok(path)
}

pub(super) fn insertion_bytes(bytes: &[u8], image: &Value) -> Result<Vec<u8>> {
    let mut visual = image.clone();
    visual.as_object_mut().unwrap().remove("localImageId");
    visual.as_object_mut().unwrap().remove("presentationAxes");
    let presentation = serde_json::from_value(visual).map_err(|e| error("image_presentation", e))?;
    crate::image_clipboard::render_encoded_image(bytes, &presentation, files::MAX_IMAGE_BYTES)
        .map_err(|e| error("image_render", e))
}

pub(super) fn source_path(project: &Path, file: &str) -> Result<PathBuf> {
    if file.starts_with("references/") {
        return files::reference(project, file, true);
    }
    let name = file
        .strip_prefix("media/")
        .ok_or_else(|| error("path", "Image must belong to this project"))?;
    files::reference_name(&format!("references/{name}"))?;
    let path = project.join("media").join(name);
    files::no_links(&path)?;
    let canonical = path.canonicalize().map_err(|e| error("image_missing", e))?;
    if !canonical.starts_with(project) || !canonical.is_file() {
        return Err(error("path", "Image escaped its project"));
    }
    Ok(path)
}

pub(super) fn snapshot(plan: &Value, input: &MaterialSnapshot) -> Result<()> {
    validation::plan(plan)?;
    validation::ready_payload(&input.payload)?;
    if input.sources.len() != 1 || input.omitted_legacy_images != 0 {
        return Err(error(
            "source",
            "An image material must disclose exactly one image",
        ));
    }
    let image = &validation::payload_images(&input.payload)?[0];
    let source = &input.sources[0];
    if image["localImageId"] != source.local_image_id {
        return Err(error("source", "Image source identity mismatch"));
    }
    let blocks = plan["document"]["blocks"].as_array().unwrap();
    fn owners<'a>(blocks: &'a [Value], id: &str, result: &mut Vec<&'a Value>) {
        for block in blocks {
            if block["id"] == id {
                result.push(block);
            }
            if let Some(children) = block["children"].as_array() {
                owners(children, id, result);
            }
        }
    }
    let mut matches = Vec::new();
    owners(blocks, &input.source_block_id, &mut matches);
    if matches.len() != 1 {
        return Err(error("source", "Image owner is missing or ambiguous"));
    }
    let block = matches[0];
    if block["type"] == "image" {
        native_snapshot(block, image, source, &input.payload)
    } else {
        let (whole, sources, _) = validation::snapshot_from_plan(plan, &input.source_block_id)?;
        let candidates = validation::payload_images(&whole)?;
        let mut valid = candidates.iter().zip(sources).any(|(candidate, owner)| {
            let mut candidate = candidate.clone();
            candidate["localImageId"] = image["localImageId"].clone();
            owner.file == source.file && candidate == *image
        });
        // A single selected legacy try-on image is reusable on its own even
        // though whole-clothing snapshots intentionally omit that gallery.
        if !valid && block["type"] == "clothing" {
            if let Some(artifact) = plan["artifacts"]
                .as_array()
                .unwrap()
                .iter()
                .find(|artifact| artifact["id"] == block["props"]["artifactId"])
            {
                valid = artifact["tryOn"]["gallery"]["images"]
                    .as_array()
                    .is_some_and(|entries| {
                        entries.iter().any(|entry| {
                            let mut candidate = entry.clone();
                            let fields = candidate.as_object_mut().unwrap();
                            fields.remove("id");
                            let file = fields.remove("file");
                            fields.insert("localImageId".into(), image["localImageId"].clone());
                            file.as_ref().and_then(Value::as_str) == Some(&source.file)
                                && candidate == *image
                        })
                    });
            }
        }
        let title = image["caption"].as_str().unwrap_or("").trim();
        let expected = json!({"kind":"image", "name":if title.is_empty() { "图片" } else { title }, "description":"", "images":[image]});
        if !valid || input.payload.component != expected {
            return Err(error(
                "source",
                "The selected image does not match its committed component",
            ));
        }
        Ok(())
    }
}

fn native_snapshot(
    block: &Value,
    image: &Value,
    source: &MaterialImageSource,
    payload: &MaterialPayload,
) -> Result<()> {
    let props = &block["props"];
    if props["url"] != source.file || !source.file.starts_with("media/") {
        return Err(error("source", "Select one project-local native image"));
    }
    files::reference_name(&source.file.replacen("media/", "references/", 1))?;
    let allowed = [
        "localImageId",
        "caption",
        "aspectRatio",
        "sourceWidth",
        "sourceHeight",
        "frameWidth",
        "frameHeight", "fitMode", "crop", "presentationAxes",
    ];
    if image
        .as_object()
        .unwrap()
        .keys()
        .any(|key| !allowed.contains(&key.as_str()))
    {
        return Err(error(
            "source",
            "Native image snapshot has unsupported presentation fields",
        ));
    }
    let width = image["sourceWidth"].as_f64().unwrap_or(0.0);
    if crate::original_image::presentation_axes(image)? != crate::original_image::presentation_axes(props)? {
        return Err(error("source", "Native image presentation axes differ"));
    }
    let height = image["sourceHeight"].as_f64().unwrap_or(0.0);
    let ratio = width / height;
    let frame = props["previewWidth"]
        .as_f64()
        .filter(|w| *w > 0.0)
        .unwrap_or(width.min(1008.0));
    let caption = props["caption"].as_str().unwrap_or("");
    let name = props["name"]
        .as_str()
        .filter(|s| !s.is_empty())
        .unwrap_or("图片");
    if width <= 0.0
        || height <= 0.0
        || !width.is_finite() || width.fract() != 0.0
        || !height.is_finite() || height.fract() != 0.0
        || image["aspectRatio"].as_f64() != Some(ratio)
        || image["frameWidth"].as_f64() != Some(frame)
        || image["frameHeight"].as_f64() != Some(props["previewHeight"].as_f64().filter(|h| *h > 0.0).unwrap_or(frame / ratio))
        || image["caption"] != caption
        || payload.component["name"] != name
        || payload.component["description"] != ""
    {
        return Err(error(
            "source",
            "Native image snapshot does not match the selected block",
        ));
    }
    if payload.version == 2 {
        if image["fitMode"].as_str().unwrap_or("cover") != props["fitMode"].as_str().unwrap_or("cover") {
            return Err(error("source", "Image fit mode differs"));
        }
        let round = |value: f64| (value * 1_000_000.0).round() / 1_000_000.0;
        let w = props["cropWidth"].as_f64().unwrap_or(1.0).clamp(0.000001, 1.0);
        let h = props["cropHeight"].as_f64().unwrap_or(1.0).clamp(0.000001, 1.0);
        let x = props["cropX"].as_f64().unwrap_or(0.0).clamp(0.0, 1.0 - w);
        let y = props["cropY"].as_f64().unwrap_or(0.0).clamp(0.0, 1.0 - h);
        let expected = if props["fitMode"] == "stretch" { [x, y, w, h] } else {
            let frame_ratio = frame / image["frameHeight"].as_f64().unwrap();
            let (base_w, base_h) = if frame_ratio >= ratio { (1.0, round(ratio / frame_ratio)) } else { (round(frame_ratio / ratio), 1.0) };
            let zoom = (base_w / w).min(base_h / h).max(1.0);
            let cw = (if frame_ratio >= ratio { 1.0 } else { frame_ratio / ratio } / zoom).clamp(0.000001, 1.0);
            let ch = (if frame_ratio >= ratio { ratio / frame_ratio } else { 1.0 } / zoom).clamp(0.000001, 1.0);
            [round((x + w / 2.0 - cw / 2.0).clamp(0.0, 1.0 - cw)), round((y + h / 2.0 - ch / 2.0).clamp(0.0, 1.0 - ch)), round(cw), round(ch)]
        };
        for (field, expected) in ["x", "y", "width", "height"].into_iter().zip(expected) {
            if image["crop"][field].as_f64().is_none_or(|actual| (actual - expected).abs() > 0.000001) {
                return Err(error("source", "Image crop differs"));
            }
        }
    }
    // Store::save additionally checks width/height against the actual confined PNG/JPG.
    Ok(())
}
