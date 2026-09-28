//! Observe only Escape and the foreground lifetime of a user-requested system snip.
//! Hooks are installed before launching the overlay and removed when the session ends.
use crate::error::CommandError;
use std::{
    cell::RefCell,
    path::Path,
    ptr::null_mut,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HWND, LPARAM, LRESULT, WPARAM},
    System::{
        LibraryLoader::GetModuleHandleW,
        Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION},
    },
    UI::{
        Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK},
        Input::KeyboardAndMouse::VK_ESCAPE,
        WindowsAndMessaging::{
            CallNextHookEx, DispatchMessageW, GetWindowThreadProcessId, PeekMessageW,
            SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx, EVENT_SYSTEM_FOREGROUND,
            HC_ACTION, KBDLLHOOKSTRUCT, MSG, PM_REMOVE, WH_KEYBOARD_LL, WINEVENT_OUTOFCONTEXT,
            WM_KEYDOWN, WM_SYSKEYDOWN,
        },
    },
};

#[derive(Clone, Default)]
pub(super) struct CaptureCancellation {
    pub escaped: bool,
    saw_overlay: bool,
    dismissed_at: Option<Instant>,
}

impl CaptureCancellation {
    fn foreground(&mut self, is_overlay: bool, now: Instant) {
        if is_overlay {
            self.saw_overlay = true;
            self.dismissed_at = None;
        } else if self.saw_overlay {
            self.dismissed_at.get_or_insert(now);
        }
    }

    pub fn dismissed(&self) -> bool {
        self.dismissed_at.is_some()
    }

    pub fn cancellation_due(&self, now: Instant) -> bool {
        // A successful snip may close its overlay before publishing the bitmap.
        // The caller checks for that bitmap before applying this short grace period.
        self.escaped
            || self
                .dismissed_at
                .is_some_and(|ended| now.duration_since(ended) >= Duration::from_millis(500))
    }
}

type SharedState = Arc<Mutex<CaptureCancellation>>;
thread_local! {
    static OBSERVER: RefCell<Option<(SharedState, Arc<AtomicBool>)>> = const { RefCell::new(None) };
}

fn update(action: impl FnOnce(&mut CaptureCancellation)) {
    OBSERVER.with(|slot| {
        if let Some((state, stopped)) = slot.borrow().as_ref() {
            if !stopped.load(Ordering::Acquire) {
                if let Ok(mut state) = state.lock() {
                    action(&mut state);
                }
            }
        }
    });
}

unsafe extern "system" fn keyboard_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32
        && (wparam == WM_KEYDOWN as usize || wparam == WM_SYSKEYDOWN as usize)
    {
        let key = &*(lparam as *const KBDLLHOOKSTRUCT);
        if key.vkCode == VK_ESCAPE as u32 {
            update(|state| state.escaped = true);
        }
    }
    // Observe only; never consume, retain or log keyboard input.
    CallNextHookEx(null_mut(), code, wparam, lparam)
}

fn is_capture_window(hwnd: HWND) -> bool {
    unsafe {
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return false;
        }
        let mut path = [0u16; 1024];
        let mut len = path.len() as u32;
        let read = QueryFullProcessImageNameW(process, 0, path.as_mut_ptr(), &mut len);
        CloseHandle(process);
        if read == 0 {
            return false;
        }
        let path = String::from_utf16_lossy(&path[..len as usize]);
        let name = Path::new(&path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("");
        [
            "ScreenClippingHost.exe",
            "SnippingTool.exe",
            "ScreenSketch.exe",
        ]
        .iter()
        .any(|candidate| name.eq_ignore_ascii_case(candidate))
    }
}

unsafe extern "system" fn foreground_hook(
    _: HWINEVENTHOOK,
    _: u32,
    hwnd: HWND,
    _: i32,
    _: i32,
    _: u32,
    _: u32,
) {
    if hwnd.is_null() {
        return;
    }
    let is_overlay = is_capture_window(hwnd);
    update(|state| state.foreground(is_overlay, Instant::now()));
}

pub(super) struct CaptureObserver {
    state: SharedState,
    stopped: Arc<AtomicBool>,
}

