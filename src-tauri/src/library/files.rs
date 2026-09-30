use std::{
    fs::{self, File, OpenOptions},
    io::{Cursor, Read, Write},
    path::{Component, Path, PathBuf},
    time::{Duration, Instant},
};

use image::{ImageFormat, ImageReader};
use sha2::{Digest, Sha256};

use super::{error, Result};
use crate::byte_write::{write_bytes_atomically, ByteWriteErrors};

pub const MAX_IMAGE_BYTES: usize = 64 * 1024 * 1024;

pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn uuid(value: &str) -> Result<()> {
    if uuid::Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value) {
        Ok(())
    } else {
        Err(error("invalid_id", "Expected a canonical UUID"))
    }
}

pub fn no_links(path: &Path) -> Result<()> {
    for ancestor in path.ancestors() {
        let meta = fs::symlink_metadata(ancestor).map_err(|e| error("path", e))?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0 {
                return Err(error(
                    "path",
                    "Reparse points are not allowed for library operations",
                ));
            }
        }
        if meta.file_type().is_symlink() {
            return Err(error(
                "path",
                "Symbolic links are not allowed for library operations",
            ));
        }
    }
    Ok(())
}

pub fn directory(path: &Path) -> Result<PathBuf> {
    let absolute = std::path::absolute(path).map_err(|e| error("path", e))?;
    no_links(&absolute)?;
    if !absolute.is_dir() {
        return Err(error("path", "Expected an existing directory"));
    }
    absolute.canonicalize().map_err(|e| error("path", e))
}

pub fn child_dir(parent: &Path, name: &str) -> Result<PathBuf> {
    let path = parent.join(name);
    match fs::create_dir(&path) {
        Ok(()) => (),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
        Err(e) => return Err(error("directory", e)),
    }
    directory(&path)
}

pub fn check_leaf(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(_) => no_links(path),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => no_links(
            path.parent()
                .ok_or_else(|| error("path", "Missing parent"))?,
        ),
        Err(e) => Err(error("path", e)),
    }
}

pub fn reference_name(value: &str) -> Result<&str> {
    // Wire paths are portable POSIX-relative paths; native paths use PathBuf joins.
    let parts: Vec<_> = value.split('/').collect();
    if parts.len() != 2
        || parts[0] != "references"
        || parts[1].is_empty()
        || parts[1].encode_utf16().count() > 255
        || parts[1]
            .chars()
            .any(|c| c.is_control() || "\\:<>\"|?*%".contains(c))
        || parts[1].ends_with([' ', '.'])
        || !Path::new(parts[1])
            .components()
            .all(|p| matches!(p, Component::Normal(_)))
    {
        return Err(error(
            "path",
            "Expected a confined references/<file>.jpg or .png path",
        ));
    }
    let stem = parts[1].split('.').next().unwrap_or("").to_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.chars().count() == 4
            && stem
                .chars()
                .last()
                .is_some_and(|c| "123456789¹²³".contains(c))
    {
        return Err(error(
            "path",
            "Windows device names are not project reference files",
        ));
    }
    let extension = parts[1]
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "jpg" | "jpeg" | "png") {
        return Err(error(
            "path",
            "Only project JPG/PNG references are supported",
        ));
    }
    Ok(parts[1])
}

pub fn reference(project: &Path, value: &str, exists: bool) -> Result<PathBuf> {
    let path = project.join("references").join(reference_name(value)?);
    check_leaf(&path)?;
    if exists {
        let canonical = path.canonicalize().map_err(|e| error("image_missing", e))?;
        if !canonical.starts_with(project) || !canonical.is_file() {
            return Err(error("path", "Reference escaped the project directory"));
        }
    }
    Ok(path)
}

pub fn read_original(path: &Path) -> Result<Vec<u8>> {
    no_links(path)?;
    fs::read(path).map_err(|e| error("read", e))
}

