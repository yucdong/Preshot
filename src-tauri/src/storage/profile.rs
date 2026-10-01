//! The small locator survives uninstall; all editable data belongs to its selected root.
use super::*;

const LOCATOR: &str = "profile.json";
const MARKER: &str = ".preshot-data-id";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Profile {
    schema_version: u32,
    data_directory: PathBuf,
    data_id: String,
    #[serde(default)]
    setup_confirmed: bool,
}

pub(crate) fn default_home() -> Result<PathBuf> {
    let variable = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    let root = std::env::var_os(variable).ok_or_else(|| err("User profile is unavailable"))?;
    Ok(PathBuf::from(root).join(".preshot"))
}

fn read(anchor: &Path) -> Result<Option<Profile>> {
    let path = anchor.join(LOCATOR);
    if !path.try_exists().map_err(err)? {
        return Ok(None);
    }
    let value: Profile = read_json(&path)?;
    if value.schema_version != 1 || !value.data_directory.is_absolute() {
        return Err(err(
            "Invalid profile.json. Restore the saved data-directory record.",
        ));
    }
    files::uuid(&value.data_id)?;
    Ok(Some(value))
}

fn verify(value: &Profile) -> Result<PathBuf> {
    let root = files::directory(&value.data_directory)
        .map_err(|_| err("The saved data directory is unavailable. Reconnect its drive and check again; no replacement data was created."))?;
    let id: String = read_json(&root.join(MARKER))?;
    if id != value.data_id {
        return Err(err(
            "The saved data directory has a different identity. Restore the original directory.",
        ));
    }
    Ok(root)
}

pub(crate) fn resolve() -> Result<PathBuf> {
    resolve_in(&default_home()?)
}

fn resolve_in(anchor: &Path) -> Result<PathBuf> {
    let value = read(anchor)?
        .ok_or_else(|| err("Choose the project working directory on first launch."))?;
    verify(&value)
}

pub(super) fn status_in(anchor: &Path) -> Result<StorageInfo> {
    ensure_home(anchor)?;
    let Some(value) = read(anchor)? else {
        return Ok(StorageInfo {
            configuration_directory: display(anchor),
            existing_working_directory: detect_existing_data(anchor)?.then(|| display(anchor)),
            application_directory: display(&application_directory()?),
            library_directory: display(&anchor.join("library")),
            needs_setup: true,
            pending_move: false,
            problem: None,
            generation: 0,
        });
    };
    match verify(&value) {
        Ok(root) => {
            let mut info = super::status_in(&root)?;
            if info.needs_setup {
                info.needs_setup = false;
                info.problem = Some("The saved library configuration is missing. Restore the data-directory backup before continuing.".into());
            } else if !value.setup_confirmed && info.problem.is_none() && !info.pending_move {
                // Earlier locators receive the keep/switch choice once. Confirmed
                // profiles bypass setup on later launches and reinstalls.
                info.needs_setup = true;
            }
            Ok(info)
        }
        Err(error) => Ok(StorageInfo {
            configuration_directory: display(&value.data_directory),
            existing_working_directory: Some(display(&value.data_directory)),
            application_directory: display(&application_directory()?),
            library_directory: display(&value.data_directory.join("library")),
            needs_setup: false,
            pending_move: false,
            problem: Some(error.message),
            generation: 0,
        }),
    }
}

