use crate::error::CommandError;

pub fn reveal_args(path: &str) -> Vec<String> {
    vec![format!("/select,{}", path)]
}

pub fn open_directory_args(path: &str) -> Vec<String> {
    vec![path.to_string()]
}

#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), CommandError> {
    std::process::Command::new("explorer")
        .args(reveal_args(&path))
        .spawn()
        .map_err(|error| {
            CommandError::new(
                "reveal_failed",
                format!("Unable to reveal the file: {error}"),
            )
        })?;
    Ok(())
}

#[tauri::command]
pub fn open_project_directory(path: String) -> Result<(), CommandError> {
    std::process::Command::new("explorer")
        .args(open_directory_args(&path))
        .spawn()
        .map_err(|error| {
            CommandError::new(
                "open_directory_failed",
                format!("Unable to open the project directory: {error}"),
            )
        })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_explorer_select_args() {
        let args = reveal_args(r"C:\Users\test\output.pdf");
        assert_eq!(args, vec![r"/select,C:\Users\test\output.pdf"]);
    }

    #[test]
    fn project_directory_is_passed_without_select_flag() {
        let path = r"C:\Users\test\shoot";
        assert_eq!(open_directory_args(path), vec![path.to_string()]);
    }
}