pub fn read_limited(path: &Path, cap: usize) -> Result<Vec<u8>> {
    no_links(path)?;
    let file = File::open(path).map_err(|e| error("read", e))?;
    let metadata = file.metadata().map_err(|e| error("read", e))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > cap as u64 {
        return Err(error(
            "size",
            "File is empty or exceeds its safe byte limit",
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(cap as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| error("read", e))?;
    if bytes.len() > cap {
        return Err(error("size", "File grew beyond its byte limit"));
    }
    Ok(bytes)
}

pub fn image_info(bytes: &[u8], preview: bool) -> Result<(&'static str, u32, u32)> {
    let cap = if preview { 2 * 1024 * 1024 } else { usize::MAX };
    if bytes.is_empty() || bytes.len() > cap {
        return Err(error("image_size", "Image exceeds its encoded-byte limit"));
    }
    let format = image::guess_format(bytes).map_err(|e| error("image_decode", e))?;
    if !matches!(format, ImageFormat::Png | ImageFormat::Jpeg)
        || (preview && format != ImageFormat::Png)
    {
        return Err(error(
            "image_format",
            "Expected actual PNG/JPEG bytes (PNG for previews)",
        ));
    }
    let dimensions = ImageReader::with_format(Cursor::new(bytes), format)
        .into_dimensions()
        .map_err(|e| error("image_decode", e))?;
    let (width, height) = dimensions;
    if width == 0
        || height == 0
        || (preview && (width > 480 || height > 8192))
    {
        return Err(error(
            "image_dimensions",
            "Image dimensions are invalid or exceed the thumbnail bounds",
        ));
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    // Originals retain their native resolution. Thumbnail limits belong only to
    // the derived preview; the decoder still validates the complete original.
    if preview {
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(480);
        limits.max_image_height = Some(8192);
        limits.max_alloc = Some(128 * 1024 * 1024);
        reader.limits(limits);
    } else {
        reader.no_limits();
    }
    reader.decode().map_err(|e| error("image_decode", e))?;
    Ok((
        if format == ImageFormat::Png {
            "image/png"
        } else {
            "image/jpeg"
        },
        width,
        height,
    ))
}

pub fn atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    check_leaf(path)?;
    write_bytes_atomically(
        path,
        bytes,
        ByteWriteErrors {
            decode_code: "library_decode",
            decode_label: "library data",
            write_code: "library_write",
            write_label: "library data",
        },
    )
}

pub fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    check_leaf(path)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| error("write", e))?;
    // The caller's already-durable journal owns partial files as well.
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| error("write", e))
}

pub fn publish_new(staged: &Path, destination: &Path) -> Result<()> {
    check_leaf(destination)?;
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};
        let staged: Vec<_> = staged.as_os_str().encode_wide().chain(Some(0)).collect();
        let destination: Vec<_> = destination
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        // No REPLACE_EXISTING: a late filename collision must never overwrite.
        if unsafe {
            MoveFileExW(
                staged.as_ptr(),
                destination.as_ptr(),
                MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            return Err(error("reference_publish", std::io::Error::last_os_error()));
        }
    }
    #[cfg(not(windows))]
    {
        if destination
            .try_exists()
            .map_err(|e| error("reference_publish", e))?
        {
            return Err(error(
                "reference_publish",
                "Allocated reference filename already exists",
            ));
        }
        fs::rename(staged, destination).map_err(|e| error("reference_publish", e))?;
        File::open(destination.parent().unwrap())
            .and_then(|file| file.sync_all())
            .map_err(|e| error("reference_publish", e))?;
    }
    Ok(())
}

pub struct Lock(File);
impl Lock {
    pub fn acquire(path: &Path) -> Result<Self> {
        check_leaf(path)?;
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path)
            .map_err(|e| error("lock", e))?;
        let start = Instant::now();
        loop {
            match fs2::FileExt::try_lock_exclusive(&file) {
                Ok(()) => return Ok(Self(file)),
                Err(e)
                    if start.elapsed() < Duration::from_secs(15)
                        && (e.kind() == std::io::ErrorKind::WouldBlock
                            || e.raw_os_error() == Some(33)) =>
                {
                    std::thread::sleep(Duration::from_millis(15))
                }
                Err(e) => {
                    return Err(error(
                        "busy",
                        format!("Library/project is busy; retry: {e}"),
                    ))
                }
            }
        }
    }
}
impl Drop for Lock {
    fn drop(&mut self) {
        let _ = fs2::FileExt::unlock(&self.0);
    }
}

pub fn project_lock(project: &Path) -> Result<Lock> {
    Lock::acquire(&project.join(".preshot-project.lock"))
}
