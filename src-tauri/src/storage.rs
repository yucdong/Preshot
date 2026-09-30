//! User-owned storage. No installer action creates, relocates, or removes this data.
pub(crate) mod profile;
#[cfg(test)]
pub(crate) mod tests;
mod transfer;
mod workspace_registry;

use crate::{
    byte_write::{write_bytes_atomically, ByteWriteErrors},
    error::CommandError,
    library::{files, Store},
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::Manager;

type Result<T> = std::result::Result<T, CommandError>;
fn err(message: impl std::fmt::Display) -> CommandError {
    CommandError::new("storage", message.to_string())
}
const CONFIG: &str = "storage.json";
const IDENTITY: &str = ".preshot-library-id";
const TRANSACTION: &str = "storage-move.json";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Config {
    schema_version: u32,
    library_id: String,
    library_path: PathBuf,
    generation: u64,
    last_known_application_directory: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    configuration_directory: String,
    existing_working_directory: Option<String>,
    application_directory: String,
    library_directory: String,
    needs_setup: bool,
    pending_move: bool,
    problem: Option<String>,
    generation: u64,
}

fn display(path: &Path) -> String {
    crate::reveal::normalize_windows_shell_path(&path.to_string_lossy())
}
fn application_directory() -> Result<PathBuf> {
    std::env::current_exe()
        .map_err(err)?
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| err("Cannot resolve the application directory"))
}
fn ensure_home(home: &Path) -> Result<()> {
    if !home.exists() {
        files::directory(home.parent().ok_or_else(|| err("Missing profile parent"))?)?;
        match fs::create_dir(home) {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
            Err(e) => return Err(err(e)),
        }
    }
    files::directory(home)?;
    Ok(())
}
fn lock(home: &Path) -> Result<files::Lock> {
    ensure_home(home)?;
    files::Lock::acquire(&home.join(".storage.lock"))
}
fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    files::check_leaf(path)?;
    write_bytes_atomically(
        path,
        &serde_json::to_vec_pretty(value).map_err(err)?,
        ByteWriteErrors {
            decode_code: "storage",
            decode_label: "storage metadata",
            write_code: "storage",
            write_label: "storage metadata",
        },
    )
}
fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    serde_json::from_slice(&files::read_limited(path, 16 * 1024 * 1024)?).map_err(|_| {
        err("Storage metadata is invalid. Preserve it and restore a known-good backup.")
    })
}
fn read_config(home: &Path) -> Result<Option<Config>> {
    let path = home.join(CONFIG);
    files::check_leaf(&path)?;
    if !path.try_exists().map_err(err)? {
        return Ok(None);
    }
    let config: Config = read_json(&path)?;
    if config.schema_version != 1
        || config.generation == 0
        || config.generation == u64::MAX
        || !config.library_path.is_absolute()
    {
        return Err(err(
            "Unsupported or invalid storage configuration. Restore storage.json from backup.",
        ));
    }
    files::uuid(&config.library_id)?;
    Ok(Some(config))
}
fn save_config(home: &Path, config: &Config) -> Result<()> {
    if let Some(previous) = read_config(home)? {
        write_json(&home.join("storage.previous.json"), &previous)?;
    }
    write_json(&home.join(CONFIG), config)
}
fn verify_root(config: &Config) -> Result<PathBuf> {
    let root = files::directory(&config.library_path)
        .map_err(|_| err("The material-library directory is unavailable. Reconnect the drive or locate the existing library."))?;
    let id: String = read_json(&root.join(IDENTITY))?;
    if id != config.library_id {
        return Err(err(
            "This directory contains a different library. Locate the original library.",
        ));
    }
    if !root.join("library.db").is_file() {
        return Err(err(
            "The library database is missing. Restore it before continuing.",
        ));
    }
    files::check_leaf(&root.join("library.db"))?;
    Ok(root)
}

