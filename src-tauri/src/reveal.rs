use crate::error::CommandError;
use std::{
    fs, io,
    path::Path,
    process::{Command, Stdio},
};

pub fn open_directory_args(path: &str) -> Vec<String> {
    vec![path.to_string()]
}

pub fn normalize_windows_shell_path(path: &str) -> String {
    const VERBATIM_PREFIX: &str = r"\\?\";
    const VERBATIM_UNC_PREFIX: &str = r"\\?\UNC\";

    if path
        .get(..VERBATIM_UNC_PREFIX.len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(VERBATIM_UNC_PREFIX))
    {
        return format!(r"\\{}", &path[VERBATIM_UNC_PREFIX.len()..]);
    }

    if let Some(drive_path) = path.strip_prefix(VERBATIM_PREFIX) {
        let bytes = drive_path.as_bytes();
        if bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && matches!(bytes[2], b'\\' | b'/')
        {
            return drive_path.to_string();
        }
    }

    path.to_string()
}

fn spawn_explorer(path: &str) -> io::Result<()> {
    Command::new("explorer")
        .args(open_directory_args(path))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
}

fn open_project_directory_with<Inspect, Spawn>(
    path: &str,
    inspect: Inspect,
    spawn: Spawn,
) -> Result<(), CommandError>
where
    Inspect: FnOnce(&Path) -> io::Result<bool>,
    Spawn: FnOnce(&str) -> io::Result<()>,
{
    if path.is_empty() {
        return Err(CommandError::new(
            "project_directory_invalid",
            "Unable to open the project directory because its path is empty.",
        ));
    }

    let normalized = normalize_windows_shell_path(path);
    match inspect(Path::new(&normalized)) {
        Ok(true) => {}
        Ok(false) => {
            return Err(CommandError::new(
                "project_directory_not_directory",
                "Unable to open the project directory because the project path is not a directory.",
            ));
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Err(CommandError::new(
                "project_directory_missing",
                "Unable to open the project directory because it no longer exists.",
            ));
        }
        Err(error) if error.kind() == io::ErrorKind::InvalidInput => {
            return Err(CommandError::new(
                "project_directory_invalid",
                format!(
                    "Unable to open the project directory because its path is invalid: {error}"
                ),
            ));
        }
        Err(error) => {
            return Err(CommandError::new(
                "project_directory_inspection_failed",
                format!("Unable to inspect the project directory: {error}"),
            ));
        }
    }

    spawn(&normalized).map_err(|error| {
        CommandError::new(
            "open_directory_failed",
            format!("Unable to open the project directory in Explorer: {error}"),
        )
    })
}

#[tauri::command]
pub fn open_project_directory(path: String) -> Result<(), CommandError> {
    open_project_directory_with(
        &path,
        |directory| fs::metadata(directory).map(|metadata| metadata.is_dir()),
        spawn_explorer,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn normalizes_windows_shell_paths_without_changing_path_content() {
        for (path, expected) in [
            (r"C:\Editorial", r"C:\Editorial"),
            (
                r"C:\Client Shoots\夏季 编辑\",
                r"C:\Client Shoots\夏季 编辑\",
            ),
            (r"\\?\C:\Editorial", r"C:\Editorial"),
            (
                r"\\?\C:\Client Shoots\夏季 编辑\",
                r"C:\Client Shoots\夏季 编辑\",
            ),
            (r"\\server\share\Editorial", r"\\server\share\Editorial"),
            (r"\\server\share\夏季 编辑\", r"\\server\share\夏季 编辑\"),
            (
                r"\\?\UNC\server\share\Editorial",
                r"\\server\share\Editorial",
            ),
            (
                r"\\?\unc\server\share\Editorial",
                r"\\server\share\Editorial",
            ),
            (
                r"\\?\UNC\server\share\夏季 编辑\",
                r"\\server\share\夏季 编辑\",
            ),
        ] {
            assert_eq!(normalize_windows_shell_path(path), expected);
        }
    }

    #[test]
    fn normalized_project_directory_is_passed_without_select_flag() {
        let mut spawned_path = None;

        open_project_directory_with(
            r"\\?\C:\Client Shoots\夏季 编辑\",
            |_| Ok(true),
            |path| {
                spawned_path = Some(path.to_string());
                Ok(())
            },
        )
        .unwrap();

        assert_eq!(
            spawned_path,
            Some(r"C:\Client Shoots\夏季 编辑\".to_string())
        );
    }

    #[test]
    fn rejects_an_empty_project_directory_path() {
        let error = open_project_directory_with("", |_| Ok(true), |_| Ok(())).unwrap_err();

        assert_eq!(error.code, "project_directory_invalid");
        assert!(error.message.contains("empty"));
    }

    #[test]
    fn reports_an_invalid_project_directory_path() {
        let spawned = Cell::new(false);
        let error = open_project_directory_with(
            "invalid\0path",
            |_| {
                Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "path contains a null character",
                ))
            },
            |_| {
                spawned.set(true);
                Ok(())
            },
        )
        .unwrap_err();

        assert_eq!(error.code, "project_directory_invalid");
        assert!(error.message.contains("null character"));
        assert!(!spawned.get());
    }

    #[test]
    fn reports_a_missing_project_directory() {
        let spawned = Cell::new(false);
        let error = open_project_directory_with(
            r"C:\missing",
            |_| Err(io::Error::from(io::ErrorKind::NotFound)),
            |_| {
                spawned.set(true);
                Ok(())
            },
        )
        .unwrap_err();

        assert_eq!(error.code, "project_directory_missing");
        assert!(error.message.contains("no longer exists"));
        assert!(!spawned.get());
    }

    #[test]
    fn rejects_a_project_path_that_is_not_a_directory() {
        let spawned = Cell::new(false);
        let error = open_project_directory_with(
            r"C:\output.pdf",
            |_| Ok(false),
            |_| {
                spawned.set(true);
                Ok(())
            },
        )
        .unwrap_err();

        assert_eq!(error.code, "project_directory_not_directory");
        assert!(error.message.contains("not a directory"));
        assert!(!spawned.get());
    }

    #[test]
    fn reports_explorer_spawn_failure_after_validation() {
        let error = open_project_directory_with(
            r"\\?\UNC\server\share\Editorial",
            |_| Ok(true),
            |path| {
                assert_eq!(path, r"\\server\share\Editorial");
                Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "Explorer is unavailable",
                ))
            },
        )
        .unwrap_err();

        assert_eq!(error.code, "open_directory_failed");
        assert!(error.message.contains("Explorer is unavailable"));
    }
}
