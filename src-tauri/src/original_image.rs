//! File-backed originals. Encoded file size is not an application limit.
use std::{fs::{File, OpenOptions}, io::{BufReader, Read, Write, Cursor}, path::Path, sync::{Mutex, OnceLock, Arc, atomic::{AtomicBool, Ordering}}};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{ImageDecoder, ImageFormat, ImageReader};
use sha2::{Digest, Sha256};
use crate::error::CommandError;

type Result<T> = std::result::Result<T, CommandError>;
fn error(e: impl std::fmt::Display) -> CommandError {
    CommandError::new("original_image", format!("Unable to process the original image: {e}"))
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PresentationAxes {
    #[default]
    Raw,
    Exif,
}
impl PresentationAxes {
    fn key(self) -> &'static str { match self { Self::Raw => "raw", Self::Exif => "exif" } }
}

pub fn presentation_axes(value: &serde_json::Value) -> Result<PresentationAxes> {
    value.get("presentationAxes").map(|value| serde_json::from_value(value.clone()).map_err(error))
        .unwrap_or(Ok(PresentationAxes::Raw))
}

pub fn display_dimensions(path: &Path, axes: PresentationAxes) -> Result<(u32, u32)> {
    let (_, width, height) = info(path)?;
    if axes == PresentationAxes::Raw { return Ok((width, height)); }
    use image::metadata::Orientation::*;
    Ok(match original_orientation(path)? {
        Rotate90 | Rotate270 | Rotate90FlipH | Rotate270FlipH => (height, width),
        _ => (width, height),
    })
}
fn original_orientation(path: &Path) -> Result<image::metadata::Orientation> {
    crate::library::files::no_links(path)?;
    let mut reader = ImageReader::open(path).map_err(error)?.with_guessed_format().map_err(error)?;
    reader.no_limits();
    let mut decoder = reader.into_decoder().map_err(error)?;
    decoder.orientation().map_err(error)
}
pub fn import_axes(path: &Path) -> Result<Option<PresentationAxes>> {
    Ok((original_orientation(path)? != image::metadata::Orientation::NoTransforms).then_some(PresentationAxes::Exif))
}

pub fn fingerprint(path: &Path) -> Result<(u64, String)> {
    crate::library::files::no_links(path)?;
    let mut input = File::open(path).map_err(error)?;
    let metadata = input.metadata().map_err(error)?;
    if !metadata.is_file() || metadata.len() == 0 { return Err(error("The image is empty or missing")); }
    let mut hash = Sha256::new();
    let mut length = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = input.read(&mut buffer).map_err(error)?;
        if count == 0 { break; }
        hash.update(&buffer[..count]);
        length = length.checked_add(count as u64).ok_or_else(|| error("File length overflow"))?;
    }
    if length != metadata.len() { return Err(error("The image changed while reading; retry")); }
    Ok((length, format!("{:x}", hash.finalize())))
}

pub fn verify(path: &Path, length: u64, hash: &str) -> Result<()> {
    if fingerprint(path)? != (length, hash.to_owned()) { return Err(error("Original image was changed or damaged")); }
    Ok(())
}

/// Destination must already have a durable owner. Short writes remain owned by
/// that journal, and must never be mistaken for a successfully published file.
pub fn copy_new(source: &Path, destination: &Path, length: u64, hash: &str) -> Result<()> {
    copy_new_inner(source, destination, length, hash, false)
}

/// Imports without a resumable file journal discard only a destination that
/// this invocation successfully created. A failed allocation owns nothing.
pub fn copy_new_cleaned(source: &Path, destination: &Path, length: u64, hash: &str) -> Result<()> {
    copy_new_inner(source, destination, length, hash, true)
}

