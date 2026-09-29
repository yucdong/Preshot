use serde_json::Value;
use std::collections::HashSet;

pub(crate) fn validate(document: &Value, columns: bool) -> Result<(), String> {
    fn visit(blocks: &[Value], parent: Option<&str>, columns: bool, depth: usize, ids: &mut HashSet<String>) -> Result<(), String> {
        if depth > 32 { return Err("Document nesting exceeds its limit".into()); }
        for block in blocks {
            let id = block["id"].as_str().filter(|id| !id.is_empty()).ok_or("Missing block identity")?;
            let kind = block["type"].as_str().ok_or("Missing block type")?;
            if ids.len() >= 20_000 || !ids.insert(id.to_owned()) { return Err("Duplicate or excessive document blocks".into()); }
            let props = block["props"].as_object().ok_or("Missing block properties")?;
            let children = block.get("children").map(|v| v.as_array().ok_or("Invalid block children")).transpose()?;
            let children = children.map(Vec::as_slice).unwrap_or(&[]);
            match kind {
                "columnList" => {
                    if !columns || parent.is_some() || children.len() < 2 || !props.is_empty() ||
                        block.get("content").is_some() || children.iter().any(|child| child["type"] != "column") {
                        return Err("Invalid column row".into());
                    }
                }
                "column" => {
                    if !columns || parent != Some("columnList") || children.is_empty() || props.len() != 1 ||
                        block.get("content").is_some() || !props.get("width").and_then(Value::as_f64).is_some_and(|w| w.is_finite() && w > 0.0) ||
                        children.iter().any(|child| matches!(child["type"].as_str(), Some("column" | "columnList"))) {
                        return Err("Invalid column".into());
                    }
                }
                "imageGroup" | "shootingLocation" | "modelCard" | "clothing" | "prop" => {
                    if parent.is_some() && parent != Some("column") { return Err("Component must belong to a document or column row".into()); }
                }
                "paragraph" | "heading" | "bulletListItem" | "numberedListItem" | "checkListItem" |
                "toggleListItem" | "quote" | "codeBlock" | "table" | "divider" | "pageBreak" |
                "image" | "video" | "audio" | "file" => (),
                _ => return Err("Unsupported document block".into()),
            }
            visit(children, Some(kind), columns, depth + 1, ids)?;
        }
        Ok(())
    }
    visit(document["blocks"].as_array().ok_or("Missing document blocks")?, None, columns, 0, &mut HashSet::new())
}

/// Find one consecutive insertion into an existing root/column child array.
/// Removing it must restore the entire document exactly (including all weights).
pub(crate) fn insertion(before: &Value, after: &Value, count: usize) -> Result<(String, usize, Vec<Value>), String> {
    if count == 0 { return Err("An insertion must contain blocks".into()); }
    let mut paths = vec!["/blocks".to_owned()];
    for (i, row) in before["blocks"].as_array().ok_or("Missing document blocks")?.iter().enumerate() {
        if row["type"] == "columnList" {
            for (j, _) in row["children"].as_array().ok_or("Missing columns")?.iter().enumerate() {
                paths.push(format!("/blocks/{i}/children/{j}/children"));
            }
        }
    }
    for path in paths {
        let Some(old) = before.pointer(&path).and_then(Value::as_array) else { continue };
        let Some(new) = after.pointer(&path).and_then(Value::as_array) else { continue };
        if new.len() != old.len() + count { continue; }
        // At most one new run exists; use the common prefix rather than cloning per index.
        let index = old.iter().zip(new).take_while(|(a, b)| a == b).count();
        if new[index + count..] != old[index..] { continue; }
        let mut restored = after.clone();
        restored.pointer_mut(&path).unwrap().as_array_mut().unwrap().drain(index..index + count);
        if restored == *before { return Ok((path, index, new[index..index + count].to_vec())); }
    }
    Err("Insertion changed existing document content or its column layout".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn text(id: &str) -> Value { json!({"id":id,"type":"paragraph","props":{},"content":[],"children":[]}) }
    fn document(count: usize) -> Value {
        json!({"format":"preshot-blocks","version":4,"blocks":[{"id":"row","type":"columnList","props":{},"children":
            (0..count).map(|i| json!({"id":format!("col-{i}"),"type":"column","props":{"width":1},"children":[text(&format!("text-{i}"))]})).collect::<Vec<_>>() }]})
    }
    #[test]
    fn arbitrary_columns_are_structural_and_versioned() {
        assert!(validate(&document(80), true).is_ok());
        assert!(validate(&document(2), false).is_err());
        assert!(validate(&document(1), true).is_err());
        let mut invalid = document(2); invalid["blocks"][0]["children"][0]["props"]["width"] = json!(0);
        assert!(validate(&invalid, true).is_err());
    }
    #[test]
    fn exact_insertion_preserves_all_other_columns_and_weights() {
        let before = document(3); let mut after = before.clone();
        after["blocks"][0]["children"][1]["children"].as_array_mut().unwrap().extend([text("new-a"),text("new-b")]);
        let (path, index, added) = insertion(&before, &after, 2).unwrap();
        assert_eq!(path, "/blocks/0/children/1/children"); assert_eq!(index, 1); assert_eq!(added.len(), 2);
        after["blocks"][0]["children"][0]["props"]["width"] = json!(2);
        assert!(insertion(&before, &after, 2).is_err());
    }
}
