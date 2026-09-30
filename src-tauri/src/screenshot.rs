use std::{
    collections::HashMap,
    fs::{self, File},
    io::{BufWriter, Read},
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::Instant,
};

use arboard::Clipboard;
use tauri::State;
use uuid::Uuid;
use windows_sys::Win32::System::DataExchange::{GetClipboardOwner, GetClipboardSequenceNumber};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{keybd_event, KEYEVENTF_KEYUP, VK_ESCAPE};

use crate::error::CommandError;

#[path = "screenshot_observer.rs"]
mod observer;
use observer::CaptureObserver;
#[path = "screenshot_quality.rs"]
mod quality;
use quality::{review_pixels, CaptureReview};

struct CaptureSession {
    sequence: u32,
    observer: CaptureObserver,
}

#[derive(Default)]
pub struct ScreenCaptureSessions {
    sessions: Mutex<HashMap<String, CaptureSession>>,
}

impl ScreenCaptureSessions {
    fn cancel(&self, token: &str, dismiss: impl FnOnce()) -> Result<(), CommandError> {
        // Hold the same lock through dismissal and retirement. An old cancellation
        // must never send Escape after a new system snip has launched.
        let mut sessions = self.sessions.lock().map_err(|_| capture_state_error())?;
        if let Some(session) = sessions.remove(token) {
            let cancellation = session.observer.snapshot()?;
            let needs_dismissal = !cancellation.escaped && !cancellation.dismissed();
            drop(session);
            if needs_dismissal {
                dismiss();
            }
        }
        Ok(())
    }
}

#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ScreenCapturePoll {
    Pending,
    Cancelled,
    Captured {
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        review: Option<CaptureReview>,
    },
}

fn capture_state_error() -> CommandError {
    CommandError::new(
        "screen_capture_state_failed",
        "Unable to access screen capture state",
    )
}

fn clipboard_sequence() -> u32 {
    unsafe { GetClipboardSequenceNumber() }
}

fn dismiss_screen_capture_overlay() {
    unsafe {
        keybd_event(VK_ESCAPE as u8, 0, 0, 0);
        keybd_event(VK_ESCAPE as u8, 0, KEYEVENTF_KEYUP, 0);
    }
}

fn capture_temp_path(token: &str) -> PathBuf {
    std::env::temp_dir().join(format!("preshot-capture-{token}.png"))
}

