use std::{
    collections::HashSet,
    fs,
    path::{Component, Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};

use crate::{
    byte_write::{write_bytes_atomically, ByteWriteErrors},
    error::CommandError,
};

const MAX_LONG_IMAGE_PARTS: usize = 32;
const MAX_LONG_IMAGE_TOTAL_BYTES: usize = 64 * 1024 * 1024;
const MAX_LONG_IMAGE_BASE_NAME_CODE_POINTS: usize = 120;
const MAX_LONG_IMAGE_BASE_NAME_UTF16_CODE_UNITS: usize = 120;
const MAX_LONG_IMAGE_FILENAME_UTF16_CODE_UNITS: usize = 128;
static LONG_IMAGE_SAVE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LongImagePartInput {
    pub path: String,
    pub contents_base64: String,
}

#[derive(Clone, Debug)]
struct DecodedLongImagePart {
    path: PathBuf,
    bytes: Vec<u8>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WritePhase {
    Commit,
    Restore,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ImageFormat {
    Jpeg,
    Png,
}

pub fn save_long_images_to(
    format: &str,
    parts: Vec<LongImagePartInput>,
) -> Result<Vec<String>, CommandError> {
    save_long_images_with_writer(format, parts, |path, bytes, _phase| {
        write_bytes_atomically(path, bytes, long_image_write_errors())
    })
}

fn save_long_images_with_writer<F>(
    format: &str,
    parts: Vec<LongImagePartInput>,
    mut write: F,
) -> Result<Vec<String>, CommandError>
where
    F: FnMut(&Path, &[u8], WritePhase) -> Result<(), CommandError>,
{
    let save_lock = LONG_IMAGE_SAVE_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = save_lock.lock().map_err(|_| {
        CommandError::new(
            "long_image_save_lock_failed",
            "Unable to save long images because the save lock is unavailable.",
        )
    })?;

    let decoded = preflight(format, parts)?;
    let originals = decoded
        .iter()
        .map(|part| {
            if part.path.exists() {
                fs::read(&part.path).map(Some).map_err(|error| {
                    CommandError::new(
                        "long_image_path_invalid",
                        format!(
                            "Unable to read the existing long-image destination '{}': {error}",
                            part.path.display()
                        ),
                    )
                })
            } else {
                Ok(None)
            }
        })
        .collect::<Result<Vec<_>, CommandError>>()?;

    let mut committed = Vec::with_capacity(decoded.len());
    for (index, part) in decoded.iter().enumerate() {
        if originals[index].is_none() && part.path.exists() {
            let error = CommandError::new(
                "long_image_write_failed",
                format!(
                    "Unable to save long images because '{}' appeared after preflight.",
                    part.path.display()
                ),
            );
            return rollback(error, &decoded, &originals, &committed, &mut write);
        }
        if let Err(error) = write(&part.path, &part.bytes, WritePhase::Commit) {
            return rollback(error, &decoded, &originals, &committed, &mut write);
        }
        committed.push(index);
    }

    Ok(decoded
        .iter()
        .map(|part| part.path.to_string_lossy().into_owned())
        .collect())
}

fn rollback<F>(
    original_error: CommandError,
    parts: &[DecodedLongImagePart],
    originals: &[Option<Vec<u8>>],
    committed: &[usize],
    write: &mut F,
) -> Result<Vec<String>, CommandError>
where
    F: FnMut(&Path, &[u8], WritePhase) -> Result<(), CommandError>,
{
    let mut failures = Vec::new();
    for &index in committed.iter().rev() {
        let part = &parts[index];
        match &originals[index] {
            Some(original) => {
                if let Err(error) = write(&part.path, original, WritePhase::Restore) {
                    failures.push(format!("{}: {}", part.path.display(), error.message));
                }
            }
            None => match fs::read(&part.path) {
                Ok(current) if current == part.bytes => {
                    if let Err(error) = fs::remove_file(&part.path) {
                        failures.push(format!("{}: {error}", part.path.display()));
                    }
                }
                Ok(_) => failures.push(format!(
                    "{} changed before rollback and was preserved",
                    part.path.display()
                )),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => failures.push(format!("{}: {error}", part.path.display())),
            },
        }
    }

    if failures.is_empty() {
        Err(original_error)
    } else {
        Err(CommandError::new(
            "long_image_rollback_failed",
            format!(
                "{} Rollback also failed for: {}",
                original_error.message,
                failures.join("; ")
            ),
        ))
    }
}

fn preflight(
    format: &str,
    parts: Vec<LongImagePartInput>,
) -> Result<Vec<DecodedLongImagePart>, CommandError> {
    let format = parse_format(format)?;
    if parts.is_empty() || parts.len() > MAX_LONG_IMAGE_PARTS {
        return Err(CommandError::new(
            "long_image_part_count_invalid",
            format!("Long-image saves require between 1 and {MAX_LONG_IMAGE_PARTS} parts."),
        ));
    }
    let mut preflight_total_bytes = 0usize;
    for (index, part) in parts.iter().enumerate() {
        let estimated_bytes = decoded_base64_size(&part.contents_base64).ok_or_else(|| {
            CommandError::new(
                "long_image_decode_failed",
                format!(
                    "Long-image part {} has an invalid base64 length.",
                    index + 1
                ),
            )
        })?;
        preflight_total_bytes = preflight_total_bytes
            .checked_add(estimated_bytes)
            .ok_or_else(long_image_payload_too_large)?;
        if preflight_total_bytes > MAX_LONG_IMAGE_TOTAL_BYTES {
            return Err(long_image_payload_too_large());
        }
    }

    let width = std::cmp::max(2, parts.len().to_string().len());
    let mut targets = HashSet::with_capacity(parts.len());
    let mut canonical_parent: Option<PathBuf> = None;
    let mut output_extension: Option<String> = None;
    let mut output_base: Option<String> = None;
    let part_count = parts.len();
    let mut decoded = Vec::with_capacity(part_count);

    let mut decoded_total_bytes = 0usize;
    for (index, part) in parts.into_iter().enumerate() {
        let path = PathBuf::from(&part.path);
        if !path.is_absolute() {
            return Err(CommandError::new(
                "long_image_path_invalid",
                "Long-image output paths must be absolute.",
            ));
        }
        if path
            .components()
            .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
        {
            return Err(CommandError::new(
                "long_image_path_invalid",
                "Long-image output paths must not contain traversal segments.",
            ));
        }
        let parent = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty());
        let parent = parent.ok_or_else(|| {
            CommandError::new(
                "long_image_path_invalid",
                "A long-image output path has no parent directory.",
            )
        })?;
        let parent = fs::canonicalize(parent).map_err(|error| {
            CommandError::new(
                "long_image_path_invalid",
                format!("A long-image output directory is unavailable: {error}"),
            )
        })?;
        if !parent.is_dir() {
            return Err(CommandError::new(
                "long_image_path_invalid",
                "A long-image output parent is not a directory.",
            ));
        }
        if canonical_parent
            .as_ref()
            .is_some_and(|expected| !paths_equal(expected, &parent))
        {
            return Err(CommandError::new(
                "long_image_path_invalid",
                "All long-image outputs must be sibling files.",
            ));
        }
        canonical_parent.get_or_insert(parent.clone());

        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| {
                CommandError::new(
                    "long_image_path_invalid",
                    "A long-image output path has no valid filename.",
                )
            })?;
        validate_path_safe_file_name(file_name)?;
        let extension = path
            .extension()
            .and_then(|extension| extension.to_str())
            .ok_or_else(|| {
                CommandError::new(
                    "long_image_path_invalid",
                    "A long-image output path has no valid extension.",
                )
            })?;
        validate_format_extension(format, extension)?;
        if output_extension
            .as_ref()
            .is_some_and(|expected| !expected.eq_ignore_ascii_case(extension))
        {
            return Err(CommandError::new(
                "long_image_path_invalid",
                "All long-image output paths must use the same extension.",
            ));
        }
        output_extension.get_or_insert_with(|| extension.to_string());

        let stem = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .ok_or_else(|| {
                CommandError::new(
                    "long_image_path_invalid",
                    "A long-image output path has no valid stem.",
                )
            })?;
        let stem_base = if part_count > 1 {
            let suffix = format!("-{:0width$}", index + 1, width = width);
            let stem_base = stem.strip_suffix(&suffix).ok_or_else(|| {
                CommandError::new(
                    "long_image_name_invalid",
                    format!(
                        "Long-image output '{}' must end with '{suffix}'.",
                        file_name
                    ),
                )
            })?;
            if stem_base.is_empty() {
                return Err(CommandError::new(
                    "long_image_name_invalid",
                    "A numbered long-image output has no base name.",
                ));
            }
            stem_base
        } else {
            stem
        };
        validate_safe_base_name(stem_base)?;
        if output_base
            .as_ref()
            .is_some_and(|expected| expected != stem_base)
        {
            return Err(CommandError::new(
                "long_image_name_invalid",
                "All long-image outputs must share one base name.",
            ));
        }
        output_base.get_or_insert_with(|| stem_base.to_string());

        let normalized_target = normalized_target_key(&parent.join(file_name));
        if !targets.insert(normalized_target) {
            return Err(CommandError::new(
                "long_image_path_invalid",
                "Long-image output paths must be unique.",
            ));
        }
        if let Ok(metadata) = fs::symlink_metadata(&path) {
            if !metadata.file_type().is_file() {
                return Err(CommandError::new(
                    "long_image_path_invalid",
                    format!(
                        "Long-image destination '{}' is not a regular file.",
                        path.display()
                    ),
                ));
            }
        }

        let bytes = STANDARD.decode(&part.contents_base64).map_err(|error| {
            CommandError::new(
                "long_image_decode_failed",
                format!("Unable to decode long-image part {}: {error}", index + 1),
            )
        })?;
        decoded_total_bytes = decoded_total_bytes
            .checked_add(bytes.len())
            .ok_or_else(long_image_payload_too_large)?;
        if decoded_total_bytes > MAX_LONG_IMAGE_TOTAL_BYTES {
            return Err(long_image_payload_too_large());
        }
        decoded.push(DecodedLongImagePart { path, bytes });
    }

    Ok(decoded)
}

fn decoded_base64_size(value: &str) -> Option<usize> {
    if value.len() % 4 != 0 {
        return None;
    }
    let padding = value
        .as_bytes()
        .iter()
        .rev()
        .take_while(|&&byte| byte == b'=')
        .count();
    if padding > 2 {
        return None;
    }
    value
        .len()
        .checked_div(4)?
        .checked_mul(3)?
        .checked_sub(padding)
}

fn long_image_payload_too_large() -> CommandError {
    CommandError::new(
        "long_image_payload_too_large",
        "Long-image saves cannot exceed 64 MiB of encoded data. Shorten the plan, export smaller sections separately, choose a smaller JPEG preset, or use PDF/DOCX.",
    )
}

fn parse_format(format: &str) -> Result<ImageFormat, CommandError> {
    match format.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => Ok(ImageFormat::Jpeg),
        "png" => Ok(ImageFormat::Png),
        _ => Err(CommandError::new(
            "long_image_format_invalid",
            "Long-image format must be jpg, jpeg, or png.",
        )),
    }
}