fn copy_new_inner(source: &Path, destination: &Path, length: u64, hash: &str, clean_failure: bool) -> Result<()> {
    crate::library::files::no_links(source)?;
    crate::library::files::check_leaf(destination)?;
    let mut input = File::open(source).map_err(error)?;
    let mut output = OpenOptions::new().create_new(true).write(true).open(destination).map_err(error)?;
    let result = (|| {
        let mut actual = Sha256::new();
        let mut copied = 0u64;
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let count = input.read(&mut buffer).map_err(error)?;
            if count == 0 { break; }
            output.write_all(&buffer[..count]).map_err(error)?;
            actual.update(&buffer[..count]);
            copied = copied.checked_add(count as u64).ok_or_else(|| error("File length overflow"))?;
        }
        output.sync_all().map_err(error)?;
        if copied != length || format!("{:x}", actual.finalize()) != hash { return Err(error("Source changed during copying")); }
        Ok(())
    })();
    drop(output);
    if clean_failure {
        if let Err(cause) = &result {
            std::fs::remove_file(destination).map_err(|cleanup| error(format!("{cause}; copied-file cleanup failed: {cleanup}")))?;
        }
    }
    result
}

pub fn is_prefix(partial: &Path, source: &Path) -> Result<bool> {
    crate::library::files::no_links(partial)?;
    crate::library::files::no_links(source)?;
    let mut left = BufReader::new(File::open(partial).map_err(error)?);
    let mut right = BufReader::new(File::open(source).map_err(error)?);
    let mut a = [0; 64 * 1024];
    let mut b = [0; 64 * 1024];
    loop {
        let count = left.read(&mut a).map_err(error)?;
        if count == 0 { return Ok(true); }
        if right.read_exact(&mut b[..count]).is_err() || a[..count] != b[..count] { return Ok(false); }
    }
}

pub fn info(path: &Path) -> Result<(&'static str, u32, u32)> {
    crate::library::files::no_links(path)?;
    let reader = ImageReader::open(path).map_err(error)?.with_guessed_format().map_err(error)?;
    let mime = match reader.format() {
        Some(ImageFormat::Jpeg) => "image/jpeg",
        Some(ImageFormat::Png) => "image/png",
        _ => return Err(error("Only JPG and PNG originals are supported")),
    };
    let (width, height) = reader.into_dimensions().map_err(error)?;
    if width == 0 || height == 0 { return Err(error("Invalid image dimensions")); }
    Ok((mime, width, height))
}

// Serialize native raster allocations; copies and hashes need only fixed buffers.
static DECODE: Mutex<()> = Mutex::new(());
fn decode_original(path: &Path, axes: PresentationAxes) -> Result<image::DynamicImage> {
    let mut reader = ImageReader::open(path).map_err(error)?.with_guessed_format().map_err(error)?;
    reader.no_limits();
    #[cfg(windows)] {
        use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
        let mut memory: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
        memory.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        if unsafe { GlobalMemoryStatusEx(&mut memory) } != 0 {
            let mut limits = image::Limits::no_limits();
            limits.max_alloc = Some(memory.ullAvailPhys / 3);
            reader.limits(limits);
        }
    }
    let mut decoder = reader.into_decoder().map_err(error)?;
    let orientation = if axes == PresentationAxes::Exif { decoder.orientation().map_err(error)? } else { image::metadata::Orientation::NoTransforms };
    let mut decoded = image::DynamicImage::from_decoder(decoder).map_err(error)?;
    decoded.apply_orientation(orientation);
    Ok(decoded)
}

pub fn raster_for_edit_with_axes(path: &Path, axes: PresentationAxes) -> Result<(image::DynamicImage, std::sync::MutexGuard<'static, ()>)> {
    let guard = DECODE.lock().map_err(error)?;
    Ok((decode_original(path, axes)?, guard))
}

fn render_display(path: &Path, output: &Path, edge: u32, axes: PresentationAxes) -> Result<()> {
    let decoded = decode_original(path, axes)?;
    let edge = edge.clamp(1, 4096);
    let display = decoded.thumbnail(edge.min(decoded.width()), edge.min(decoded.height()));
    drop(decoded);
    let mut bytes = Cursor::new(Vec::new());
    display.write_to(&mut bytes, ImageFormat::Png).map_err(error)?;
    let mut file = OpenOptions::new().create_new(true).write(true).open(output).map_err(error)?;
    file.write_all(bytes.get_ref()).map_err(error)?;
    file.sync_all().map_err(error)
}