fn adopt_root(root: &Path) -> Result<String> {
    if !root.join("library.db").is_file() {
        return Err(err(
            "Select an existing material-library directory containing library.db.",
        ));
    }
    // Selecting an unrelated SQLite file must never initialize our schema in it.
    files::check_leaf(&root.join("library.db"))?;
    let db = rusqlite::Connection::open_with_flags(
        root.join("library.db"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|_| err("This directory does not contain a readable Preshot library."))?;
    let tables: i64 = db.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('library_meta','materials','blobs','material_images','save_receipts')",
        [], |row| row.get(0)).map_err(err)?;
    if tables != 5 {
        return Err(err(
            "This database is not a compatible Preshot library. No schema was changed.",
        ));
    }
    drop(db);
    // The existing store validates version and recovers its own durable receipts.
    let _store = Store::open_root(root)?;
    let marker = root.join(IDENTITY);
    if marker.try_exists().map_err(err)? {
        let id: String = read_json(&marker)?;
        files::uuid(&id)?;
        return Ok(id);
    }
    let id = uuid::Uuid::new_v4().to_string();
    write_json(&marker, &id)?;
    Ok(id)
}
fn config_for(root: PathBuf, id: String, generation: u64) -> Result<Config> {
    Ok(Config {
        schema_version: 1,
        library_id: id,
        library_path: root,
        generation,
        last_known_application_directory: application_directory()?,
    })
}
fn auto_adopt(home: &Path) -> Result<Option<Config>> {
    if let Some(config) = read_config(home)? {
        return Ok(Some(config));
    }
    let root = home.join("library");
    if !root.join("library.db").try_exists().map_err(err)? {
        return Ok(None);
    }
    let root = files::directory(&root)?;
    let config = config_for(root.clone(), adopt_root(&root)?, 1)?;
    save_config(home, &config)?;
    Ok(Some(config))
}
fn status_in(home: &Path) -> Result<StorageInfo> {
    let _guard = lock(home)?;
    let config = auto_adopt(home)?;
    let pending_move = home.join(TRANSACTION).try_exists().map_err(err)?;
    let mut problem = None;
    if let Some(config) = &config {
        problem = verify_root(config).err().map(|e| e.message);
        if problem.is_none() && !pending_move {
            if let Err(e) = Store::open_root(&config.library_path) {
                problem = Some(e.message);
            }
        }
    }
    let app = application_directory()?;
    if let Some(mut value) = config.clone() {
        if value.last_known_application_directory != app {
            value.last_known_application_directory = app.clone();
            save_config(home, &value)?;
        }
    }
    Ok(StorageInfo {
        configuration_directory: display(home),
        existing_working_directory: config.as_ref().map(|_| display(home)),
        application_directory: display(&app),
        library_directory: display(
            &config
                .as_ref()
                .map(|c| c.library_path.clone())
                .unwrap_or(home.join("library")),
        ),
        needs_setup: config.is_none(),
        pending_move,
        problem,
        generation: config.map(|c| c.generation).unwrap_or(0),
    })
}
pub(crate) fn open_library() -> Result<Store> {
    let home = crate::workspace::preshot_home()?;
    let guard = lock(&home)?;
    if home.join(TRANSACTION).exists() {
        return Err(err(
            "A library move is pending. Finish or cancel it in storage settings.",
        ));
    }
    let config = auto_adopt(&home)?.ok_or_else(|| err("Complete material-library setup first."))?;
    let mut store = Store::open_root(&verify_root(&config)?)?;
    store.profile_lock = Some(guard);
    Ok(store)
}

fn destination(home: &Path, path: &Path) -> Result<PathBuf> {
    if !path.is_absolute() {
        return Err(err("Choose an absolute local directory."));
    }
    // Only an immediate missing leaf is created; no recursive path construction.
    let root = if path.exists() {
        files::directory(path)?
    } else {
        files::directory(
            path.parent()
                .ok_or_else(|| err("Choose a child directory."))?,
        )?
        .join(
            path.file_name()
                .ok_or_else(|| err("Choose a child directory."))?,
        )
    };
    let home = files::directory(home)?;
    let app = files::directory(&application_directory()?)?;
    if root.parent().is_none()
        || home.starts_with(&root)
        || app.starts_with(&root)
        || root.starts_with(&app)
        || root.starts_with(home.join("projects"))
    {
        return Err(err(
            "Choose a dedicated library directory outside application files and projects.",
        ));
    }
    #[cfg(windows)]
    {
        let visible = display(&root);
        if visible.starts_with(r"\\") {
            return Err(err(
                "Network libraries are unsupported. Choose a local drive.",
            ));
        }
        let drive: Vec<u16> = visible
            .chars()
            .take(3)
            .collect::<String>()
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let drive_type =
            unsafe { windows_sys::Win32::Storage::FileSystem::GetDriveTypeW(drive.as_ptr()) };
        if !matches!(drive_type, 2 | 3) {
            return Err(err(
                "Choose a writable local disk. Mapped network drives are unsupported.",
            ));
        }
        for variable in [
            "ProgramFiles",
            "ProgramFiles(x86)",
            "WINDIR",
            "OneDrive",
            "OneDriveCommercial",
            "OneDriveConsumer",
        ] {
            if let Some(value) = std::env::var_os(variable) {
                if let Ok(protected) = PathBuf::from(value).canonicalize() {
                    if root.starts_with(protected) {
                        return Err(err("Choose a writable local directory outside system and cloud-sync folders."));
                    }
                }
            }
        }
    }
    for parent in root.ancestors() {
        if parent.join(".preshotproj").exists() {
            return Err(err("A library cannot be stored inside a project."));
        }
    }
    Ok(root)
}

