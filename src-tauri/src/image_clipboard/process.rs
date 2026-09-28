use super::*;
use image::{ImageFormat, RgbaImage};
use std::{
    io::{Read, Write},
    os::windows::{io::AsRawHandle, process::CommandExt},
    process::{Command, Stdio},
    ptr::null,
    sync::atomic::{AtomicBool, Ordering},
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, WAIT_TIMEOUT},
    System::{
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_ACTIVE_PROCESS, JOB_OBJECT_LIMIT_JOB_MEMORY,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_PROCESS_MEMORY,
        },
        Threading::{TerminateProcess, WaitForSingleObject, CREATE_NO_WINDOW},
    },
};

const ARGUMENT: &str = "--preshot-image-clipboard-codec-v1";
const MAGIC: &[u8; 8] = b"PSIMG001";
static DECODE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn decode_error() -> CommandError {
    error(
        "decode",
        "图片解码超过安全内存或时间限制，或图片已损坏。请转换为较小的 PNG/JPEG 后重试。",
    )
}

fn format_tag(format: ImageFormat) -> Result<u8, CommandError> {
    match format {
        ImageFormat::Png => Ok(1),
        ImageFormat::Jpeg => Ok(2),
        ImageFormat::Gif => Ok(3),
        ImageFormat::WebP => Ok(4),
        _ => Err(invalid()),
    }
}

struct Job(HANDLE);
impl Job {
    fn attach(process: HANDLE, memory: usize) -> Result<Self, CommandError> {
        unsafe {
            let handle = CreateJobObjectW(null(), null());
            if handle.is_null() {
                return Err(decode_error());
            }
            let job = Self(handle);
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY
                | JOB_OBJECT_LIMIT_JOB_MEMORY
                | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
            limits.BasicLimitInformation.ActiveProcessLimit = 1;
            limits.ProcessMemoryLimit = memory;
            limits.JobMemoryLimit = memory;
            if SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&limits) as u32,
            ) == 0
                || AssignProcessToJobObject(handle, process) == 0
            {
                return Err(decode_error());
            }
            Ok(job)
        }
    }
}
impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

// image's WebP decoder does not expose a hard allocation cap for entropy tables.
// Decode in a pipe-only child with a kernel-enforced aggregate limit, before sending it any bytes.
pub(super) fn decode_isolated(
    bytes: &[u8],
    format: ImageFormat,
    pixels: usize,
    input: usize,
    retained: usize,
) -> Result<(RgbaImage, bool), CommandError> {
    let _decode = DECODE_LOCK.lock().map_err(|_| decode_error())?;
    let child_budget = (256 * MIB)
        .checked_sub(bytes.len() + input + retained + pixels * 4 + 16 * MIB)
        .ok_or_else(oversized)?
        .min(160 * MIB);
    if child_budget < 48 * MIB {
        return Err(oversized());
    }
    let mut command = Command::new(std::env::current_exe().map_err(|_| decode_error())?);
    #[cfg(not(test))]
    command.arg(ARGUMENT);
    #[cfg(test)]
    command.args([
        "--exact",
        "image_clipboard::process::tests::codec_child_entry",
        "--ignored",
        "--nocapture",
    ]);
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|_| decode_error())?;
    let process = child.as_raw_handle() as HANDLE;
    let _job = match Job::attach(process, child_budget) {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    let timed_out = AtomicBool::new(false);
    std::thread::scope(|scope| {
        let process_handle = process as usize;
        let timed_out_ref = &timed_out;
        let watchdog = scope.spawn(move || unsafe {
            if WaitForSingleObject(process_handle as HANDLE, 30_000) == WAIT_TIMEOUT {
                timed_out_ref.store(true, Ordering::Release);
                TerminateProcess(process_handle as HANDLE, 2);
            }
        });
        let result = (|| {
            {
                let mut stdin = child.stdin.take().ok_or_else(decode_error)?;
                stdin
                    .write_all(&[format_tag(format)?])
                    .map_err(|_| decode_error())?;
                stdin
                    .write_all(&(bytes.len() as u32).to_le_bytes())
                    .map_err(|_| decode_error())?;
                stdin.write_all(bytes).map_err(|_| decode_error())?;
            }
            let mut stdout = child.stdout.take().ok_or_else(decode_error)?;
            let mut header = [0u8; 17];
            #[cfg(not(test))]
            stdout.read_exact(&mut header).map_err(|_| decode_error())?;
            #[cfg(test)]
            {
                // libtest prints its banner before invoking the isolated fixture.
                let mut window = [0u8; 8];
                for index in 0..1024 {
                    window.rotate_left(1);
                    stdout
                        .read_exact(&mut window[7..])
                        .map_err(|_| decode_error())?;
                    if &window == MAGIC {
                        break;
                    }
                    if index == 1023 {
                        return Err(decode_error());
                    }
                }
                header[..8].copy_from_slice(MAGIC);
                stdout
                    .read_exact(&mut header[8..])
                    .map_err(|_| decode_error())?;
            }
            if &header[..8] != MAGIC || header[16] > 1 {
                return Err(decode_error());
            }
            let width = u32::from_le_bytes(header[8..12].try_into().unwrap());
            let height = u32::from_le_bytes(header[12..16].try_into().unwrap());
            if codec::check_dimensions(width, height)? != pixels {
                return Err(invalid());
            }
            let mut rgba = vec![0; pixels * 4];
            stdout.read_exact(&mut rgba).map_err(|_| decode_error())?;
            if stdout.read(&mut [0u8; 1]).map_err(|_| decode_error())? != 0 {
                return Err(invalid());
            }
            Ok((
                RgbaImage::from_raw(width, height, rgba).ok_or_else(invalid)?,
                header[16] != 0,
            ))
        })();
        if result.is_err() {
            let _ = child.kill();
        }
        let status = child.wait().map_err(|_| decode_error())?;
        watchdog.join().map_err(|_| decode_error())?;
        if !status.success() || timed_out.load(Ordering::Acquire) {
            return Err(decode_error());
        }
        result
    })
}