/// Runs before Tauri initializes. A failed original decoder cannot unwind or
/// exhaust the renderer process. Original-file validation never uses clipboard IPC.
pub fn run_worker_if_requested() -> bool {
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).is_none_or(|arg| arg != "--preshot-original-image-worker") { return false; }
    let result = if args.len() == 6 {
        args[4].to_str().and_then(|s| s.parse::<u32>().ok())
            .ok_or_else(|| error("Invalid image worker request"))
            .and_then(|edge| {
                let axes = match args[5].to_str() { Some("raw") => PresentationAxes::Raw, Some("exif") => PresentationAxes::Exif, _ => return Err(error("Invalid image axes")) };
                render_display(Path::new(&args[2]), Path::new(&args[3]), edge, axes)
            })
    } else { Err(error("Invalid image worker request")) };
    std::process::exit(if result.is_ok() { 0 } else { 1 });
}

static JOBS: OnceLock<Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
pub struct DisplayJob { id: String, cancelled: Arc<AtomicBool> }
impl DisplayJob {
    pub fn new(id: String) -> Result<Self> {
        crate::library::files::uuid(&id)?;
        let cancelled = Arc::new(AtomicBool::new(false));
        let mut jobs = JOBS.get_or_init(Default::default).lock().map_err(error)?;
        if jobs.contains_key(&id) { return Err(error("Display job already exists")); }
        jobs.insert(id.clone(), cancelled.clone());
        Ok(Self { id, cancelled })
    }
    #[cfg(test)]
    pub fn render(&self, path: &Path, edge: u32) -> Result<String> { self.render_with_axes(path, edge, PresentationAxes::Raw) }
    pub fn render_with_axes(&self, path: &Path, edge: u32, axes: PresentationAxes) -> Result<String> { display_url_cancel(path, edge, axes, &self.cancelled) }
}
impl Drop for DisplayJob {
    fn drop(&mut self) { if let Ok(mut jobs) = JOBS.get_or_init(Default::default).lock() { jobs.remove(&self.id); } }
}
#[tauri::command]
pub fn cancel_image_display(id: String) -> Result<()> {
    crate::library::files::uuid(&id)?;
    if let Some(cancelled) = JOBS.get_or_init(Default::default).lock().map_err(error)?.get(&id) { cancelled.store(true, Ordering::Relaxed); }
    Ok(())
}
pub fn display_url(path: &Path, edge: u32) -> Result<String> { display_url_with_axes(path, edge, PresentationAxes::Raw) }
pub fn display_url_with_axes(path: &Path, edge: u32, axes: PresentationAxes) -> Result<String> { display_url_cancel(path, edge, axes, &AtomicBool::new(false)) }

fn valid_cached_display(path: &Path, edge: u32) -> bool {
    let validate = || -> Result<()> {
        let file = File::open(path).map_err(error)?;
        let metadata = file.metadata().map_err(error)?;
        if !metadata.is_file() || metadata.len() == 0 || metadata.len() > 68 * 1024 * 1024 {
            return Err(error("Invalid cached preview size"));
        }
        let mut decoder = png::Decoder::new(BufReader::new(file));
        decoder.set_limits(png::Limits { bytes: 8 * 1024 * 1024 });
        decoder.set_ignore_text_chunk(true);
        decoder.set_ignore_iccp_chunk(true);
        let mut reader = decoder.read_info().map_err(error)?;
        let info = reader.info();
        if info.width == 0 || info.height == 0 || info.width > edge || info.height > edge
            || info.animation_control.is_some()
        {
            return Err(error("Invalid cached preview dimensions"));
        }
        // A valid IHDR does not establish that IDAT pixels are readable. Verify
        // rows and trailing checksums without allocating a second full raster.
        while reader.next_row().map_err(error)?.is_some() {}
        reader.finish().map_err(error)
    };
    validate().is_ok()
}

