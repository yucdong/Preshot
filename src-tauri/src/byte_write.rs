use std::{
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use uuid::Uuid;

use crate::error::CommandError;

#[cfg(windows)]
pub fn replace_file_atomically(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use std::{thread, time::Duration};
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let temporary = temporary
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    for attempt in 0..100 {
        let result = unsafe {
            MoveFileExW(
                temporary.as_ptr(),
                destination.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if result != 0 {
            return Ok(());
        }

        let error = std::io::Error::last_os_error();
        let retryable = matches!(error.raw_os_error(), Some(5 | 32 | 33));
        if !retryable || attempt == 99 {
            return Err(error);
        }
        thread::sleep(Duration::from_millis(2));
    }

    unreachable!()
}

#[cfg(not(windows))]
pub fn replace_file_atomically(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(temporary, destination)
}

pub struct ByteWriteErrors {
    pub decode_code: &'static str,
    pub decode_label: &'static str,
    pub write_code: &'static str,
    pub write_label: &'static str,
}

fn create_unique_sibling_temp(destination: &Path) -> io::Result<(PathBuf, File)> {
    let parent = destination.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "the output path has no parent directory",
        )
    })?;
    let file_name = destination.file_name().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "the output path has no file name",
        )
    })?;

    loop {
        let mut temporary_name = OsString::from(".");
        temporary_name.push(file_name);
        temporary_name.push(format!(".preshot-{}.tmp", Uuid::new_v4()));
        let temporary = parent.join(temporary_name);
        match OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
        {
            Ok(file) => return Ok((temporary, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
}

fn write_bytes_atomically_with<W, F>(
    path: &Path,
    errors: &ByteWriteErrors,
    write_temporary: W,
    finalize: F,
) -> Result<(), CommandError>
where
    W: FnOnce(&mut File) -> io::Result<()>,
    F: FnOnce(&Path, &Path) -> io::Result<()>,
{
    let (temporary, mut file) = create_unique_sibling_temp(path).map_err(|error| {
        CommandError::new(
            errors.write_code,
            format!(
                "Unable to create a temporary {} file: {error}",
                errors.write_label
            ),
        )
    })?;

    if let Err(error) = write_temporary(&mut file) {
        drop(file);
        let _ = fs::remove_file(&temporary);
        return Err(CommandError::new(
            errors.write_code,
            format!("Unable to write the {}: {error}", errors.write_label),
        ));
    }
    drop(file);

    if let Err(error) = finalize(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(CommandError::new(
            errors.write_code,
            format!("Unable to finalize the {}: {error}", errors.write_label),
        ));
    }

    Ok(())
}

pub fn write_base64_atomically(
    path: &Path,
    contents_base64: &str,
    errors: ByteWriteErrors,
) -> Result<(), CommandError> {
    let bytes = STANDARD.decode(contents_base64).map_err(|error| {
        CommandError::new(
            errors.decode_code,
            format!("Unable to decode {} bytes: {error}", errors.decode_label),
        )
    })?;

    write_bytes_atomically(path, &bytes, errors)
}

pub fn write_bytes_atomically(
    path: &Path,
    bytes: &[u8],
    errors: ByteWriteErrors,
) -> Result<(), CommandError> {
    write_bytes_atomically_with(
        path,
        &errors,
        |file| {
            file.write_all(bytes)?;
            file.flush()?;
            file.sync_all()
        },
        replace_file_atomically,
    )
}

pub fn validate_extension(
    path: &Path,
    expected_extension: &str,
    error_code: &'static str,
    label: &'static str,
) -> Result<(), CommandError> {
    let valid = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case(expected_extension));
    if !valid {
        return Err(CommandError::new(
            error_code,
            format!(
                "Unable to save the {label}: the output path must use the .{expected_extension} extension."
            ),
        ));
    }
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty());
    match parent.map(fs::metadata) {
        Some(Ok(metadata)) if metadata.is_dir() => Ok(()),
        Some(Ok(_)) => Err(CommandError::new(
            error_code,
            format!("Unable to save the {label}: the output parent is not a directory."),
        )),
        Some(Err(error)) => Err(CommandError::new(
            error_code,
            format!("Unable to save the {label}: the output directory is unavailable: {error}"),
        )),
        None => Err(CommandError::new(
            error_code,
            format!("Unable to save the {label}: the output path has no parent directory."),
        )),
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        io::{self, Write},
        sync::{Arc, Barrier},
        thread,
    };

    use super::*;

    const TEST_ERRORS: ByteWriteErrors = ByteWriteErrors {
        decode_code: "test_decode_failed",
        decode_label: "test",
        write_code: "test_write_failed",
        write_label: "test",
    };

    fn temporary_files(directory: &Path) -> Vec<PathBuf> {
        fs::read_dir(directory)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.contains(".preshot-") && name.ends_with(".tmp"))
            })
            .collect()
    }

    #[test]
    fn concurrent_writers_only_commit_their_own_complete_payload() {
        let directory = tempfile::tempdir().unwrap();
        let destination = Arc::new(directory.path().join("shared.bin"));
        let barrier = Arc::new(Barrier::new(2));
        let payloads = [vec![0x3a; 256 * 1024], vec![0xc7; 256 * 1024]];

        let writers = payloads.clone().map(|payload| {
            let destination = Arc::clone(&destination);
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                let expected = payload.clone();
                write_bytes_atomically_with(
                    &destination,
                    &TEST_ERRORS,
                    |file| {
                        file.write_all(&payload)?;
                        file.flush()?;
                        file.sync_all()?;
                        barrier.wait();
                        Ok(())
                    },
                    |temporary, destination| {
                        if fs::read(temporary)? != expected {
                            return Err(io::Error::other(
                                "writer's temporary file contained another payload",
                            ));
                        }
                        replace_file_atomically(temporary, destination)
                    },
                )
            })
        });

        for writer in writers {
            writer.join().unwrap().unwrap();
        }

        let committed = fs::read(destination.as_ref()).unwrap();
        assert!(payloads.iter().any(|payload| payload == &committed));
        assert!(temporary_files(directory.path()).is_empty());
    }

    #[test]
    fn write_failure_removes_partial_temp_and_preserves_destination() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("shared.bin");
        fs::write(&destination, b"original").unwrap();

        let error = write_bytes_atomically_with(
            &destination,
            &TEST_ERRORS,
            |file| {
                file.write_all(b"partial")?;
                Err(io::Error::other("injected write failure"))
            },
            replace_file_atomically,
        )
        .unwrap_err();

        assert_eq!(error.code, "test_write_failed");
        assert_eq!(fs::read(&destination).unwrap(), b"original");
        assert!(temporary_files(directory.path()).is_empty());
    }

    #[test]
    fn flush_failure_removes_temp_and_preserves_destination() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("shared.bin");
        fs::write(&destination, b"original").unwrap();

        let error = write_bytes_atomically_with(
            &destination,
            &TEST_ERRORS,
            |file| {
                file.write_all(b"complete")?;
                file.flush()?;
                Err(io::Error::other("injected flush failure"))
            },
            replace_file_atomically,
        )
        .unwrap_err();

        assert_eq!(error.code, "test_write_failed");
        assert_eq!(fs::read(&destination).unwrap(), b"original");
        assert!(temporary_files(directory.path()).is_empty());
    }

    #[test]
    fn rename_failure_removes_temp_and_preserves_destination() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("shared.bin");
        fs::write(&destination, b"original").unwrap();

        let error = write_bytes_atomically_with(
            &destination,
            &TEST_ERRORS,
            |file| {
                file.write_all(b"replacement")?;
                file.flush()?;
                file.sync_all()
            },
            |_temporary, _destination| Err(io::Error::other("injected rename failure")),
        )
        .unwrap_err();

        assert_eq!(error.code, "test_write_failed");
        assert_eq!(fs::read(&destination).unwrap(), b"original");
        assert!(temporary_files(directory.path()).is_empty());
    }
}
