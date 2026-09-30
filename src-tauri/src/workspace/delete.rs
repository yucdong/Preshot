use super::{
    canonicalize_directory, ProjectManifest, LEGACY_MANIFEST_FILE_NAME, MANIFEST_FILE_NAME,
};
use crate::error::CommandError;
use std::{
    fs,
    io::{ErrorKind, Write},
    path::{Component, Path},
};

fn failure(message: impl std::fmt::Display) -> CommandError {
    CommandError::new(
        "project_delete_failed",
        format!("Unable to delete project folder: {message}"),
    )
}

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    metadata.file_type().is_symlink()
}

fn remove_link(path: &Path, metadata: &fs::Metadata) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // symlink_metadata().is_dir() is false for directory links. Windows
        // still requires RemoveDirectory, identified by FILE_ATTRIBUTE_DIRECTORY.
        if metadata.file_attributes() & 0x10 != 0 {
            return fs::remove_dir(path);
        }
    }
    #[cfg(not(windows))]
    let _ = metadata;
    fs::remove_file(path)
}

fn read_identity(marker: &Path, project_id: &str) -> Result<Vec<u8>, CommandError> {
    let metadata = fs::symlink_metadata(marker).map_err(failure)?;
    if is_link(&metadata) || !metadata.is_file() {
        return Err(failure("Project manifest must be a regular file"));
    }
    let bytes = fs::read(marker).map_err(failure)?;
    let manifest: ProjectManifest = serde_json::from_slice(&bytes).map_err(failure)?;
    super::validate_manifest(&manifest)?;
    if manifest.id != project_id {
        return Err(failure(
            "Project identity changed; select the project again",
        ));
    }
    Ok(bytes)
}

