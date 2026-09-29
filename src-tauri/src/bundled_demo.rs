//! Immutable application assets. Startup copies these into a user-owned project;
//! the MSI never authors files in the profile.
use std::{fs, io::{self, Write}, path::Path};

use crate::error::CommandError;

macro_rules! asset {
    ($path:literal) => { ($path, include_bytes!(concat!("../../samples/nanjing-bridge/", $path)).as_slice()) };
}

pub(crate) const FILES: &[(&str, &[u8])] = &[
    asset!("references/0001.jpg"), asset!("references/0002.png"),
    asset!("references/0003.png"), asset!("references/0004.png"),
    asset!("references/0005.png"), asset!("references/0006.jpg"), asset!("references/0007.jpg"),
    asset!("media/bridge-cover.jpg"), asset!("media/bridge-motion.mp4"),
    asset!("media/ready-tones.wav"), asset!("media/shot-list.txt"), asset!("CREDITS.md"),
];

pub(crate) fn plan() -> serde_json::Value {
    let manifest: serde_json::Value = serde_json::from_str(include_str!("../../samples/nanjing-bridge/.preshotproj"))
        .expect("the bundled project is validated before packaging");
    manifest["plan"].clone()
}

pub(crate) fn is_demo_manifest(bytes: &[u8]) -> bool {
    serde_json::from_slice::<serde_json::Value>(bytes)
        .map(|manifest| manifest["plan"] == plan()).unwrap_or(false)
}

fn error(operation: &str, error: io::Error) -> CommandError {
    CommandError::new("bundled_demo_io_failed", format!("Unable to {operation} bundled demo assets: {error}"))
}

pub(crate) fn write_assets(root: &Path) -> Result<(), CommandError> {
    for folder in ["references", "media"] {
        fs::create_dir(root.join(folder)).map_err(|e| error("create", e))?;
    }
    for (relative, bytes) in FILES {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(root.join(relative))
            .map_err(|e| error("create", e))?;
        file.write_all(bytes).and_then(|_| file.sync_all()).map_err(|e| error("write", e))?;
    }
    Ok(())
}

/// Only exact owned files are removable. Unknown files and links are rejected.
pub(crate) fn ensure_unchanged(root: &Path) -> Result<(), CommandError> {
    fn check(root: &Path, relative: &str) -> io::Result<()> {
        for entry in fs::read_dir(root.join(relative))? {
            let entry = entry?;
            let path = if relative.is_empty() { entry.file_name().to_string_lossy().into_owned() }
                else { format!("{relative}/{}", entry.file_name().to_string_lossy()) };
            let kind = entry.file_type()?;
            if kind.is_dir() && (path == "references" || path == "media") { check(root, &path)?; }
            else if kind.is_file() && path == ".preshotproj" { continue; }
            else if kind.is_file() && FILES.iter().any(|(name, _)| *name == path) { continue; }
            else { return Err(io::Error::other("The demo contains additional files or links; preserving it")); }
        }
        Ok(())
    }
    check(root, "").map_err(|e| error("verify", e))?;
    for (relative, bytes) in FILES {
        if fs::read(root.join(relative)).map_err(|e| error("read", e))? != *bytes {
            return Err(CommandError::new("bundled_demo_changed", "Demo assets were edited; preserving the project"));
        }
    }
    Ok(())
}

/// Called only for this invocation's new directory or verified rollback quarantine.
pub(crate) fn remove_unchanged_assets(root: &Path) -> Result<(), CommandError> {
    for (relative, bytes) in FILES {
        let path = root.join(relative);
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_file() && fs::read(&path).map_err(|e| error("read", e))? == *bytes => {
                fs::remove_file(path).map_err(|e| error("remove", e))?;
            },
            Err(e) if e.kind() == io::ErrorKind::NotFound => {},
            _ => return Err(CommandError::new("bundled_demo_changed", "Demo assets changed during cleanup; preserving the project")),
        }
    }
    for folder in ["references", "media"] {
        match fs::remove_dir(root.join(folder)) {
            Ok(()) => {}, Err(e) if e.kind() == io::ErrorKind::NotFound => {},
            Err(e) => return Err(error("remove directory for", e)),
        }
    }
    Ok(())
}

pub(crate) fn restore_missing_assets(root: &Path) -> Result<(), CommandError> {
    for folder in ["references", "media"] {
        let path = root.join(folder);
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {},
            Err(e) if e.kind() == io::ErrorKind::NotFound => fs::create_dir(path).map_err(|e| error("restore", e))?,
            _ => return Err(CommandError::new("bundled_demo_changed", "Demo directory changed during recovery; preserving it")),
        }
    }
    for (relative, bytes) in FILES {
        match fs::OpenOptions::new().write(true).create_new(true).open(root.join(relative)) {
            Ok(mut file) => file.write_all(bytes).map_err(|e| error("restore", e))?,
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {},
            Err(e) => return Err(error("restore", e)),
        }
    }
    Ok(())
}