fn validate_format_extension(format: ImageFormat, extension: &str) -> Result<(), CommandError> {
    let valid = match format {
        ImageFormat::Jpeg => {
            extension.eq_ignore_ascii_case("jpg") || extension.eq_ignore_ascii_case("jpeg")
        }
        ImageFormat::Png => extension.eq_ignore_ascii_case("png"),
    };
    if valid {
        Ok(())
    } else {
        Err(CommandError::new(
            "long_image_extension_invalid",
            "A long-image path uses an extension unrelated to its format.",
        ))
    }
}

fn validate_safe_base_name(base_name: &str) -> Result<(), CommandError> {
    let invalid_character = base_name.chars().any(|character| {
        character.is_control()
            || matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            )
    });
    let reserved = {
        let lower = base_name.to_ascii_lowercase();
        let device_name = lower.split('.').next().unwrap_or_default();
        matches!(device_name, "con" | "prn" | "aux" | "nul")
            || (device_name.len() == 4
                && (device_name.starts_with("com") || device_name.starts_with("lpt"))
                && device_name
                    .chars()
                    .last()
                    .is_some_and(|digit| ('1'..='9').contains(&digit)))
    };
    if base_name.is_empty()
        || base_name.chars().count() > MAX_LONG_IMAGE_BASE_NAME_CODE_POINTS
        || base_name.encode_utf16().count() > MAX_LONG_IMAGE_BASE_NAME_UTF16_CODE_UNITS
        || base_name == "."
        || base_name == ".."
        || base_name.ends_with([' ', '.'])
        || invalid_character
        || reserved
    {
        return Err(CommandError::new(
            "long_image_name_invalid",
            "The long-image output base name is not a safe filename.",
        ));
    }
    Ok(())
}

