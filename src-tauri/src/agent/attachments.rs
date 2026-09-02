use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::error::CommandError;

const MAX_ATTACHMENT_BYTES: u64 = 16 * 1024 * 1024;
const MAX_ATTACHMENT_TOKEN_BYTES: usize = 512;

pub trait AttachmentTokenResolver: Send + Sync + 'static {
    fn resolve(&self, project_id: &str, attachment_token: &str) -> Result<PathBuf, CommandError>;
}

#[derive(Debug, Default)]
pub struct UnconfiguredAttachmentResolver;

impl AttachmentTokenResolver for UnconfiguredAttachmentResolver {
    fn resolve(&self, _project_id: &str, _attachment_token: &str) -> Result<PathBuf, CommandError> {
        Err(CommandError::new(
            "attachment_bridge_unavailable",
            "The workspace attachment bridge is not available",
        ))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedAttachment {
    pub canonical_path: PathBuf,
    pub mime_type: &'static str,
    pub size_bytes: u64,
}

pub fn validate_attachment_token(token: &str) -> Result<(), CommandError> {
    if token.is_empty()
        || token.trim() != token
        || token.len() > MAX_ATTACHMENT_TOKEN_BYTES
        || token.chars().any(char::is_control)
    {
        return Err(CommandError::new(
            "attachment_token_invalid",
            "The attachment token is invalid",
        ));
    }
    Ok(())
}

pub fn validate_project_attachment(
    project_root: &Path,
    resolved_path: &Path,
) -> Result<ValidatedAttachment, CommandError> {
    let project_root = project_root.canonicalize().map_err(|error| {
        CommandError::new(
            "project_unavailable",
            format!("Unable to access the current project: {error}"),
        )
    })?;
    let canonical_path = resolved_path.canonicalize().map_err(|error| {
        CommandError::new(
            "attachment_unavailable",
            format!("Unable to access the selected attachment: {error}"),
        )
    })?;
    if !canonical_path.starts_with(&project_root) || canonical_path == project_root {
        return Err(CommandError::new(
            "attachment_outside_project",
            "The selected attachment is outside the current project",
        ));
    }
    let metadata = canonical_path.metadata().map_err(|error| {
        CommandError::new(
            "attachment_unavailable",
            format!("Unable to inspect the selected attachment: {error}"),
        )
    })?;
    if !metadata.is_file() {
        return Err(CommandError::new(
            "attachment_invalid_type",
            "The selected attachment is not a file",
        ));
    }
    if metadata.len() == 0 || metadata.len() > MAX_ATTACHMENT_BYTES {
        return Err(CommandError::new(
            "attachment_too_large",
            "The selected image must be between 1 byte and 16 MiB",
        ));
    }

    let extension = canonical_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mut signature = [0_u8; 12];
    let mut file = File::open(&canonical_path).map_err(|error| {
        CommandError::new(
            "attachment_unavailable",
            format!("Unable to open the selected attachment: {error}"),
        )
    })?;
    let read = file.read(&mut signature).map_err(|error| {
        CommandError::new(
            "attachment_unavailable",
            format!("Unable to validate the selected attachment: {error}"),
        )
    })?;
    let signature = &signature[..read];
    let mime_type = match extension.as_str() {
        "png" if signature.starts_with(b"\x89PNG\r\n\x1a\n") => "image/png",
        "jpg" | "jpeg"
            if signature.len() >= 3
                && signature[0] == 0xff
                && signature[1] == 0xd8
                && signature[2] == 0xff =>
        {
            "image/jpeg"
        }
        _ => {
            return Err(CommandError::new(
                "attachment_invalid_type",
                "Only validated project-local PNG and JPEG images are supported",
            ));
        }
    };

    Ok(ValidatedAttachment {
        canonical_path,
        mime_type,
        size_bytes: metadata.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_contained_png_and_rejects_escape_and_mime_spoofing() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("project");
        let outside = temp.path().join("outside.png");
        std::fs::create_dir(&project).unwrap();
        let png = project.join("image.png");
        std::fs::write(&png, b"\x89PNG\r\n\x1a\nrest").unwrap();
        std::fs::write(&outside, b"\x89PNG\r\n\x1a\nrest").unwrap();
        let fake = project.join("fake.png");
        std::fs::write(&fake, b"not a png").unwrap();
        let jpeg = project.join("image.jpg");
        std::fs::write(&jpeg, b"\xff\xd8\xffrest").unwrap();

        assert_eq!(
            validate_project_attachment(&project, &png)
                .unwrap()
                .mime_type,
            "image/png"
        );
        assert!(validate_project_attachment(&project, &outside).is_err());
        assert!(validate_project_attachment(&project, &fake).is_err());
        assert_eq!(
            validate_project_attachment(&project, &jpeg)
                .unwrap()
                .mime_type,
            "image/jpeg"
        );
        std::fs::remove_file(&png).unwrap();
        assert!(validate_project_attachment(&project, &png).is_err());
    }

    #[test]
    fn rejects_empty_and_oversized_images() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let empty = project.join("empty.png");
        std::fs::write(&empty, []).unwrap();
        let oversized = project.join("oversized.png");
        let file = File::create(&oversized).unwrap();
        file.set_len(MAX_ATTACHMENT_BYTES + 1).unwrap();

        assert!(validate_project_attachment(&project, &empty).is_err());
        assert!(validate_project_attachment(&project, &oversized).is_err());
    }
}
