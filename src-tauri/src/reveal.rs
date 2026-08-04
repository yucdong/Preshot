use crate::error::CommandError;

pub fn reveal_args(path: &str) -> Vec<String> {
    vec![format!("/select,{}", path)]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_explorer_select_args() {
        let args = reveal_args(r"C:\Users\test\output.pdf");
        assert_eq!(args, vec![r"/select,C:\Users\test\output.pdf"]);
    }
}
