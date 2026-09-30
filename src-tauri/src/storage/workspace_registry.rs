use super::*;

fn registry_lock(home: &Path) -> Result<files::Lock> {
    // Moving a large library must not block unrelated project-list saves.
    ensure_home(home)?;
    files::Lock::acquire(&home.join(".workspace-registry.lock"))
}

fn validate(value: &serde_json::Value) -> Result<()> {
    if value.get("schemaVersion").and_then(|v| v.as_u64()) != Some(1)
        || !value.as_object().is_some_and(|v| v.len() == 2)
        || !value.get("projects").is_some_and(|v| v.is_array())
    {
        return Err(err(
            "Workspace metadata is malformed. Preserve workspace.json and restore a backup.",
        ));
    }
    for record in value["projects"].as_array().unwrap() {
        if !record.as_object().is_some_and(|r| r.len() == 8)
            || [
                "projectId",
                "path",
                "name",
                "createdAt",
                "updatedAt",
                "lastOpenedAt",
            ]
            .iter()
            .any(|key| !record.get(key).is_some_and(|v| v.is_string()))
            || !record
                .get("coverImage")
                .is_some_and(|v| v.is_null() || v.is_string())
            || !matches!(
                record.get("status").and_then(|v| v.as_str()),
                Some("available" | "unavailable")
            )
        {
            return Err(err(
                "Workspace project metadata is malformed. Preserve the original registry.",
            ));
        }
    }
    Ok(())
}
pub(super) fn read(home: &Path, legacy: &Path) -> Result<Option<serde_json::Value>> {
    let _guard = registry_lock(home)?;
    let path = home.join("workspace.json");
    let source = if path.exists() { &path } else { legacy };
    if !source.try_exists().map_err(err)? {
        return Ok(None);
    }
    let mut envelope: serde_json::Value = read_json(source)?;
    // plugin-store can leave a valid empty object before its first workspace save.
    if source != &path && envelope.as_object().is_some_and(|o| o.is_empty()) {
        envelope = serde_json::json!({"workspace":{"schemaVersion":1,"projects":[]}});
    }
    let value = envelope
        .get("workspace")
        .ok_or_else(|| err("Workspace metadata is malformed. Preserve the original file."))?;
    validate(value)?;
    if source != &path {
        write_json(&path, &envelope)?;
    }
    Ok(Some(value.clone()))
}
pub(super) fn write(home: &Path, value: serde_json::Value) -> Result<()> {
    validate(&value)?;
    let _guard = registry_lock(home)?;
    let path = home.join("workspace.json");
    if path.exists() {
        let old: serde_json::Value = read_json(&path)?;
        validate(
            old.get("workspace")
                .ok_or_else(|| err("Workspace metadata is malformed"))?,
        )?;
        write_json(&home.join("workspace.previous.json"), &old)?;
    }
    write_json(&path, &serde_json::json!({"workspace":value}))
}
