use std::path::Path;

use crate::{
    byte_write::{validate_extension, write_base64_atomically, ByteWriteErrors},
    error::CommandError,
};

pub fn save_docx_to(path: &Path, contents_base64: &str) -> Result<(), CommandError> {
    validate_extension(path, "docx", "docx_path_invalid", "DOCX")?;
    write_base64_atomically(
        path,
        contents_base64,
        ByteWriteErrors {
            decode_code: "docx_decode_failed",
            decode_label: "DOCX",
            write_code: "docx_write_failed",
            write_label: "DOCX",
        },
    )
}

#[tauri::command]
pub fn save_docx(path: String, contents_base64: String) -> Result<(), CommandError> {
    save_docx_to(Path::new(&path), &contents_base64)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use base64::{engine::general_purpose::STANDARD, Engine as _};

    use super::*;

    #[test]
    fn writes_decoded_docx_bytes_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("plan.docx");
        let encoded = STANDARD.encode(b"PK\x03\x04 DOCX test");

        save_docx_to(&path, &encoded).unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"PK\x03\x04 DOCX test");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn atomically_replaces_an_existing_docx() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("plan.docx");
        fs::write(&path, b"old").unwrap();

        save_docx_to(&path, &STANDARD.encode(b"PK new")).unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"PK new");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn accepts_case_insensitive_docx_extension() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("plan.DOCX");

        save_docx_to(&path, &STANDARD.encode(b"PK")).unwrap();

        assert_eq!(fs::read(path).unwrap(), b"PK");
    }

    #[test]
    fn rejects_non_docx_paths_without_writing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("plan.pdf");

        let error = save_docx_to(&path, &STANDARD.encode(b"PK")).unwrap_err();

        assert_eq!(error.code, "docx_path_invalid");
        assert!(!path.exists());
    }

    #[test]
    fn rejects_missing_parent_directory_without_writing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing").join("plan.docx");

        let error = save_docx_to(&path, &STANDARD.encode(b"PK")).unwrap_err();

        assert_eq!(error.code, "docx_path_invalid");
        assert!(!path.exists());
    }

    #[test]
    fn rejects_invalid_base64_without_leaving_a_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("plan.docx");

        let error = save_docx_to(&path, "not base64!!!").unwrap_err();

        assert_eq!(error.code, "docx_decode_failed");
        assert!(!path.exists());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }
}