fn write_capture_png(
    path: &Path,
    width: u32,
    height: u32,
    rgba: &[u8],
) -> Result<(), CommandError> {
    if width == 0
        || height == 0
        || (width as usize)
            .checked_mul(height as usize)
            .and_then(|n| n.checked_mul(4))
            != Some(rgba.len())
    {
        return Err(CommandError::new(
            "screen_capture_invalid_image",
            "The captured image has invalid RGBA data",
        ));
    }
    let file = File::create(path).map_err(|error| {
        CommandError::new(
            "screen_capture_write_failed",
            format!("Unable to create the captured PNG: {error}"),
        )
    })?;
    let mut encoder = png::Encoder::new(BufWriter::new(file), width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().map_err(|error| {
        CommandError::new(
            "screen_capture_write_failed",
            format!("Unable to initialize the captured PNG: {error}"),
        )
    })?;
    writer.write_image_data(rgba).map_err(|error| {
        CommandError::new(
            "screen_capture_write_failed",
            format!("Unable to write the captured PNG: {error}"),
        )
    })
}

#[tauri::command]
pub fn start_screen_capture(
    sessions: State<'_, ScreenCaptureSessions>,
) -> Result<String, CommandError> {
    let mut active = sessions
        .sessions
        .lock()
        .map_err(|_| capture_state_error())?;
    if !active.is_empty() {
        return Err(CommandError::new(
            "screen_capture_busy",
            "Finish or cancel the current screen capture before starting another",
        ));
    }
    let token = Uuid::new_v4().to_string();
    // Register before launching, so even a quick Escape is observed between polls.
    let observer = CaptureObserver::start()?;
    active.insert(
        token.clone(),
        CaptureSession {
            sequence: clipboard_sequence(),
            observer,
        },
    );
    if let Err(error) = Command::new("explorer").arg("ms-screenclip:").spawn() {
        active.remove(&token);
        return Err(CommandError::new(
            "screen_capture_start_failed",
            format!("Unable to open Windows screen capture: {error}"),
        ));
    }
    Ok(token)
}

fn poll_capture(
    sessions: &ScreenCaptureSessions,
    token: &str,
    read_image: impl FnOnce(u32) -> Result<Option<String>, CommandError>,
) -> Result<ScreenCapturePoll, CommandError> {
    let mut active = sessions
        .sessions
        .lock()
        .map_err(|_| capture_state_error())?;
    let session = active.get(token).ok_or_else(|| {
        CommandError::new(
            "screen_capture_unknown",
            "The screen capture session is no longer active",
        )
    })?;
    let cancellation = session.observer.snapshot()?;
    let result = if cancellation.escaped {
        ScreenCapturePoll::Cancelled
    } else if let Some(path) = read_image(session.sequence)? {
        if session.observer.snapshot()?.escaped {
            discard_screen_capture(path)?;
            ScreenCapturePoll::Cancelled
        } else {
            ScreenCapturePoll::Captured { path, review: None }
        }
    } else if cancellation.cancellation_due(Instant::now()) {
        ScreenCapturePoll::Cancelled
    } else {
        ScreenCapturePoll::Pending
    };
    if result != ScreenCapturePoll::Pending {
        active.remove(token);
    }
    Ok(result)
}

#[tauri::command]
pub fn poll_screen_capture(
    token: String,
    sessions: State<'_, ScreenCaptureSessions>,
) -> Result<ScreenCapturePoll, CommandError> {
    let mut review = None;
    let result = poll_capture(&sessions, &token, |previous_sequence| {
        let before = clipboard_sequence();
        let owner = unsafe { GetClipboardOwner() };
        if before == previous_sequence {
            return Ok(None);
        }
        let mut clipboard = Clipboard::new().map_err(|error| {
            CommandError::new(
                "screen_capture_clipboard_failed",
                format!("Unable to open the clipboard: {error}"),
            )
        })?;
        let image = match clipboard.get_image() {
            Ok(image) => image,
            Err(_) => return Ok(None),
        };
        // Delayed format publication or a competing copy must not mix versions.
        if !current_capture(
            previous_sequence,
            before,
            clipboard_sequence(),
            owner == unsafe { GetClipboardOwner() },
        ) {
            return Ok(None);
        }
        let width = u32::try_from(image.width).map_err(|_| capture_state_error())?;
        let height = u32::try_from(image.height).map_err(|_| capture_state_error())?;
        review = review_pixels(width, height, image.bytes.as_ref())?;
        let path = capture_temp_path(&token);
        if let Err(error) = write_capture_png(&path, width, height, image.bytes.as_ref()) {
            let _ = fs::remove_file(&path);
            return Err(error);
        }
        Ok(Some(path.to_string_lossy().into_owned()))
    })?;
    Ok(match result {
        ScreenCapturePoll::Captured { path, .. } => ScreenCapturePoll::Captured { path, review },
        other => other,
    })
}

fn current_capture(previous: u32, before: u32, after: u32, same_owner: bool) -> bool {
    before != previous && before == after && same_owner
}

#[tauri::command]
pub fn cancel_screen_capture(
    token: String,
    sessions: State<'_, ScreenCaptureSessions>,
) -> Result<(), CommandError> {
    sessions.cancel(&token, dismiss_screen_capture_overlay)
}

fn is_owned_capture_path(path: &Path) -> bool {
    let temp_dir = std::env::temp_dir();
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    path.parent() == Some(temp_dir.as_path())
        && file_name.starts_with("preshot-capture-")
        && file_name.ends_with(".png")
}

#[tauri::command]
pub fn import_screen_capture_media(
    project_path: String,
    path: String,
) -> Result<crate::plan::ImportedPlanMedia, CommandError> {
    let path = PathBuf::from(path);
    let valid_token = path
        .file_stem()
        .and_then(|name| name.to_str())
        .and_then(|name| name.strip_prefix("preshot-capture-"))
        .is_some_and(|token| Uuid::parse_str(token).is_ok());
    if !is_owned_capture_path(&path) || !valid_token {
        return Err(CommandError::new(
            "screen_capture_invalid_path",
            "Only Preshot capture PNGs can be imported",
        ));
    }
    let read_error = |error: std::io::Error| {
        CommandError::new(
            "screen_capture_read_failed",
            format!("Unable to read the captured PNG: {error}"),
        )
    };
    let canonical = path.canonicalize().map_err(read_error)?;
    let temp = std::env::temp_dir().canonicalize().map_err(read_error)?;
    if canonical.parent() != Some(temp.as_path()) || canonical.file_name() != path.file_name() {
        return Err(CommandError::new(
            "screen_capture_invalid_path",
            "The capture must remain in Preshot temporary storage",
        ));
    }
    const MAX_BYTES: u64 = 16 * 1024 * 1024;
    let mut bytes = Vec::new();
    File::open(&canonical)
        .map_err(read_error)?
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(read_error)?;
    if bytes.len() as u64 > MAX_BYTES || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(CommandError::new(
            "screen_capture_invalid_image",
            "The capture must be a PNG no larger than 16 MiB",
        ));
    }
    crate::plan::import_plan_media_into(Path::new(&project_path), "截图.png", "image/png", &bytes)
}