fn validate_path_safe_file_name(file_name: &str) -> Result<(), CommandError> {
    if file_name.encode_utf16().count() > MAX_LONG_IMAGE_FILENAME_UTF16_CODE_UNITS {
        return Err(CommandError::new(
            "long_image_name_invalid",
            "A long-image filename exceeds the Windows component limit.",
        ));
    }
    Ok(())
}

fn normalized_target_key(path: &Path) -> String {
    let value = path.to_string_lossy();
    if cfg!(windows) {
        value.replace('/', "\\").to_ascii_lowercase()
    } else {
        value.into_owned()
    }
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    normalized_target_key(left) == normalized_target_key(right)
}

fn long_image_write_errors() -> ByteWriteErrors {
    ByteWriteErrors {
        decode_code: "long_image_decode_failed",
        decode_label: "long image",
        write_code: "long_image_write_failed",
        write_label: "long image",
    }
}

#[tauri::command]
pub fn save_long_images(
    format: String,
    parts: Vec<LongImagePartInput>,
) -> Result<Vec<String>, CommandError> {
    save_long_images_to(&format, parts)
}

#[cfg(test)]
mod tests {
    use std::{
        sync::{
            atomic::{AtomicBool, Ordering},
            mpsc, Arc,
        },
        thread,
        time::Duration,
    };

