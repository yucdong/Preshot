use super::*;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    bytes: Option<u64>,
    hash: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Transfer {
    version: u32,
    source: Config,
    destination: PathBuf,
    entries: BTreeMap<String, Entry>,
}

fn require_checkpointed(root: &Path) -> Result<()> {
    for name in ["library.db-wal", "library.db-journal"] {
        let path = root.join(name);
        files::check_leaf(&path)?;
        if path.exists() && fs::metadata(path).map_err(err)?.len() > 0 {
            return Err(err("Library journal changed during the move. Preserve both directories, end this move, and retry."));
        }
    }
    Ok(())
}

fn digest(path: &Path) -> Result<String> {
    let mut input = File::open(path).map_err(err)?;
    let mut hash = Sha256::new();
    let mut buf = [0u8; 128 * 1024];
    loop {
        let n = input.read(&mut buf).map_err(err)?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn inventory(root: &Path) -> Result<BTreeMap<String, Entry>> {
    fn visit(root: &Path, current: &Path, entries: &mut BTreeMap<String, Entry>) -> Result<()> {
        for item in fs::read_dir(current).map_err(err)? {
            let path = item.map_err(err)?.path();
            files::no_links(&path)?;
            let relative = path
                .strip_prefix(root)
                .map_err(err)?
                .to_str()
                .ok_or_else(|| err("Library filename is not valid Unicode"))?
                .replace('\\', "/");
            if matches!(
                relative.as_str(),
                ".library.lock" | "library.db-wal" | "library.db-shm"
            ) {
                continue;
            }
            let meta = fs::metadata(&path).map_err(err)?;
            let entry = if meta.is_dir() {
                Entry {
                    bytes: None,
                    hash: None,
                }
            } else if meta.is_file() {
                Entry {
                    bytes: Some(meta.len()),
                    hash: Some(digest(&path)?),
                }
            } else {
                return Err(err("Library contains an unsupported file type"));
            };
            entries.insert(relative, entry);
            if meta.is_dir() {
                visit(root, &path, entries)?;
            }
        }
        Ok(())
    }
    let mut entries = BTreeMap::new();
    visit(root, root, &mut entries)?;
    Ok(entries)
}
fn relative(root: &Path, name: &str) -> Result<PathBuf> {
    if name.is_empty()
        || name.contains('\\')
        || name.contains(':')
        || name
            .split('/')
            .any(|s| s.is_empty() || s == "." || s == "..")
    {
        return Err(err("Invalid path in relocation journal"));
    }
    Ok(root.join(name))
}
// Resume an interrupted file only if every existing byte is an exact source
// prefix. Never truncate, replace or delete a changed destination file.
fn copy_file(source: &Path, target: &Path, length: u64) -> Result<()> {
    files::check_leaf(target)?;
    let mut input = File::open(source).map_err(err)?;
    let mut output = if target.exists() {
        OpenOptions::new()
            .read(true)
            .write(true)
            .open(target)
            .map_err(err)?
    } else {
        OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(target)
            .map_err(err)?
    };
    let existing = output.metadata().map_err(err)?.len();
    if existing > length {
        return Err(err(
            "A relocation destination file changed. Preserve both copies.",
        ));
    }
    let mut left = existing;
    let mut a = [0u8; 128 * 1024];
    let mut b = [0u8; 128 * 1024];
    while left > 0 {
        let n = left.min(a.len() as u64) as usize;
        input.read_exact(&mut a[..n]).map_err(err)?;
        output.read_exact(&mut b[..n]).map_err(err)?;
        if a[..n] != b[..n] {
            return Err(err(
                "A relocation destination file changed. No file was overwritten.",
            ));
        }
        left -= n as u64;
    }
    input.seek(SeekFrom::Start(existing)).map_err(err)?;
    output.seek(SeekFrom::Start(existing)).map_err(err)?;
    std::io::copy(&mut input, &mut output).map_err(err)?;
    output.flush().map_err(err)?;
    output.sync_all().map_err(err)
}
pub(super) fn move_in(home: &Path, path: Option<&Path>) -> Result<()> {
    let _guard = lock(home)?;
    let config = read_config(home)?.ok_or_else(|| err("Complete library setup first."))?;
    let journal = home.join(TRANSACTION);
    let (transfer, _source_lock) = if journal.exists() {
        if path.is_some() {
            return Err(err("Resume or cancel the previous library move first."));
        }
        let transfer: Transfer = read_json(&journal)?;
        if transfer.version != 1 {
            return Err(err("Unsupported relocation journal"));
        }
        if config.generation == transfer.source.generation + 1
            && config.library_path == transfer.destination
            && config.library_id == transfer.source.library_id
        {
            verify_root(&config)?;
            fs::remove_file(&journal).map_err(err)?;
            return Ok(());
        }
        if config.generation != transfer.source.generation
            || config.library_path != transfer.source.library_path
            || config.library_id != transfer.source.library_id
        {
            return Err(err("Relocation configuration conflict"));
        }
        let root = verify_root(&config)?;
        let guard = files::Lock::acquire(&root.join(".library.lock"))?;
        require_checkpointed(&root)?;
        if inventory(&root)? != transfer.entries {
            return Err(err(
                "Source library changed during relocation. Cancel the move and retry.",
            ));
        }
        (transfer, guard)
    } else {
        let target = destination(
            home,
            path.ok_or_else(|| err("No library move is pending."))?,
        )?;
        let source = verify_root(&config)?;
        if target.starts_with(&source) || source.starts_with(&target) {
            return Err(err(
                "Source and destination library directories must not overlap.",
            ));
        }
        if target.exists() && fs::read_dir(&target).map_err(err)?.next().is_some() {
            return Err(err(
                "The destination must be empty. Existing libraries are never merged.",
            ));
        }
        let guard = Store::open_root(&source)?.checkpoint_for_copy()?;
        let entries = inventory(&source)?;
        let total = entries
            .values()
            .filter_map(|e| e.bytes)
            .try_fold(0u64, |sum, n| sum.checked_add(n))
            .ok_or_else(|| err("Library size overflow"))?;
        let parent = target.parent().ok_or_else(|| err("Invalid destination"))?;
        if fs2::available_space(parent).map_err(err)? < total.saturating_add(16 * 1024 * 1024) {
            return Err(err(
                "Not enough free space to copy the library. The source was preserved.",
            ));
        }
        let transfer = Transfer {
            version: 1,
            source: config,
            destination: target,
            entries,
        };
        write_json(&journal, &transfer)?;
        (transfer, guard)
    };
    let target = destination(home, &transfer.destination)?;
    if target != transfer.destination {
        return Err(err("Relocation destination changed"));
    }
    if !target.exists() {
        fs::create_dir(&target).map_err(err)?;
    }
    require_checkpointed(&target)?;
    // Reject unrelated content, including files added after an interrupted copy.
    for (name, entry) in inventory(&target)? {
        let expected = transfer
            .entries
            .get(&name)
            .ok_or_else(|| err("Unexpected destination content. No files were removed."))?;
        if entry.bytes.is_none() != expected.bytes.is_none() {
            return Err(err("Destination entry type changed"));
        }
    }
    for (name, entry) in &transfer.entries {
        let to = relative(&target, name)?;
        let from = relative(&transfer.source.library_path, name)?;
        if let Some(length) = entry.bytes {
            copy_file(&from, &to, length)?;
        } else if !to.exists() {
            fs::create_dir(&to).map_err(err)?;
        }
        files::no_links(&to)?;
    }
    if inventory(&target)? != transfer.entries
        || inventory(&transfer.source.library_path)? != transfer.entries
    {
        return Err(err(
            "Library copy verification failed. Source files were preserved.",
        ));
    }
    require_checkpointed(&transfer.source.library_path)?;
    require_checkpointed(&target)?;
    let db = rusqlite::Connection::open_with_flags(
        target.join("library.db"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(err)?;
    let integrity: String = db
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(err)?;
    if integrity != "ok" {
        return Err(err("Copied library database integrity check failed"));
    }
    drop(db);
    let config = config_for(
        target,
        transfer.source.library_id,
        transfer.source.generation + 1,
    )?;
    verify_root(&config)?;
    save_config(home, &config)?;
    // After this commit, failures must be recovered against the new root.
    fs::remove_file(&journal).map_err(err)?;
    Ok(())
}
pub(super) fn cancel_in(home: &Path) -> Result<()> {
    let _guard = lock(home)?;
    let journal = home.join(TRANSACTION);
    if !journal.exists() {
        return Ok(());
    }
    let transfer: Transfer = read_json(&journal)?;
    let config = read_config(home)?.ok_or_else(|| err("Missing storage configuration"))?;
    if transfer.version != 1
        || config.library_id != transfer.source.library_id
        || !((config.generation == transfer.source.generation
            && config.library_path == transfer.source.library_path)
            || (config.generation == transfer.source.generation + 1
                && config.library_path == transfer.destination))
    {
        return Err(err(
            "Relocation configuration conflict. Preserve the journal.",
        ));
    }
    verify_root(&config)?;
    // Retain partial output as well: no recursive deletion of user-selected paths.
    fs::remove_file(journal).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pending() -> (tempfile::TempDir, PathBuf, Transfer) {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("profile");
        fs::create_dir(&home).unwrap();
        configure_in(&home, &home.join("library"), false).unwrap();
        let source = read_config(&home).unwrap().unwrap();
        fs::write(
            source.library_path.join("instances/original.jpg"),
            b"complete-original-data",
        )
        .unwrap();
        let _lock = Store::open_root(&source.library_path)
            .unwrap()
            .checkpoint_for_copy()
            .unwrap();
        let transfer = Transfer {
            version: 1,
            entries: inventory(&source.library_path).unwrap(),
            source,
            destination: destination(&home, &temp.path().join("new-library")).unwrap(),
        };
        write_json(&home.join(TRANSACTION), &transfer).unwrap();
        (temp, home, transfer)
    }
    #[test]
    fn resumes_partial_copy_and_preserves_changed_destination_on_error() {
        let (_temp, home, transfer) = pending();
        fs::create_dir_all(transfer.destination.join("instances")).unwrap();
        let copy = transfer.destination.join("instances/original.jpg");
        fs::write(&copy, b"complete-").unwrap();
        move_in(&home, None).unwrap();
        assert_eq!(fs::read(copy).unwrap(), b"complete-original-data");
        assert_eq!(
            read_config(&home).unwrap().unwrap().library_path,
            transfer.destination.canonicalize().unwrap()
        );
        let (_temp2, home2, transfer2) = pending();
        fs::create_dir_all(transfer2.destination.join("instances")).unwrap();
        let changed = transfer2.destination.join("instances/original.jpg");
        fs::write(&changed, b"changed").unwrap();
        assert!(move_in(&home2, None).is_err());
        assert_eq!(fs::read(changed).unwrap(), b"changed");
        assert_eq!(read_config(&home2).unwrap().unwrap().generation, 1);
        cancel_in(&home2).unwrap();
        assert!(!home2.join(TRANSACTION).exists());
        assert!(transfer2.destination.exists());
    }
    #[test]
    fn interrupted_configuration_commit_keeps_new_root_authoritative() {
        let (_temp, home, transfer) = pending();
        move_in(&home, None).unwrap();
        write_json(&home.join(TRANSACTION), &transfer).unwrap();
        move_in(&home, None).unwrap();
        assert_eq!(read_config(&home).unwrap().unwrap().generation, 2);
        assert!(!home.join(TRANSACTION).exists());
    }
    #[test]
    fn changed_source_blocks_resume_and_cancel_keeps_original_config() {
        let (_temp, home, transfer) = pending();
        fs::write(
            transfer.source.library_path.join("instances/original.jpg"),
            "new-save",
        )
        .unwrap();
        assert!(move_in(&home, None).is_err());
        cancel_in(&home).unwrap();
        assert_eq!(read_config(&home).unwrap().unwrap().generation, 1);
    }
    #[test]
    fn wal_written_by_an_older_process_blocks_resume_without_losing_it() {
        let (_temp, home, transfer) = pending();
        let wal = transfer.source.library_path.join("library.db-wal");
        fs::write(&wal, b"uncheckpointed commit").unwrap();
        assert!(move_in(&home, None).is_err());
        assert_eq!(fs::read(&wal).unwrap(), b"uncheckpointed commit");
        assert_eq!(read_config(&home).unwrap().unwrap().generation, 1);
    }
}