fn detect_existing_data(root: &Path) -> Result<bool> {
    for name in [
        MARKER,
        CONFIG,
        "settings.json",
        "workspace.json",
        "projects",
        "library",
    ] {
        if root.join(name).try_exists().map_err(err)? {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
fn configure_in(anchor: &Path, path: &Path) -> Result<()> {
    configure_with_confirmation_in(anchor, path, false)
}

pub(super) fn configure_with_confirmation_in(
    anchor: &Path,
    path: &Path,
    confirm_switch: bool,
) -> Result<()> {
    ensure_home(anchor)?;
    let _guard = files::Lock::acquire(&anchor.join(".profile.lock"))?;
    let previous = read(anchor)?;
    if let Some(previous) = &previous {
        let root = verify(previous)?;
        if path.try_exists().map_err(err)? && files::directory(path)? == root {
            let info = super::status_in(&root)?;
            if info.needs_setup || info.pending_move || info.problem.is_some() {
                return Err(err("Restore the saved library configuration or finish its pending move before continuing."));
            }
            if !previous.setup_confirmed {
                write_json(
                    &anchor.join(LOCATOR),
                    &Profile {
                        schema_version: 1,
                        data_directory: root,
                        data_id: previous.data_id.clone(),
                        setup_confirmed: true,
                    },
                )?;
            }
            return Ok(());
        }
        if previous.setup_confirmed {
            return Err(err(
                "The data directory is already configured. Restart using the saved directory.",
            ));
        }
        if root.join(TRANSACTION).try_exists().map_err(err)? {
            return Err(err("Finish or cancel the pending library move first."));
        }
    }
    let default = files::directory(anchor)?;
    // Reuse the library path protections but allow the exact default profile directory.
    let root = if path.is_absolute() && path.exists() && files::directory(path)? == default {
        default.clone()
    } else {
        destination(anchor, path)?
    };
    let existing =
        previous
            .as_ref()
            .map(|p| p.data_directory.clone())
            .or(if detect_existing_data(anchor)? {
                Some(default.clone())
            } else {
                None
            });
    let source = existing.as_deref().map(files::directory).transpose()?;
    let switching = source.as_ref().is_some_and(|source| *source != root);
    if switching && !confirm_switch {
        return Err(err("Confirm switching the project working directory. Existing materials, settings and projects will not be carried over."));
    }
    if switching
        && source
            .as_ref()
            .is_some_and(|source| root.starts_with(source) || source.starts_with(&root))
    {
        return Err(err(
            "Choose a directory separate from the existing working directory.",
        ));
    }
    let _source_guard = if switching {
        source.as_deref().map(lock).transpose()?
    } else {
        None
    };
    if switching
        && source
            .as_ref()
            .is_some_and(|source| source.join(TRANSACTION).exists())
    {
        return Err(err("Finish or cancel the pending library move first."));
    }
    if root != default && (root.starts_with(&default) || root.join("profile.json").exists()) {
        return Err(err(
            "Choose a separate data directory, not a child of the default profile.",
        ));
    }
    if root.exists()
        && root != default
        && !root.join(MARKER).exists()
        && fs::read_dir(&root).map_err(err)?.next().is_some()
    {
        return Err(err(
            "Choose an empty directory or an existing Preshot data directory.",
        ));
    }
    if !root.exists() {
        fs::create_dir(&root).map_err(err)?;
    }
    let root = files::directory(&root)?;
    // Marker is written first, so an interrupted initialization can safely resume.
    let id = if root.join(MARKER).exists() {
        let id: String = read_json(&root.join(MARKER))?;
        files::uuid(&id)?;
        id
    } else {
        let id = uuid::Uuid::new_v4().to_string();
        write_json(&root.join(MARKER), &id)?;
        id
    };
    let info = super::status_in(&root)?;
    if let Some(problem) = info.problem {
        return Err(err(problem));
    }
    if info.pending_move {
        return Err(err("Finish or cancel the pending library move first."));
    }
    if info.needs_setup {
        super::configure_in(&root, &root.join("library"), false)?;
    }
    // New custom profiles must not inherit the unrelated default profile's old registry.
    if (root != default || switching) && !root.join("workspace.json").exists() {
        workspace_registry::write(&root, serde_json::json!({"schemaVersion":1,"projects":[]}))?;
    }
    write_json(
        &anchor.join(LOCATOR),
        &Profile {
            schema_version: 1,
            data_directory: root,
            data_id: id,
            setup_confirmed: true,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn require_review(anchor: &Path) {
        let mut locator: serde_json::Value = read_json(&anchor.join(LOCATOR)).unwrap();
        locator.as_object_mut().unwrap().remove("setupConfirmed");
        write_json(&anchor.join(LOCATOR), &locator).unwrap();
    }

    #[test]
    fn switching_legacy_root_requires_confirmation_and_keeps_original_data() {
        let temp = tempfile::tempdir().unwrap();
        let anchor = temp.path().join(".preshot");
        ensure_home(&anchor).unwrap();
        super::super::configure_in(&anchor, &anchor.join("library"), false).unwrap();
        fs::write(anchor.join("settings.json"), b"old-settings").unwrap();
        let before_db = fs::read(anchor.join("library/library.db")).unwrap();
        let target = temp.path().join("new-workspace");
        assert!(configure_in(&anchor, &target).is_err());
        assert!(!target.exists());
        assert!(!anchor.join(LOCATOR).exists());
        configure_with_confirmation_in(&anchor, &target, true).unwrap();
        assert_eq!(resolve_in(&anchor).unwrap(), target.canonicalize().unwrap());
        assert_eq!(
            fs::read(anchor.join("library/library.db")).unwrap(),
            before_db
        );
        assert_eq!(
            fs::read(anchor.join("settings.json")).unwrap(),
            b"old-settings"
        );
        assert!(!target.join("settings.json").exists());
        let registry: serde_json::Value = read_json(&target.join("workspace.json")).unwrap();
        assert_eq!(registry["workspace"]["projects"], serde_json::json!([]));
    }

    #[test]
    fn older_custom_root_can_switch_once_but_failure_preserves_locator() {
        let temp = tempfile::tempdir().unwrap();
        let anchor = temp.path().join(".preshot");
        let old = temp.path().join("old-data");
        configure_in(&anchor, &old).unwrap();
        require_review(&anchor);
        let before = fs::read(anchor.join(LOCATOR)).unwrap();
        let occupied = temp.path().join("occupied");
        fs::create_dir(&occupied).unwrap();
        fs::write(occupied.join("keep"), b"untouched").unwrap();
        assert!(configure_with_confirmation_in(&anchor, &occupied, true).is_err());
        assert!(configure_with_confirmation_in(&anchor, &old.join("child"), true).is_err());
        assert_eq!(fs::read(anchor.join(LOCATOR)).unwrap(), before);
        let target = temp.path().join("new-data");
        assert!(configure_in(&anchor, &target).is_err());
        configure_with_confirmation_in(&anchor, &target, true).unwrap();
        assert!(!status_in(&anchor).unwrap().needs_setup);
        assert!(old.join("library/library.db").exists());
        // Mounted editors must never have their data root changed under them.
        assert!(configure_with_confirmation_in(&anchor, &old, true).is_err());
        assert_eq!(resolve_in(&anchor).unwrap(), target.canonicalize().unwrap());
    }

    #[test]
    fn switching_to_existing_data_reuses_its_library_and_registry_without_merging() {
        let temp = tempfile::tempdir().unwrap();
        let other_anchor = temp.path().join("other-profile");
        let target = temp.path().join("existing-data");
        configure_in(&other_anchor, &target).unwrap();
        let target_registry = serde_json::json!({"schemaVersion":2,
            "projects":[{"projectId":"p", "path":"D:/p", "name":"Portrait",
                "coverImage":null, "status":"available", "createdAt":"a", "updatedAt":"b", "lastOpenedAt":"c"}],
            "groups":[{"id":"default", "name":"default", "collapsed":false},
                {"id":"portraits", "name":"Portraits", "collapsed":true}],
            "projectGroupIds":{"p":"portraits"}});
        workspace_registry::write(&target, target_registry.clone()).unwrap();
        let before = fs::read(target.join("workspace.json")).unwrap();
        let id = read_config(&target).unwrap().unwrap().library_id;
        let anchor = temp.path().join(".preshot");
        configure_in(&anchor, &anchor).unwrap();
        require_review(&anchor);
        configure_with_confirmation_in(&anchor, &target, true).unwrap();
        assert_eq!(read_config(&target).unwrap().unwrap().library_id, id);
        assert_eq!(fs::read(target.join("workspace.json")).unwrap(), before);
        assert_eq!(
            workspace_registry::read(
                &resolve_in(&anchor).unwrap(),
                &anchor.join("workspace.json")
            )
            .unwrap(),
            Some(target_registry)
        );
        assert!(anchor.join("library/library.db").exists());
    }

    #[test]
    fn setup_detects_legacy_data_without_creating_or_adopting_a_library() {
        let temp = tempfile::tempdir().unwrap();
        let anchor = temp.path().join(".preshot");
        let fresh = serde_json::to_value(status_in(&anchor).unwrap()).unwrap();
        assert_eq!(fresh["existingWorkingDirectory"], serde_json::Value::Null);
        fs::create_dir(anchor.join("projects")).unwrap();
        fs::write(anchor.join("projects/retained.txt"), b"keep").unwrap();
        let detected = serde_json::to_value(status_in(&anchor).unwrap()).unwrap();
        assert_eq!(detected["existingWorkingDirectory"], display(&anchor));
        assert!(detected["needsSetup"].as_bool().unwrap());
        assert!(!anchor.join(CONFIG).exists());
        assert!(!anchor.join("library").exists());
    }

    #[test]
    fn older_locator_requests_one_setup_review_and_retains_its_custom_root() {
        let temp = tempfile::tempdir().unwrap();
        let anchor = temp.path().join(".preshot");
        let chosen = temp.path().join("existing-custom");
        configure_in(&anchor, &chosen).unwrap();
        let mut locator: serde_json::Value = read_json(&anchor.join(LOCATOR)).unwrap();
        locator.as_object_mut().unwrap().remove("setupConfirmed");
        write_json(&anchor.join(LOCATOR), &locator).unwrap();
        let info = status_in(&anchor).unwrap();
        assert!(info.needs_setup);
        assert_eq!(
            info.configuration_directory,
            display(&chosen.canonicalize().unwrap())
        );
        configure_in(&anchor, &chosen).unwrap();
        assert!(!status_in(&anchor).unwrap().needs_setup);
    }

    #[test]
    fn first_launch_waits_then_remembers_custom_root_and_its_library() {
        let temp = tempfile::tempdir().unwrap();
        let anchor = temp.path().join(".preshot");
        assert!(status_in(&anchor).unwrap().needs_setup);
        assert!(!anchor.join("library").exists());
        let chosen = temp.path().join("摄影工作目录");
        configure_in(&anchor, &chosen).unwrap();
        assert_eq!(resolve_in(&anchor).unwrap(), chosen.canonicalize().unwrap());
        assert!(chosen.join("library/library.db").is_file());
        fs::write(chosen.join("settings.json"), b"{\"theme\":\"dark\"}").unwrap();
        let first = fs::read(anchor.join(LOCATOR)).unwrap();
        assert!(!status_in(&anchor).unwrap().needs_setup);
        configure_in(&anchor, &chosen).unwrap();
        assert_eq!(fs::read(anchor.join(LOCATOR)).unwrap(), first);
        assert!(chosen.join("settings.json").exists());
    }

    #[test]
    fn default_root_reuses_existing_library_and_keeps_project_registry() {
        let temp = tempfile::tempdir().unwrap();
        let anchor = temp.path().join(".preshot");
        ensure_home(&anchor).unwrap();
        super::super::configure_in(&anchor, &anchor.join("library"), false).unwrap();
        let id = read_config(&anchor).unwrap().unwrap().library_id;
        workspace_registry::write(
            &anchor,
            serde_json::json!({"schemaVersion":1,"projects":[]}),
        )
        .unwrap();
        let before = fs::read(anchor.join("workspace.json")).unwrap();
        configure_in(&anchor, &anchor).unwrap();
        assert_eq!(read_config(&anchor).unwrap().unwrap().library_id, id);
        assert_eq!(fs::read(anchor.join("workspace.json")).unwrap(), before);
    }

    #[test]
    fn unavailable_changed_or_corrupt_profile_never_creates_replacement_data() {
        let temp = tempfile::tempdir().unwrap();
        let anchor = temp.path().join(".preshot");
        let chosen = temp.path().join("data");
        configure_in(&anchor, &chosen).unwrap();
        fs::rename(&chosen, temp.path().join("offline")).unwrap();
        assert!(status_in(&anchor).unwrap().problem.is_some());
        assert!(resolve_in(&anchor).is_err());
        assert!(!chosen.exists());
        fs::create_dir(&chosen).unwrap();
        write_json(&chosen.join(MARKER), &uuid::Uuid::new_v4().to_string()).unwrap();
        assert!(resolve_in(&anchor).is_err());
        fs::write(anchor.join(LOCATOR), b"invalid").unwrap();
        assert!(status_in(&anchor).is_err());
        assert!(!anchor.join("library").exists());
    }

    #[test]
    fn confirmed_profile_with_missing_library_metadata_is_recovery_not_setup() {
        let temp = tempfile::tempdir().unwrap();
        let anchor = temp.path().join(".preshot");
        let chosen = temp.path().join("data");
        configure_in(&anchor, &chosen).unwrap();
        fs::rename(chosen.join("library"), chosen.join("retained-library")).unwrap();
        fs::rename(chosen.join(CONFIG), chosen.join("retained-storage.json")).unwrap();
        let info = status_in(&anchor).unwrap();
        assert!(!info.needs_setup);
        assert!(info.problem.is_some());
        assert!(!chosen.join("library").exists());
    }

    #[test]
    fn unrelated_and_nested_roots_are_rejected_without_publishing_locator() {
        let temp = tempfile::tempdir().unwrap();
        let anchor = temp.path().join(".preshot");
        let other = temp.path().join("other");
        fs::create_dir(&other).unwrap();
        fs::write(other.join("keep"), b"unchanged").unwrap();
        assert!(configure_in(&anchor, &other).is_err());
        assert!(configure_in(&anchor, &anchor.join("nested")).is_err());
        assert!(!anchor.join(LOCATOR).exists());
        assert_eq!(fs::read(other.join("keep")).unwrap(), b"unchanged");
    }
}
