use std::{fs, path::Path};

use base64::{engine::general_purpose::STANDARD, Engine as _};

use crate::error::CommandError;

pub fn save_pdf_to(path: &Path, contents_base64: &str) -> Result<(), CommandError> {
    let bytes = STANDARD.decode(contents_base64).map_err(|error| {
        CommandError::new(
            "pdf_decode_failed",
            format!("Unable to decode PDF bytes: {error}"),
        )
    })?;
    let temp = path.with_extension("pdf.tmp");
    fs::write(&temp, &bytes).map_err(|error| {
        CommandError::new(
            "pdf_write_failed",
            format!("Unable to write the PDF: {error}"),
        )
    })?;
    fs::rename(&temp, path).map_err(|error| {
        CommandError::new(
            "pdf_write_failed",
            format!("Unable to finalize the PDF: {error}"),
        )
    })?;
    Ok(())
}

#[tauri::command]
pub fn save_pdf(path: String, contents_base64: String) -> Result<(), CommandError> {
    save_pdf_to(Path::new(&path), &contents_base64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_decoded_bytes_to_the_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("plan.pdf");
        let encoded = STANDARD.encode(b"%PDF-1.7 test");

        save_pdf_to(&path, &encoded).unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"%PDF-1.7 test");
    }

    #[test]
    fn rejects_invalid_base64() {
        let dir = tempfile::tempdir().unwrap();
        let error = save_pdf_to(&dir.path().join("x.pdf"), "not base64!!!").unwrap_err();
        assert_eq!(error.code, "pdf_decode_failed");
    }
}