    use super::*;

    fn input(path: &Path, bytes: &[u8]) -> LongImagePartInput {
        LongImagePartInput {
            path: path.to_string_lossy().into_owned(),
            contents_base64: STANDARD.encode(bytes),
        }
    }

    fn two_parts(directory: &Path, marker: u8) -> Vec<LongImagePartInput> {
        vec![
            input(&directory.join("output-long-01.jpg"), &[marker, 1]),
            input(&directory.join("output-long-02.jpg"), &[marker, 2]),
        ]
    }

    #[test]
    fn saves_one_jpg_jpeg_or_png_and_returns_actual_paths() {
        for (format, extension) in [("jpg", "jpg"), ("jpeg", "jpeg"), ("png", "png")] {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join(format!("output-long.{extension}"));
            let result = save_long_images_to(format, vec![input(&path, &[1, 2, 3])]).unwrap();

            assert_eq!(result, vec![path.to_string_lossy()]);
            assert_eq!(fs::read(path).unwrap(), [1, 2, 3]);
        }
    }

    #[test]
    fn saves_multiple_numbered_siblings() {
        let directory = tempfile::tempdir().unwrap();
        let result = save_long_images_to("jpg", two_parts(directory.path(), 9)).unwrap();

        assert_eq!(result.len(), 2);
        assert_eq!(
            fs::read(directory.path().join("output-long-01.jpg")).unwrap(),
            [9, 1]
        );
        assert_eq!(
            fs::read(directory.path().join("output-long-02.jpg")).unwrap(),
            [9, 2]
        );
    }