#[tauri::command]
pub fn discard_screen_capture(path: String) -> Result<(), CommandError> {
    let path = PathBuf::from(path);
    if !is_owned_capture_path(&path) {
        return Err(CommandError::new(
            "screen_capture_invalid_path",
            "Only Preshot screen capture temporary files can be discarded",
        ));
    }
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(CommandError::new(
            "screen_capture_discard_failed",
            format!("Unable to remove the captured PNG: {error}"),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_session(sessions: &ScreenCaptureSessions, token: &str, escaped: bool) {
        sessions.sessions.lock().unwrap().insert(
            token.to_owned(),
            CaptureSession {
                sequence: 7,
                observer: CaptureObserver::fixture(escaped),
            },
        );
    }

    #[test]
    fn system_cancellation_retires_token_without_reading_clipboard_and_allows_next_capture() {
        let sessions = ScreenCaptureSessions::default();
        fixture_session(&sessions, "first", true);
        assert_eq!(
            poll_capture(&sessions, "first", |_| panic!(
                "Cancelled snip must not read clipboard"
            ))
            .unwrap(),
            ScreenCapturePoll::Cancelled
        );
        fixture_session(&sessions, "second", false);
        sessions
            .cancel("first", || panic!("Old cancellation must not send Escape"))
            .unwrap();
        assert_eq!(
            poll_capture(&sessions, "second", |sequence| {
                assert_eq!(sequence, 7);
                Ok(Some("second.png".into()))
            })
            .unwrap(),
            ScreenCapturePoll::Captured {
                path: "second.png".into(),
                review: None,
            }
        );
        assert!(sessions.sessions.lock().unwrap().is_empty());
    }

    #[test]
    fn explicit_cancellation_dismisses_once_and_preserves_other_sessions() {
        let sessions = ScreenCaptureSessions::default();
        fixture_session(&sessions, "token", false);
        let mut dismissed = 0;
        sessions.cancel("token", || dismissed += 1).unwrap();
        sessions
            .cancel("token", || {
                panic!("Duplicate cancellation must not send Escape")
            })
            .unwrap();
        assert_eq!(dismissed, 1);
        assert_eq!(
            poll_capture(&sessions, "token", |_| Ok(None))
                .unwrap_err()
                .code,
            "screen_capture_unknown"
        );
    }

    #[test]
    fn closing_overlay_returns_cancelled_but_an_available_bitmap_wins_the_close_race() {
        let sessions = ScreenCaptureSessions::default();
        for image in [None, Some("ready.png".to_owned())] {
            sessions.sessions.lock().unwrap().insert(
                "token".into(),
                CaptureSession {
                    sequence: 7,
                    observer: CaptureObserver::dismissed_fixture(),
                },
            );
            let expected = image.clone().map_or(ScreenCapturePoll::Cancelled, |path| {
                ScreenCapturePoll::Captured { path, review: None }
            });
            assert_eq!(
                poll_capture(&sessions, "token", |_| Ok(image)).unwrap(),
                expected
            );
            sessions
                .cancel("token", || panic!("Terminal polls must not send Escape"))
                .unwrap();
            assert!(sessions.sessions.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn writes_rgba_pixels_as_png() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("capture.png");
        let pixels = [255, 0, 0, 255, 0, 0, 0, 255, 20, 40, 80, 0, 0, 255, 0, 128];
        write_capture_png(&path, 2, 2, &pixels).unwrap();
        let bytes = std::fs::read(path).unwrap();
        let mut reader = png::Decoder::new(std::io::Cursor::new(bytes))
            .read_info()
            .unwrap();
        let mut output = vec![0; reader.output_buffer_size()];
        let info = reader.next_frame(&mut output).unwrap();
        assert_eq!((info.width, info.height), (2, 2));
        assert_eq!(&output[..info.buffer_size()], &pixels);
    }

    #[test]
    fn ignores_unchanged_and_unstable_clipboard_candidates() {
        assert!(current_capture(1, 2, 2, true));
        assert!(!current_capture(1, 1, 1, true));
        assert!(!current_capture(1, 2, 3, true));
        assert!(!current_capture(1, 2, 2, false));
    }

    #[test]
    fn rejects_invalid_rgba_length() {
        let directory = tempfile::tempdir().unwrap();
        let error =
            write_capture_png(&directory.path().join("bad.png"), 2, 2, &[0; 4]).unwrap_err();
        assert_eq!(error.code, "screen_capture_invalid_image");
    }

    #[test]
    fn imports_capture_as_independent_persistent_media() {
        let parent = tempfile::tempdir().unwrap();
        crate::workspace::create_project_in(parent.path(), "Shoot").unwrap();
        let project = parent.path().join("Shoot");
        let capture = capture_temp_path(&Uuid::new_v4().to_string());
        write_capture_png(&capture, 1, 1, &[255, 0, 0, 255]).unwrap();
        let first = import_screen_capture_media(
            project.to_string_lossy().into_owned(),
            capture.to_string_lossy().into_owned(),
        )
        .unwrap();
        let second = import_screen_capture_media(
            project.to_string_lossy().into_owned(),
            capture.to_string_lossy().into_owned(),
        )
        .unwrap();
        assert_ne!(first.file, second.file);
        assert!(first.file.starts_with("media/"));
        assert!(capture.exists());
        discard_screen_capture(capture.to_string_lossy().into_owned()).unwrap();
        assert_eq!(
            crate::plan::load_plan_media_from(&project, &first.file).unwrap(),
            first.data_url
        );
        assert!(project.join(second.file).exists());
    }

    #[test]
    fn capture_media_rejects_unowned_invalid_and_oversized_inputs() {
        let parent = tempfile::tempdir().unwrap();
        let unrelated = parent.path().join("unrelated.png");
        fs::write(&unrelated, b"untouched").unwrap();
        assert_eq!(
            import_screen_capture_media(String::new(), unrelated.to_string_lossy().into_owned())
                .unwrap_err()
                .code,
            "screen_capture_invalid_path"
        );
        assert_eq!(fs::read(&unrelated).unwrap(), b"untouched");
        let capture = capture_temp_path(&Uuid::new_v4().to_string());
        fs::write(&capture, b"not a PNG").unwrap();
        assert_eq!(
            import_screen_capture_media(String::new(), capture.to_string_lossy().into_owned())
                .unwrap_err()
                .code,
            "screen_capture_invalid_image"
        );
        File::create(&capture)
            .unwrap()
            .set_len(16 * 1024 * 1024 + 1)
            .unwrap();
        assert_eq!(
            import_screen_capture_media(String::new(), capture.to_string_lossy().into_owned())
                .unwrap_err()
                .code,
            "screen_capture_invalid_image"
        );
        discard_screen_capture(capture.to_string_lossy().into_owned()).unwrap();
    }

    #[test]
    fn discards_only_owned_capture_files() {
        let path = capture_temp_path("discard-test");
        std::fs::write(&path, b"capture").unwrap();
        discard_screen_capture(path.to_string_lossy().into_owned()).unwrap();
        assert!(!path.exists());

        let error = discard_screen_capture(
            std::env::temp_dir()
                .join("unrelated.png")
                .to_string_lossy()
                .into_owned(),
        )
        .unwrap_err();
        assert_eq!(error.code, "screen_capture_invalid_path");
    }
}