impl CaptureObserver {
    pub fn start() -> Result<Self, CommandError> {
        let observer = Self {
            state: Arc::default(),
            stopped: Arc::default(),
        };
        let state = observer.state.clone();
        let stopped = observer.stopped.clone();
        let (ready, started) = mpsc::sync_channel(1);
        thread::Builder::new()
            .name("preshot-snip-cancel".into())
            .spawn(move || unsafe {
                OBSERVER.with(|slot| *slot.borrow_mut() = Some((state, stopped.clone())));
                let keyboard = SetWindowsHookExW(
                    WH_KEYBOARD_LL,
                    Some(keyboard_hook),
                    GetModuleHandleW(null_mut()),
                    0,
                );
                let foreground = SetWinEventHook(
                    EVENT_SYSTEM_FOREGROUND,
                    EVENT_SYSTEM_FOREGROUND,
                    null_mut(),
                    Some(foreground_hook),
                    0,
                    0,
                    WINEVENT_OUTOFCONTEXT,
                );
                let installed = !keyboard.is_null() && !foreground.is_null();
                let _ = ready.send(installed);
                if installed {
                    let started_at = Instant::now();
                    let mut message: MSG = std::mem::zeroed();
                    while !stopped.load(Ordering::Acquire)
                        && started_at.elapsed() < Duration::from_secs(95)
                    {
                        while PeekMessageW(&mut message, null_mut(), 0, 0, PM_REMOVE) != 0 {
                            TranslateMessage(&message);
                            DispatchMessageW(&message);
                        }
                        thread::sleep(Duration::from_millis(10));
                    }
                }
                if !keyboard.is_null() {
                    UnhookWindowsHookEx(keyboard);
                }
                if !foreground.is_null() {
                    UnhookWinEvent(foreground);
                }
                OBSERVER.with(|slot| *slot.borrow_mut() = None);
            })
            .map_err(|error| observer_error(error.to_string()))?;
        if started
            .recv_timeout(Duration::from_secs(5))
            .unwrap_or(false)
        {
            Ok(observer)
        } else {
            Err(observer_error(
                "Unable to observe system screenshot cancellation",
            ))
        }
    }

    pub fn snapshot(&self) -> Result<CaptureCancellation, CommandError> {
        self.state
            .lock()
            .map(|state| state.clone())
            .map_err(|_| observer_error("Unable to read screenshot cancellation state"))
    }

    #[cfg(test)]
    pub fn fixture(escaped: bool) -> Self {
        Self {
            state: Arc::new(Mutex::new(CaptureCancellation {
                escaped,
                ..Default::default()
            })),
            stopped: Arc::default(),
        }
    }

    #[cfg(test)]
    pub fn dismissed_fixture() -> Self {
        let observer = Self::fixture(false);
        let ended = Instant::now() - Duration::from_secs(1);
        {
            let mut state = observer.state.lock().unwrap();
            state.foreground(true, ended);
            state.foreground(false, ended);
        }
        observer
    }
}

impl Drop for CaptureObserver {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Release);
    }
}

fn observer_error(message: impl Into<String>) -> CommandError {
    CommandError::new("screen_capture_observer_failed", message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escape_is_terminal_even_before_overlay_activation() {
        let mut state = CaptureCancellation {
            escaped: true,
            ..Default::default()
        };
        state.foreground(true, Instant::now());
        assert!(state.cancellation_due(Instant::now()));
    }

    #[test]
    fn overlay_dismissal_waits_for_bitmap_publication_without_cancelling_startup() {
        let start = Instant::now();
        let mut state = CaptureCancellation::default();
        state.foreground(false, start);
        assert!(!state.cancellation_due(start + Duration::from_secs(10)));
        state.foreground(true, start);
        state.foreground(false, start);
        assert!(!state.cancellation_due(start + Duration::from_millis(499)));
        assert!(state.cancellation_due(start + Duration::from_millis(500)));
        state.foreground(true, start + Duration::from_millis(200));
        assert!(!state.cancellation_due(start + Duration::from_secs(1)));
    }

    #[test]
    fn retiring_an_observer_stops_callbacks_and_next_capture_starts_clean() {
        let observer = CaptureObserver::fixture(true);
        let stopped = observer.stopped.clone();
        drop(observer);
        assert!(stopped.load(Ordering::Acquire));
        assert!(!CaptureObserver::fixture(false).snapshot().unwrap().escaped);
    }
}