    #[test]
    fn rejects_invalid_counts_traversal_duplicates_and_unrelated_extensions() {
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(
            save_long_images_to("png", vec![]).unwrap_err().code,
            "long_image_part_count_invalid"
        );
        let excessive = (0..=MAX_LONG_IMAGE_PARTS)
            .map(|index| {
                input(
                    &directory
                        .path()
                        .join(format!("output-long-{:02}.png", index + 1)),
                    &[1],
                )
            })
            .collect();
        assert_eq!(
            save_long_images_to("png", excessive).unwrap_err().code,
            "long_image_part_count_invalid"
        );

        let traversal = vec![input(&directory.path().join(".."), &[1])];
        assert_eq!(
            save_long_images_to("png", traversal).unwrap_err().code,
            "long_image_path_invalid"
        );

        let duplicate_path = directory.path().join("output-long-01.jpg");
        let duplicates = vec![input(&duplicate_path, &[1]), input(&duplicate_path, &[2])];
        assert!(matches!(
            save_long_images_to("jpg", duplicates)
                .unwrap_err()
                .code
                .as_str(),
            "long_image_name_invalid" | "long_image_path_invalid"
        ));

        let unrelated = directory.path().join("output-long.pdf");
        assert_eq!(
            save_long_images_to("jpg", vec![input(&unrelated, &[1])])
                .unwrap_err()
                .code,
            "long_image_extension_invalid"
        );
        assert!(!unrelated.exists());
    }

    #[test]
    fn preflight_failure_writes_nothing() {
        let directory = tempfile::tempdir().unwrap();
        let first = directory.path().join("output-long-01.png");
        let invalid = directory.path().join("output-long-02.jpg");
        let parts = vec![input(&first, &[1]), input(&invalid, &[2])];

        assert_eq!(
            save_long_images_to("png", parts).unwrap_err().code,
            "long_image_extension_invalid"
        );
        assert!(!first.exists());
        assert!(!invalid.exists());
    }

    #[test]
    fn leaves_files_with_unrelated_extensions_untouched() {
        let directory = tempfile::tempdir().unwrap();
        let unrelated = directory.path().join("output-long.png");
        let jpeg = directory.path().join("output-long.jpg");
        fs::write(&unrelated, b"existing png").unwrap();

        save_long_images_to("jpg", vec![input(&jpeg, b"new jpeg")]).unwrap();

        assert_eq!(fs::read(unrelated).unwrap(), b"existing png");
        assert_eq!(fs::read(jpeg).unwrap(), b"new jpeg");
    }

    #[test]
    fn write_failure_restores_existing_files_and_removes_only_new_outputs() {
        let directory = tempfile::tempdir().unwrap();
        let first = directory.path().join("output-long-01.png");
        let second = directory.path().join("output-long-02.png");
        let third = directory.path().join("output-long-03.png");
        fs::write(&first, b"original").unwrap();
        let parts = vec![
            input(&first, b"new-one"),
            input(&second, b"new-two"),
            input(&third, b"new-three"),
        ];

        let error = save_long_images_with_writer("png", parts, |path, bytes, phase| {
            if phase == WritePhase::Commit && path == third {
                return Err(CommandError::new(
                    "long_image_write_failed",
                    "injected failure",
                ));
            }
            write_bytes_atomically(path, bytes, long_image_write_errors())
        })
        .unwrap_err();

        assert_eq!(error.code, "long_image_write_failed");
        assert_eq!(fs::read(first).unwrap(), b"original");
        assert!(!second.exists());
        assert!(!third.exists());
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn concurrent_batches_are_serialized_without_mixing_parts() {
        let directory = tempfile::tempdir().unwrap();
        let path = Arc::new(directory.path().to_path_buf());
        let (entered_sender, entered_receiver) = mpsc::channel();
        let (release_sender, release_receiver) = mpsc::channel();
        let second_entered = Arc::new(AtomicBool::new(false));

        let first_path = Arc::clone(&path);
        let first = thread::spawn(move || {
            let mut paused = false;
            save_long_images_with_writer(
                "jpg",
                two_parts(&first_path, 0xa1),
                |path, bytes, _phase| {
                    if !paused {
                        paused = true;
                        entered_sender.send(()).unwrap();
                        release_receiver.recv().unwrap();
                    }
                    write_bytes_atomically(path, bytes, long_image_write_errors())
                },
            )
        });
        entered_receiver.recv().unwrap();

        let second_path = Arc::clone(&path);
        let second_entered_for_thread = Arc::clone(&second_entered);
        let second = thread::spawn(move || {
            save_long_images_with_writer(
                "jpg",
                two_parts(&second_path, 0xb2),
                |path, bytes, _phase| {
                    second_entered_for_thread.store(true, Ordering::SeqCst);
                    write_bytes_atomically(path, bytes, long_image_write_errors())
                },
            )
        });

        thread::sleep(Duration::from_millis(40));
        assert!(!second_entered.load(Ordering::SeqCst));
        release_sender.send(()).unwrap();
        first.join().unwrap().unwrap();
        second.join().unwrap().unwrap();

        assert_eq!(
            fs::read(directory.path().join("output-long-01.jpg")).unwrap(),
            [0xb2, 1]
        );
        assert_eq!(
            fs::read(directory.path().join("output-long-02.jpg")).unwrap(),
            [0xb2, 2]
        );
    }

    #[test]
    fn supports_unicode_output_names() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("夏季长图.png");
        save_long_images_to("png", vec![input(&path, &[8, 8])]).unwrap();
        assert_eq!(fs::read(path).unwrap(), [8, 8]);
    }

