use std::{fs, path::PathBuf};

use crate::error::CommandError;

/// Returns the path to the user's home directory + `.preshot` subdirectory.
fn preshot_home() -> Result<PathBuf, CommandError> {
    #[cfg(windows)]
    let home_var = "USERPROFILE";
    #[cfg(not(windows))]
    let home_var = "HOME";

    let home = std::env::var(home_var).map_err(|_| {
        CommandError::new(
            "settings_home_unresolved",
            format!("Unable to resolve home directory (missing {home_var})"),
        )
    })?;

    Ok(PathBuf::from(home).join(".preshot"))
}

/// Returns the path to the settings.json file.
fn settings_path() -> Result<PathBuf, CommandError> {
    Ok(preshot_home()?.join("settings.json"))
}

/// Reads settings from the given path, returning an empty object if the file is absent
/// or corrupt.
fn read_settings_from(path: &PathBuf) -> Result<serde_json::Value, CommandError> {
    // Ensure the .preshot directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            CommandError::new(
                "settings_dir_failed",
                format!("Unable to create settings directory: {error}"),
            )
        })?;
    }

    // If the file doesn't exist, return empty object
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }

    // Try to read and parse the file
    let contents = fs::read_to_string(path).map_err(|error| {
        CommandError::new(
            "settings_read_failed",
            format!("Unable to read settings file: {error}"),
        )
    })?;

    // Parse as JSON, returning empty object if corrupt
    match serde_json::from_str(&contents) {
        Ok(value) => Ok(value),
        Err(_) => {
            // Corrupt file - return empty object rather than failing
            Ok(serde_json::json!({}))
        }
    }
}

/// Writes settings atomically to the given path using temp file + rename.
fn write_settings_to(path: &PathBuf, value: serde_json::Value) -> Result<(), CommandError> {
    // Ensure the .preshot directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            CommandError::new(
                "settings_dir_failed",
                format!("Unable to create settings directory: {error}"),
            )
        })?;
    }

    // Serialize to JSON with pretty formatting
    let contents = serde_json::to_string_pretty(&value).map_err(|error| {
        CommandError::new(
            "settings_serialize_failed",
            format!("Unable to serialize settings: {error}"),
        )
    })?;

    // Write to temp file
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, contents).map_err(|error| {
        CommandError::new(
            "settings_write_failed",
            format!("Unable to write settings: {error}"),
        )
    })?;

    // Atomic rename
    fs::rename(&temp, path).map_err(|error| {
        CommandError::new(
            "settings_write_failed",
            format!("Unable to finalize settings: {error}"),
        )
    })?;

    Ok(())
}

/// Reads the application settings from ~/.preshot/settings.json.
/// Returns an empty object if the file is absent or corrupt.
#[tauri::command]
pub fn read_settings() -> Result<serde_json::Value, CommandError> {
    let path = settings_path()?;
    read_settings_from(&path)
}

/// Writes the application settings to ~/.preshot/settings.json atomically.
#[tauri::command]
pub fn write_settings(value: serde_json::Value) -> Result<(), CommandError> {
    let path = settings_path()?;
    write_settings_to(&path, value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_path_ends_with_preshot_settings_json() {
        let path = settings_path().unwrap();
        assert!(
            path.ends_with(".preshot\\settings.json") || path.ends_with(".preshot/settings.json")
        );
    }

    #[test]
    fn read_absent_file_returns_empty_object() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".preshot").join("settings.json");

        let result = read_settings_from(&path).unwrap();
        assert_eq!(result, serde_json::json!({}));
    }

    #[test]
    fn read_corrupt_file_returns_empty_object() {
        let dir = tempfile::tempdir().unwrap();
        let settings_dir = dir.path().join(".preshot");
        let path = settings_dir.join("settings.json");

        fs::create_dir_all(&settings_dir).unwrap();
        fs::write(&path, "not valid json {{{").unwrap();

        let result = read_settings_from(&path).unwrap();
        assert_eq!(result, serde_json::json!({}));
    }

    #[test]
    fn write_then_read_round_trips_value() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".preshot").join("settings.json");

        let value = serde_json::json!({
            "theme": "dark",
            "fontSize": 14
        });

        write_settings_to(&path, value.clone()).unwrap();
        let result = read_settings_from(&path).unwrap();

        assert_eq!(result, value);
    }

    #[test]
    fn write_creates_directory_if_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".preshot").join("settings.json");

        let value = serde_json::json!({"test": true});
        write_settings_to(&path, value).unwrap();

        assert!(path.exists());
    }

    #[test]
    fn atomic_write_leaves_file_present() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".preshot").join("settings.json");

        // Write initial value
        write_settings_to(&path, serde_json::json!({"version": 1})).unwrap();

        // Overwrite with new value
        write_settings_to(&path, serde_json::json!({"version": 2})).unwrap();

        // File should exist and contain the new value
        assert!(path.exists());
        let result = read_settings_from(&path).unwrap();
        assert_eq!(result, serde_json::json!({"version": 2}));

        // No temp file should remain
        let temp = path.with_extension("json.tmp");
        assert!(!temp.exists());
    }
}
