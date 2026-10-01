use super::*;

fn registry_lock(home: &Path) -> Result<files::Lock> {
    // Moving a large library must not block unrelated project-list saves.
    ensure_home(home)?;
    files::Lock::acquire(&home.join(".workspace-registry.lock"))
}

fn validate(value: &serde_json::Value) -> Result<()> {
    let version = value.get("schemaVersion").and_then(|v| v.as_u64());
    if !matches!(version, Some(1 | 2))
        || !value
            .as_object()
            .is_some_and(|v| v.len() == if version == Some(2) { 4 } else { 2 })
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
    if version == Some(2) {
        validate_organization(value)?;
    }
    Ok(())
}

fn validate_organization(value: &serde_json::Value) -> Result<()> {
    let invalid = || {
        err("Workspace organization is malformed. Preserve workspace.json and restore a backup.")
    };
    let groups = value
        .get("groups")
        .and_then(|v| v.as_array())
        .ok_or_else(invalid)?;
    if groups.is_empty() {
        return Err(invalid());
    }
    let mut ids = std::collections::HashSet::new();
    for (index, group) in groups.iter().enumerate() {
        let id = group
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(invalid)?;
        let name = group
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(invalid)?;
        if !group.as_object().is_some_and(|g| g.len() == 3)
            || !group.get("collapsed").is_some_and(|v| v.is_boolean())
            || id.trim().is_empty()
            || name.trim().is_empty()
            || !ids.insert(id)
            || (index == 0 && (id != "default" || name != "default"))
            || (index > 0 && id == "default")
        {
            return Err(invalid());
        }
    }
    let projects: std::collections::HashSet<_> = value["projects"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|p| p["projectId"].as_str())
        .collect();
    let assignments = value
        .get("projectGroupIds")
        .and_then(|v| v.as_object())
        .ok_or_else(invalid)?;
    for (project, group) in assignments {
        let group = group.as_str().ok_or_else(invalid)?;
        if !projects.contains(project.as_str()) || group == "default" || !ids.contains(group) {
            return Err(invalid());
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
        if old["workspace"]["schemaVersion"] == 2 && value["schemaVersion"] == 1 {
            return Err(err(
                "Refusing to downgrade workspace metadata and discard project groups.",
            ));
        }
        // Keep the migration source after subsequent v2 saves rotate the normal backup.
        let migration_backup = home.join("workspace.v1.backup.json");
        if old["workspace"]["schemaVersion"] == 1
            && value["schemaVersion"] == 2
            && !migration_backup.try_exists().map_err(err)?
        {
            write_json(&migration_backup, &old)?;
        }
        write_json(&home.join("workspace.previous.json"), &old)?;
    }
    write_json(&path, &serde_json::json!({"workspace":value}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grouped() -> serde_json::Value {
        serde_json::json!({"schemaVersion":2,
            "projects":[{"projectId":"p", "path":"D:/p", "name":"南京", "coverImage":null,
                "status":"available", "createdAt":"a", "updatedAt":"b", "lastOpenedAt":"c"}],
            "groups":[{"id":"default", "name":"default", "collapsed":false},
                {"id":"g", "name":"人像", "collapsed":true}], "projectGroupIds":{"p":"g"}})
    }

    #[test]
    fn grouped_workspace_roundtrips_and_retains_v1_backup() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path();
        let old = serde_json::json!({"schemaVersion":1,"projects":[]});
        write(home, old.clone()).unwrap();
        write(home, grouped()).unwrap();
        assert_eq!(
            read(home, &home.join("absent-legacy")).unwrap(),
            Some(grouped())
        );
        let backup: serde_json::Value = read_json(&home.join("workspace.previous.json")).unwrap();
        assert_eq!(backup["workspace"], old);
        write(home, grouped()).unwrap();
        let migration_backup: serde_json::Value =
            read_json(&home.join("workspace.v1.backup.json")).unwrap();
        assert_eq!(migration_backup["workspace"], old);
        assert!(
            write(home, old).is_err(),
            "v2 must not be downgraded and lose groups"
        );
    }

    #[test]
    fn corrupt_organization_is_rejected_without_overwriting_registry() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path();
        write(home, grouped()).unwrap();
        let before = fs::read(home.join("workspace.json")).unwrap();
        let mut bad = grouped();
        bad["projectGroupIds"]["p"] = serde_json::json!("missing");
        assert!(write(home, bad).is_err());
        let mut bad = grouped();
        bad["groups"][0]["name"] = serde_json::json!("默认分组");
        assert!(write(home, bad).is_err());
        let mut bad = grouped();
        bad["projectGroupIds"]["orphan"] = serde_json::json!("g");
        assert!(write(home, bad).is_err());
        assert_eq!(fs::read(home.join("workspace.json")).unwrap(), before);
        fs::write(home.join("workspace.json"), b"broken").unwrap();
        assert!(read(home, &home.join("absent-legacy")).is_err());
        assert!(write(home, grouped()).is_err());
        assert_eq!(fs::read(home.join("workspace.json")).unwrap(), b"broken");
    }

    #[test]
    fn failed_backup_keeps_group_membership_and_can_be_retried() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path();
        write(home, grouped()).unwrap();
        let before = fs::read(home.join("workspace.json")).unwrap();
        // A directory at the backup filename deterministically rejects the write.
        let backup = home.join("workspace.previous.json");
        fs::create_dir(&backup).unwrap();
        let mut deleted = grouped();
        deleted["groups"].as_array_mut().unwrap().pop();
        deleted["projectGroupIds"] = serde_json::json!({});
        assert!(write(home, deleted.clone()).is_err());
        assert_eq!(fs::read(home.join("workspace.json")).unwrap(), before);
        fs::remove_dir(&backup).unwrap();
        write(home, deleted.clone()).unwrap();
        assert_eq!(
            read(home, &home.join("absent-legacy")).unwrap(),
            Some(deleted)
        );
    }
}
