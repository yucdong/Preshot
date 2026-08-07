use std::{
    collections::HashMap,
    fs::File,
    io::BufWriter,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};

use arboard::Clipboard;
use tauri::State;
use uuid::Uuid;
use windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    keybd_event, KEYEVENTF_KEYUP, VK_ESCAPE,
};

use crate::error::CommandError;

#[derive(Default)]
pub struct ScreenCaptureSessions {
    sequences: Mutex<HashMap<String, u32>>,
}

impl ScreenCaptureSessions {
    fn insert(&self, token: String, sequence: u32) -> Result<(), CommandError> {
        self.sequences
            .lock()
            .map_err(|_| capture_state_error())?
            .insert(token, sequence);
        Ok(())
    }

    fn sequence(&self, token: &str) -> Result<u32, CommandError> {
        self.sequences
            .lock()
            .map_err(|_| capture_state_error())?
            .get(token)
            .copied()
            .ok_or_else(|| {
                CommandError::new(
                    "screen_capture_unknown",
                    "The screen capture session is no longer active",
                )
            })
    }

    fn remove(&self, token: &str) -> Result<(), CommandError> {
        self.sequences
            .lock()
            .map_err(|_| capture_state_error())?
            .remove(token);
        Ok(())
    }
}

#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ScreenCapturePoll {
    Pending,
    Captured { path: String },
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
    if rgba.len() != width as usize * height as usize * 4 {
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
    let token = Uuid::new_v4().to_string();
    sessions.insert(token.clone(), clipboard_sequence())?;
    if let Err(error) = Command::new("explorer").arg("ms-screenclip:").spawn() {
        sessions.remove(&token)?;
        return Err(CommandError::new(
            "screen_capture_start_failed",
            format!("Unable to open Windows screen capture: {error}"),
        ));
    }
    Ok(token)
}

#[tauri::command]
pub fn poll_screen_capture(
    token: String,
    sessions: State<'_, ScreenCaptureSessions>,
) -> Result<ScreenCapturePoll, CommandError> {
    let previous_sequence = sessions.sequence(&token)?;
    let current_sequence = clipboard_sequence();
    if current_sequence == previous_sequence {
        return Ok(ScreenCapturePoll::Pending);
    }
    let mut clipboard = Clipboard::new().map_err(|error| {
        CommandError::new(
            "screen_capture_clipboard_failed",
            format!("Unable to open the clipboard: {error}"),
        )
    })?;
    let image = match clipboard.get_image() {
        Ok(image) => image,
        Err(_) => return Ok(ScreenCapturePoll::Pending),
    };
    let path = capture_temp_path(&token);
    write_capture_png(
        &path,
        image.width as u32,
        image.height as u32,
        image.bytes.as_ref(),
    )?;
    sessions.remove(&token)?;
    Ok(ScreenCapturePoll::Captured {
        path: path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn cancel_screen_capture(
    token: String,
    sessions: State<'_, ScreenCaptureSessions>,
) -> Result<(), CommandError> {
    sessions.remove(&token)?;
    dismiss_screen_capture_overlay();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracks_and_cancels_capture_sessions() {
        let sessions = ScreenCaptureSessions::default();
        sessions.insert("token".to_string(), 7).unwrap();
        assert_eq!(sessions.sequence("token").unwrap(), 7);
        sessions.remove("token").unwrap();
        assert_eq!(
            sessions.sequence("token").unwrap_err().code,
            "screen_capture_unknown"
        );
    }

    #[test]
    fn writes_rgba_pixels_as_png() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("capture.png");
        write_capture_png(&path, 1, 1, &[255, 0, 0, 255]).unwrap();
        let bytes = std::fs::read(path).unwrap();
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
    }

    #[test]
    fn rejects_invalid_rgba_length() {
        let directory = tempfile::tempdir().unwrap();
        let error =
            write_capture_png(&directory.path().join("bad.png"), 2, 2, &[0; 4])
                .unwrap_err();
        assert_eq!(error.code, "screen_capture_invalid_image");
    }
}