pub(super) fn delete_project_directory(path: &Path, project_id: &str) -> Result<(), CommandError> {
    if !path.is_absolute()
        || path.file_name().is_none()
        || project_id.is_empty()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
    {
        return Err(failure(
            "Select an absolute project folder, not a drive root or a relative path",
        ));
    }
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        // Allows retry after files were deleted but registry persistence failed.
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(failure(error)),
    };
    if is_link(&metadata) || !metadata.is_dir() {
        return Err(failure(
            "The project folder must be a real directory, not a link",
        ));
    }
    crate::library::files::no_links(path)?;
    let root = canonicalize_directory(path, "project_not_found", "project_not_directory")?;
    if root.file_name().is_none() || root.parent().is_none() {
        return Err(failure("Cannot delete a filesystem root"));
    }
    // Never accept the profile, Preshot user-data root or default projects root.
    if let Ok(home) = super::preshot_home() {
        for protected in [
            home.parent().map(Path::to_path_buf),
            Some(home.clone()),
            Some(home.join("projects")),
        ]
        .into_iter()
        .flatten()
        {
            if protected
                .canonicalize()
                .is_ok_and(|protected| protected == root || protected.starts_with(&root))
            {
                return Err(failure(
                    "Cannot delete a user-data root; select an individual project",
                ));
            }
        }
    }
    let marker = if root.join(MANIFEST_FILE_NAME).exists() {
        MANIFEST_FILE_NAME
    } else {
        LEGACY_MANIFEST_FILE_NAME
    };
    let marker_path = root.join(marker);
    read_identity(&marker_path, project_id)?;
    let lock = crate::library::files::project_lock(&root)?;
    // Revalidate after waiting for another project writer, retaining its latest
    // manifest bytes for error recovery. Invalid targets never get a lock file.
    let bytes = read_identity(&marker_path, project_id)?;

    // Retain the identity marker until all contents are gone, so a locked file
    // failure remains visible and retryable. Includes exports and arbitrary
    // user files, as explicitly described in the confirmation dialog.
    for entry in fs::read_dir(&root).map_err(failure)? {
        let entry = entry.map_err(failure)?;
        if entry.file_name() == marker || entry.file_name() == ".preshot-project.lock" {
            continue;
        }
        let child = entry.path();
        let metadata = fs::symlink_metadata(&child).map_err(failure)?;
        let result = if is_link(&metadata) {
            remove_link(&child, &metadata)
        } else if metadata.is_dir() {
            // std removal does not follow directory symlinks/junctions.
            fs::remove_dir_all(&child)
        } else {
            fs::remove_file(&child)
        };
        result.map_err(|error| {
            failure(format!(
                "{child:?}: {error}. Close files using this folder and retry"
            ))
        })?;
    }
    fs::remove_file(&marker_path).map_err(failure)?;
    // Windows keeps deleted files pending until their handles close. Remove
    // the manifest under the lock, then release its handle before the folder.
    drop(lock);
    if let Err(error) =
        fs::remove_file(root.join(".preshot-project.lock")).and_then(|_| fs::remove_dir(&root))
    {
        // Preserve identity for retries without overwriting a concurrently
        // recreated manifest. Do not claim an incomplete deletion succeeded.
        if let Ok(mut file) = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&marker_path)
        {
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(failure)?;
        }
        return Err(failure(error));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::create_project_in;

    #[test]
    fn deletes_the_whole_project_and_preserves_sibling_files() {
        let temp = tempfile::tempdir().unwrap();
        let project = create_project_in(temp.path(), "Delete me").unwrap();
        let root = Path::new(&project.path);
        for name in [
            "references/original.jpg",
            "media/paste.png",
            "exports/output.pdf",
            "nested/user/notes.txt",
        ] {
            let file = root.join(name);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(file, b"owned").unwrap();
        }
        let sibling = temp.path().join("keep.txt");
        fs::write(&sibling, b"keep").unwrap();
        delete_project_directory(root, &project.manifest.id).unwrap();
        assert!(!root.exists());
        assert_eq!(fs::read(sibling).unwrap(), b"keep");
        delete_project_directory(root, &project.manifest.id).unwrap();
    }

    #[test]
    fn refuses_wrong_identity_missing_manifest_and_relative_paths() {
        let temp = tempfile::tempdir().unwrap();
        let project = create_project_in(temp.path(), "Keep me").unwrap();
        let root = Path::new(&project.path);
        assert!(delete_project_directory(root, "different-id").is_err());
        assert!(root.join(MANIFEST_FILE_NAME).exists());
        assert!(!root.join(".preshot-project.lock").exists());
        assert!(delete_project_directory(temp.path(), &project.manifest.id).is_err());
        assert!(root.exists());
        assert!(delete_project_directory(Path::new("relative"), &project.manifest.id).is_err());
        assert!(delete_project_directory(&root.join(".."), &project.manifest.id).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn locked_files_keep_the_manifest_for_retry() {
        use std::os::windows::fs::OpenOptionsExt;
        let temp = tempfile::tempdir().unwrap();
        let project = create_project_in(temp.path(), "Locked").unwrap();
        let root = Path::new(&project.path);
        let file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .share_mode(0)
            .open(root.join("locked.jpg"))
            .unwrap();
        assert!(delete_project_directory(root, &project.manifest.id).is_err());
        assert!(root.join(MANIFEST_FILE_NAME).is_file());
        drop(file);
        delete_project_directory(root, &project.manifest.id).unwrap();
        assert!(!root.exists());
    }

    #[cfg(windows)]
    #[test]
    fn removes_nested_junctions_without_deleting_their_targets_and_rejects_linked_roots() {
        let temp = tempfile::tempdir().unwrap();
        let project = create_project_in(temp.path(), "Project").unwrap();
        let root = Path::new(&project.path);
        let outside = temp.path().join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("keep.txt"), b"keep").unwrap();
        let link = root.join("linked");
        assert!(std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&outside)
            .output()
            .unwrap()
            .status
            .success());
        assert!(delete_project_directory(&link, &project.manifest.id).is_err());
        fs::create_dir(root.join("nested")).unwrap();
        assert!(std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(root.join("nested/linked"))
            .arg(&outside)
            .output()
            .unwrap()
            .status
            .success());
        delete_project_directory(root, &project.manifest.id).unwrap();
        assert_eq!(fs::read(outside.join("keep.txt")).unwrap(), b"keep");
    }
}