fn configure_in(home: &Path, path: &Path, adopt: bool) -> Result<()> {
    let _guard = lock(home)?;
    if home.join(TRANSACTION).exists() {
        return Err(err("Finish or cancel the pending library move first."));
    }
    let previous = read_config(home)?;
    let root = destination(home, path)?;
    if let Some(previous) = &previous {
        if root == previous.library_path {
            verify_root(previous)?;
            return Ok(());
        }
        // A normal switch must preserve current work. A missing root may be relocated
        // only to a library with the identical identity, handled below.
        if previous.library_path.exists() {
            let _old_lock = files::Lock::acquire(&previous.library_path.join(".library.lock"))?;
            let drafts = previous.library_path.join("drafts");
            if drafts.exists() && fs::read_dir(drafts).map_err(err)?.next().is_some() {
                return Err(err("Close material editors and resolve retained drafts before selecting another library."));
            }
        }
    }
    let id = if adopt {
        adopt_root(&root)?
    } else {
        if previous.is_some() {
            return Err(err(
                "Use Move library to preserve existing materials, or locate an existing library.",
            ));
        }
        if root.exists() && fs::read_dir(&root).map_err(err)?.next().is_some() {
            return Err(err(
                "Choose an empty directory, or use Locate existing library.",
            ));
        }
        if !root.exists() {
            fs::create_dir(&root).map_err(err)?;
        }
        drop(Store::open_root(&root)?);
        adopt_root(&root)?
    };
    if let Some(previous) = &previous {
        if !previous.library_path.exists() && previous.library_id != id {
            return Err(err("The selected library is different from the unavailable library. Reconnect the original drive first."));
        }
    }
    let config = config_for(
        files::directory(&root)?,
        id,
        previous.map(|c| c.generation + 1).unwrap_or(1),
    )?;
    save_config(home, &config)
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(err)?
}
#[tauri::command]
pub async fn storage_status() -> Result<StorageInfo> {
    blocking(|| profile::status_in(&profile::default_home()?)).await
}
#[tauri::command]
pub async fn storage_configure(path: String, confirm_switch: Option<bool>) -> Result<StorageInfo> {
    blocking(move || {
        let anchor = profile::default_home()?;
        profile::configure_with_confirmation_in(
            &anchor,
            Path::new(&path),
            confirm_switch.unwrap_or(false),
        )?;
        profile::status_in(&anchor)
    })
    .await
}
#[tauri::command]
pub async fn storage_move(path: Option<String>) -> Result<StorageInfo> {
    blocking(move || {
        let home = crate::workspace::preshot_home()?;
        transfer::move_in(&home, path.as_deref().map(Path::new))?;
        profile::status_in(&profile::default_home()?)
    })
    .await
}
#[tauri::command]
pub async fn storage_cancel_move() -> Result<StorageInfo> {
    blocking(|| {
        let home = crate::workspace::preshot_home()?;
        transfer::cancel_in(&home)?;
        profile::status_in(&profile::default_home()?)
    })
    .await
}
#[tauri::command]
pub async fn storage_reveal(kind: String) -> Result<()> {
    blocking(move || {
        let home = crate::workspace::preshot_home().or_else(|_| profile::default_home())?;
        ensure_home(&home)?;
        let _guard = lock(&home)?;
        let path = match kind.as_str() {
            "configuration" => home,
            "application" => application_directory()?,
            "library" => verify_root(
                &read_config(&home)?.ok_or_else(|| err("Complete library setup first."))?,
            )?,
            _ => return Err(err("Unknown storage location")),
        };
        crate::reveal::open_project_directory(display(&path))
    })
    .await
}
#[tauri::command]
pub async fn read_workspace_registry(app: tauri::AppHandle) -> Result<Option<serde_json::Value>> {
    let legacy = app
        .path()
        .app_data_dir()
        .map_err(err)?
        .join("workspace.json");
    blocking(move || workspace_registry::read(&crate::workspace::preshot_home()?, &legacy)).await
}
#[tauri::command]
pub async fn write_workspace_registry(value: serde_json::Value) -> Result<()> {
    blocking(move || workspace_registry::write(&crate::workspace::preshot_home()?, value)).await
}