pub(super) fn run_worker_if_requested() -> bool {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new(ARGUMENT)) {
        return false;
    }
    if args.next().is_some() {
        std::process::exit(2);
    }
    if run_worker().is_err() {
        std::process::exit(2);
    }
    true
}

fn run_worker() -> Result<(), CommandError> {
    let mut stdin = std::io::stdin().lock();
    let mut header = [0u8; 5];
    stdin.read_exact(&mut header).map_err(|_| decode_error())?;
    let format = match header[0] {
        1 => ImageFormat::Png,
        2 => ImageFormat::Jpeg,
        3 => ImageFormat::Gif,
        4 => ImageFormat::WebP,
        _ => return Err(invalid()),
    };
    let size = u32::from_le_bytes(header[1..5].try_into().unwrap()) as usize;
    if size == 0 || size > MAX_ENCODED {
        return Err(oversized());
    }
    let mut encoded = vec![0; size];
    stdin.read_exact(&mut encoded).map_err(|_| decode_error())?;
    if stdin.read(&mut [0u8; 1]).map_err(|_| decode_error())? != 0 {
        return Err(invalid());
    }
    if image::guess_format(&encoded).map_err(|_| invalid())? != format {
        return Err(invalid());
    }
    let (rgba, animated) = codec::decode_local(&encoded, format)?;
    drop(encoded);
    let mut stdout = std::io::stdout().lock();
    stdout.write_all(MAGIC).map_err(|_| decode_error())?;
    stdout
        .write_all(&rgba.width().to_le_bytes())
        .map_err(|_| decode_error())?;
    stdout
        .write_all(&rgba.height().to_le_bytes())
        .map_err(|_| decode_error())?;
    stdout
        .write_all(&[u8::from(animated)])
        .map_err(|_| decode_error())?;
    stdout
        .write_all(rgba.as_raw())
        .map_err(|_| decode_error())?;
    stdout.flush().map_err(|_| decode_error())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn worker_wire_format_is_closed() {
        assert_eq!(format_tag(ImageFormat::Png).unwrap(), 1);
        assert_eq!(format_tag(ImageFormat::WebP).unwrap(), 4);
        assert!(format_tag(ImageFormat::Tiff).is_err());
    }
    #[test]
    fn image_decodes_in_a_real_memory_limited_pipe_only_child() {
        let png =
            codec::encode_png(&RgbaImage::from_pixel(2, 1, image::Rgba([255, 0, 0, 128]))).unwrap();
        let (rgba, animated) = decode_isolated(&png, ImageFormat::Png, 2, 0, 0).unwrap();
        assert!(!animated);
        assert_eq!(rgba.get_pixel(1, 0).0, [255, 0, 0, 128]);
        let mut webp = Vec::new();
        image::codecs::webp::WebPEncoder::new_lossless(&mut webp)
            .encode(&[0, 255, 0, 255], 1, 1, image::ExtendedColorType::Rgba8)
            .unwrap();
        let (rgba, animated) = decode_isolated(&webp, ImageFormat::WebP, 1, 0, 0).unwrap();
        assert!(!animated);
        assert_eq!(rgba.get_pixel(0, 0).0, [0, 255, 0, 255]);
    }
    #[test]
    #[ignore = "Private pipe-only subprocess fixture, invoked by the bounded decoder test"]
    fn codec_child_entry() {
        let result = run_worker();
        std::process::exit(if result.is_ok() { 0 } else { 2 });
    }
}