fn display_url_cancel(path: &Path, edge: u32, axes: PresentationAxes, cancelled: &AtomicBool) -> Result<String> {
    let edge = edge.clamp(1, 4096);
    let (_, hash) = fingerprint(path)?;
    let _guard = loop {
        if cancelled.load(Ordering::Relaxed) { return Err(error("Preview cancelled")); }
        match DECODE.try_lock() {
            Ok(guard) => break guard,
            Err(std::sync::TryLockError::WouldBlock) => std::thread::sleep(std::time::Duration::from_millis(25)),
            Err(_) => return Err(error("Decoder unavailable; restart the application")),
        }
    };
    let root = std::env::temp_dir().join("Preshot-derived-images-v2");
    std::fs::create_dir_all(&root).map_err(error)?;
    crate::library::files::no_links(&root)?;
    let cached = root.join(if axes == PresentationAxes::Raw { format!("{hash}-{edge}.png") } else { format!("{hash}-{edge}-{}.png", axes.key()) });
    crate::library::files::check_leaf(&cached)?;
    if cached.exists() && !valid_cached_display(&cached, edge) {
        // This file is an owned, disposable derivative. Retry regenerates it;
        // the source and durable original receipts remain untouched.
        std::fs::remove_file(&cached).map_err(error)?;
    }
    if !cached.exists() {
        let temporary = root.join(format!("{}.pending", uuid::Uuid::new_v4()));
        #[cfg(test)]
        let result = render_display(path, &temporary, edge, axes);
        #[cfg(not(test))]
        let result = (|| {
            let mut command = std::process::Command::new(std::env::current_exe().map_err(error)?);
            command.arg("--preshot-original-image-worker").arg(path).arg(&temporary).arg(edge.to_string()).arg(axes.key());
            #[cfg(windows)] {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            let mut child = command.spawn().map_err(error)?;
            let start = std::time::Instant::now();
            let status = loop {
                if cancelled.load(Ordering::Relaxed) || start.elapsed() > std::time::Duration::from_secs(300) {
                    let _ = child.kill(); let _ = child.wait();
                    return Err(error("Preview cancelled or timed out; the original is preserved"));
                }
                if let Some(status) = child.try_wait().map_err(error)? { break status; }
                std::thread::sleep(std::time::Duration::from_millis(25));
            };
            if !status.success() { return Err(error("Image preview decoding failed. The original is preserved; retry with more available memory.")); }
            Ok(())
        })();
        if let Err(failure) = result {
            if temporary.exists() { let _ = std::fs::remove_file(&temporary); }
            return Err(failure);
        }
        if let Err(failure) = std::fs::rename(&temporary, &cached) {
            let _ = std::fs::remove_file(&temporary);
            if !cached.exists() { return Err(error(failure)); }
        }
    }
    if cancelled.load(Ordering::Relaxed) { return Err(error("Preview cancelled")); }
    let bytes = crate::library::files::read_limited(&cached, 68 * 1024 * 1024)?;
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

/// A committed original must remain usable even when its disposable preview fails.
#[cfg(test)]
pub fn preview_result(path: &Path, edge: u32) -> (String, Option<String>) {
    preview_result_with_axes(path, edge, PresentationAxes::Raw)
}
pub fn preview_result_with_axes(path: &Path, edge: u32, axes: PresentationAxes) -> (String, Option<String>) {
    match display_url_with_axes(path, edge, axes) {
        Ok(url) => (url, None),
        Err(_) => (String::new(), Some("Original saved; preview unavailable. Retry preview.".into())),
    }
}

#[cfg(test)]
pub(crate) fn test_jpeg_with_orientation(width: u32, height: u32, direction: u8) -> Vec<u8> {
    let pixels = image::RgbImage::from_fn(width, height, |x, y| image::Rgb([(x * 29) as u8, (y * 37) as u8, ((x + y) * 17) as u8]));
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 95).encode_image(&pixels).unwrap();
    let mut exif = b"Exif\0\0II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x01\0\0\0\0\0\0\0".to_vec();
    exif[24] = direction;
    let mut bytes = jpeg[..2].to_vec();
    bytes.extend_from_slice(&[0xff, 0xe1]);
    bytes.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
    bytes.extend_from_slice(&exif);
    bytes.extend_from_slice(&jpeg[2..]);
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn streaming_copy_keeps_original_hash_and_short_writes_are_never_valid() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.png");
        let target = root.path().join("copy.png");
        std::fs::write(&source, b"streaming integrity fixture").unwrap();
        let (size, hash) = fingerprint(&source).unwrap();
        copy_new(&source, &target, size, &hash).unwrap();
        assert_eq!(fingerprint(&target).unwrap(), (size, hash.clone()));
        assert!(copy_new(&source, &target, size, &hash).is_err());
        std::fs::write(&target, b"streaming").unwrap();
        assert!(is_prefix(&target, &source).unwrap());
        assert!(verify(&target, size, &hash).is_err());
        std::fs::write(&source, b"different source").unwrap();
        assert!(!is_prefix(&target, &source).unwrap());
    }
    #[test]
    fn cancellation_and_bad_preview_preserve_original_files() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.png");
        std::fs::write(&source, b"corrupt PNG fixture").unwrap();
        let before = fingerprint(&source).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let job = DisplayJob::new(id.clone()).unwrap();
        cancel_image_display(id).unwrap();
        assert!(job.render(&source, 256).is_err());
        let (url, error) = preview_result(&source, 256);
        assert!(url.is_empty() && error.is_some());
        assert_eq!(fingerprint(&source).unwrap(), before);
    }

    #[test]
    fn damaged_disposable_cache_can_be_regenerated_without_touching_original() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.png");
        image::DynamicImage::new_rgb8(19, 7).save(&source).unwrap();
        let before = fingerprint(&source).unwrap();
        let first = display_url(&source, 37).unwrap();
        let cached = std::env::temp_dir().join("Preshot-derived-images-v2").join(format!("{}-37.png", before.1));
        std::fs::write(&cached, b"interrupted cache write").unwrap();
        assert_eq!(display_url(&source, 37).unwrap(), first);
        assert_eq!(fingerprint(&source).unwrap(), before);
    }

    #[test]
    fn corrupt_cached_pixels_with_valid_dimensions_are_regenerated() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.png");
        image::DynamicImage::new_rgb8(31, 13).save(&source).unwrap();
        let before = fingerprint(&source).unwrap();
        let first = display_url(&source, 41).unwrap();
        let cached = std::env::temp_dir().join("Preshot-derived-images-v2")
            .join(format!("{}-41.png", before.1));
        let mut damaged = std::fs::read(&cached).unwrap();
        let idat = damaged.windows(4).position(|bytes| bytes == b"IDAT").unwrap();
        damaged[idat + 4] ^= 0xff;
        std::fs::write(&cached, &damaged).unwrap();
        assert_eq!(info(&cached).unwrap(), ("image/png", 31, 13));
        assert!(image::load_from_memory(&damaged).is_err());
        assert_eq!(display_url(&source, 41).unwrap(), first);
        assert_eq!(fingerprint(&source).unwrap(), before);
    }

    #[test]
    fn cleaned_copy_removes_failed_owned_output_but_preserves_collisions() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.png");
        let target = root.path().join("copy.png");
        std::fs::write(&source, b"source bytes").unwrap();
        let (size, hash) = fingerprint(&source).unwrap();
        std::fs::write(&target, b"foreign file").unwrap();
        assert!(copy_new_cleaned(&source, &target, size, &hash).is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"foreign file");
        std::fs::remove_file(&target).unwrap();
        assert!(copy_new_cleaned(&source, &target, size + 1, &hash).is_err());
        assert!(!target.exists());
        // Durable journal callers still retain partial output for exact recovery.
        assert!(copy_new(&source, &target, size + 1, &hash).is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"source bytes");
        assert_eq!(fingerprint(&source).unwrap(), (size, hash));
    }
}