    #[test]
    fn counts_unicode_code_points_and_preserves_numbering_room() {
        let directory = tempfile::tempdir().unwrap();
        let chinese = "图".repeat(43);
        let chinese_path = directory.path().join(format!("{chinese}.png"));
        save_long_images_to("png", vec![input(&chinese_path, &[1])]).unwrap();

        let emoji = "😀".repeat(MAX_LONG_IMAGE_BASE_NAME_UTF16_CODE_UNITS / 2);
        let emoji_paths = [
            directory.path().join(format!("{emoji}-01.jpg")),
            directory.path().join(format!("{emoji}-02.jpg")),
        ];
        save_long_images_to(
            "jpg",
            emoji_paths.iter().map(|path| input(path, &[2])).collect(),
        )
        .unwrap();

        assert!(chinese_path.exists());
        assert!(emoji_paths.iter().all(|path| path.exists()));
        assert!(emoji_paths.iter().all(|path| {
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .encode_utf16()
                .count()
                <= MAX_LONG_IMAGE_FILENAME_UTF16_CODE_UNITS
        }));
    }

    #[test]
    fn accepts_combining_marks_and_rejects_ascii_over_the_code_point_limit() {
        let directory = tempfile::tempdir().unwrap();
        let combining = "e\u{301}".repeat(60);
        let combining_path = directory.path().join(format!("{combining}.png"));
        save_long_images_to("png", vec![input(&combining_path, &[3])]).unwrap();
        assert!(combining_path.exists());

        let maximum = "a".repeat(MAX_LONG_IMAGE_BASE_NAME_CODE_POINTS);
        let maximum_path = directory.path().join(format!("{maximum}.png"));
        save_long_images_to("png", vec![input(&maximum_path, &[4])]).unwrap();

        let excessive = "a".repeat(MAX_LONG_IMAGE_BASE_NAME_CODE_POINTS + 1);
        let excessive_path = directory.path().join(format!("{excessive}.png"));
        assert_eq!(
            save_long_images_to("png", vec![input(&excessive_path, &[5])])
                .unwrap_err()
                .code,
            "long_image_name_invalid"
        );
        assert!(!excessive_path.exists());
    }

    #[test]
    fn rejects_reserved_trailing_and_mismatched_numbered_output_names() {
        let directory = tempfile::tempdir().unwrap();
        for name in ["CON.png", "project .png", "project..png"] {
            let path = directory.path().join(name);
            assert_eq!(
                save_long_images_to("png", vec![input(&path, &[1])])
                    .unwrap_err()
                    .code,
                "long_image_name_invalid"
            );
        }

        let parts = vec![
            input(&directory.path().join("renamed-01.png"), &[1]),
            input(&directory.path().join("other-02.png"), &[2]),
        ];
        assert_eq!(
            save_long_images_to("png", parts).unwrap_err().code,
            "long_image_name_invalid"
        );
    }
}
