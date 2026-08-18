use std::path::Path;

use crate::{
    byte_write::{write_base64_atomically, ByteWriteErrors},
    error::CommandError,
};

pub fn save_pdf_to(path: &Path, contents_base64: &str) -> Result<(), CommandError> {
    write_base64_atomically(
        path,
        contents_base64,
        ByteWriteErrors {
            decode_code: "pdf_decode_failed",
            decode_label: "PDF",
            write_code: "pdf_write_failed",
            write_label: "PDF",
        },
    )
}

#[tauri::command]
pub fn save_pdf(path: String, contents_base64: String) -> Result<(), CommandError> {
    save_pdf_to(Path::new(&path), &contents_base64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use std::fs;

    #[test]
    fn writes_decoded_bytes_to_the_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("plan.pdf");
        let encoded = STANDARD.encode(b"%PDF-1.7 test");

        save_pdf_to(&path, &encoded).unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"%PDF-1.7 test");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn atomically_replaces_an_existing_pdf() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("plan.pdf");
        fs::write(&path, b"old").unwrap();

        save_pdf_to(&path, &STANDARD.encode(b"%PDF new")).unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"%PDF new");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn rejects_invalid_base64() {
        let dir = tempfile::tempdir().unwrap();
        let error = save_pdf_to(&dir.path().join("x.pdf"), "not base64!!!").unwrap_err();
        assert_eq!(error.code, "pdf_decode_failed");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }
}
