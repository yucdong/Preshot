use super::*;
use std::{
    ptr::{null, null_mut},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc,
    },
    time::Duration,
};
use windows_sys::Win32::{
    Foundation::{GlobalFree, HANDLE, HWND, LPARAM, LRESULT, WPARAM},
    System::{
        DataExchange::{
            AddClipboardFormatListener, CloseClipboard, EmptyClipboard, GetClipboardData,
            GetClipboardOwner, GetClipboardSequenceNumber, IsClipboardFormatAvailable,
            OpenClipboard, RegisterClipboardFormatW, RemoveClipboardFormatListener,
            SetClipboardData,
        },
        LibraryLoader::GetModuleHandleW,
        Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT},
    },
    UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
        GetWindowLongPtrW, PostMessageW, PostQuitMessage, RegisterClassW, SetWindowLongPtrW,
        TranslateMessage, UnregisterClassW, CREATESTRUCTW, GWLP_USERDATA, HWND_MESSAGE, MSG,
        WM_CLOSE, WM_DESTROY, WM_DESTROYCLIPBOARD, WM_NCCREATE, WNDCLASSW,
    },
};

const CF_DIB: u32 = 8;
const CF_DIBV5: u32 = 17;
const RETRY_DELAYS_MS: [u64; 5] = [5, 10, 20, 40, 80];

struct Job {
    request: Request,
    reply: mpsc::SyncSender<Result<Response, CommandError>>,
}

pub(super) struct Worker {
    hwnd: usize,
    jobs: mpsc::SyncSender<Job>,
    busy: AtomicBool,
}

impl Worker {
    pub fn start() -> Result<Self, CommandError> {
        let (jobs, receiver) = mpsc::sync_channel::<Job>(1);
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let generation = Arc::new(AtomicU64::new(1));
        let owner_generation = generation.clone();
        std::thread::Builder::new()
            .name("preshot-clipboard-owner".into())
            .spawn(move || {
                let window = match OwnerWindow::create(owner_generation) {
                    Ok(window) => window,
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                        return;
                    }
                };
                if ready_tx.send(Ok(window.hwnd as usize)).is_err() {
                    return;
                }
                let mut message: MSG = unsafe { std::mem::zeroed() };
                loop {
                    let status = unsafe { GetMessageW(&mut message, null_mut(), 0, 0) };
                    if status <= 0 {
                        break;
                    }
                    unsafe {
                        TranslateMessage(&message);
                        DispatchMessageW(&message);
                    }
                }
            })
            .map_err(|_| error("worker", "无法启动图片剪贴板服务，请重新启动应用。"))?;
        let hwnd = ready_rx
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| error("worker", "图片剪贴板服务启动超时，请重新启动应用。"))??;
        if std::thread::Builder::new()
            .name("preshot-image-clipboard".into())
            .spawn(move || {
                let mut engine = Engine::default();
                let mut backend = WindowsClipboard::new(hwnd as HWND, generation);
                loop {
                    match receiver.recv_timeout(Duration::from_millis(200)) {
                        Ok(job) => {
                            let result = match &mut backend {
                                Ok(backend) => engine.execute(backend, job.request),
                                Err(error) => Err(error.clone()),
                            };
                            let _ = job.reply.send(result);
                        }
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    }
                    if let Ok(backend) = &backend {
                        engine.reconcile(backend.identity());
                    }
                }
            })
            .is_err()
        {
            unsafe {
                PostMessageW(hwnd as HWND, WM_CLOSE, 0, 0);
            }
            return Err(error(
                "worker",
                "无法启动图片剪贴板处理线程，请重新启动应用。",
            ));
        }
        Ok(Self {
            hwnd,
            jobs,
            busy: AtomicBool::new(false),
        })
    }

    pub fn execute(&self, request: Request) -> Result<Response, CommandError> {
        if self
            .busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(error("busy", "正在处理图片剪贴板，请稍候再试。"));
        }
        struct Busy<'a>(&'a AtomicBool);
        impl Drop for Busy<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::Release);
            }
        }
        let _busy = Busy(&self.busy);
        let (reply, receive) = mpsc::sync_channel(1);
        self.jobs
            .try_send(Job { request, reply })
            .map_err(|_| error("worker", "图片剪贴板服务不可用，请重新启动应用。"))?;
        receive
            .recv()
            .map_err(|_| error("worker", "图片剪贴板服务已停止，请重新启动应用。"))?
    }
}
impl Drop for Worker {
    fn drop(&mut self) {
        unsafe {
            PostMessageW(self.hwnd as HWND, WM_CLOSE, 0, 0);
        }
    }
}

struct OwnerWindow {
    hwnd: HWND,
    class: Vec<u16>,
    generation: Arc<AtomicU64>,
}
impl OwnerWindow {
    fn create(generation: Arc<AtomicU64>) -> Result<Self, CommandError> {
        let class = wide(&format!("Preshot.Image.Owner.{}", Uuid::new_v4()));
        unsafe {
            let instance = GetModuleHandleW(null());
            let descriptor = WNDCLASSW {
                lpfnWndProc: Some(owner_proc),
                hInstance: instance,
                lpszClassName: class.as_ptr(),
                ..std::mem::zeroed()
            };
            if RegisterClassW(&descriptor) == 0 {
                return Err(error("window", "无法创建系统剪贴板窗口，请重新启动应用。"));
            }
            let hwnd = CreateWindowExW(
                0,
                class.as_ptr(),
                class.as_ptr(),
                0,
                0,
                0,
                0,
                0,
                HWND_MESSAGE,
                null_mut(),
                instance,
                Arc::as_ptr(&generation).cast(),
            );
            if hwnd.is_null() {
                UnregisterClassW(class.as_ptr(), instance);
                return Err(error("window", "无法创建系统剪贴板窗口，请重新启动应用。"));
            }
            if AddClipboardFormatListener(hwnd) == 0 {
                DestroyWindow(hwnd);
                UnregisterClassW(class.as_ptr(), instance);
                return Err(error(
                    "listener",
                    "无法监测系统剪贴板变化，请重新启动应用。",
                ));
            }
            Ok(Self {
                hwnd,
                class,
                generation,
            })
        }
    }
}
impl Drop for OwnerWindow {
    fn drop(&mut self) {
        unsafe {
            RemoveClipboardFormatListener(self.hwnd);
            DestroyWindow(self.hwnd);
            UnregisterClassW(self.class.as_ptr(), GetModuleHandleW(null()));
        }
        // Keep the WM_DESTROYCLIPBOARD generation alive through window destruction.
        let _ = &self.generation;
    }
}
unsafe extern "system" fn owner_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        WM_NCCREATE => {
            let create = &*(lparam as *const CREATESTRUCTW);
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, create.lpCreateParams as isize);
        }
        WM_DESTROYCLIPBOARD => {
            let generation = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *const AtomicU64;
            if let Some(generation) = generation.as_ref() {
                generation.fetch_add(1, Ordering::AcqRel);
            }
            return 0;
        }
        WM_CLOSE => {
            DestroyWindow(hwnd);
            return 0;
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            return 0;
        }
        _ => {}
    }
    DefWindowProcW(hwnd, message, wparam, lparam)
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}

fn bounded_open(
    mut attempt: impl FnMut() -> bool,
    mut sleep: impl FnMut(Duration),
) -> Result<(), CommandError> {
    if attempt() {
        return Ok(());
    }
    for milliseconds in RETRY_DELAYS_MS {
        sleep(Duration::from_millis(milliseconds));
        if attempt() {
            return Ok(());
        }
    }
    Err(error(
        "locked",
        "剪贴板正被其他应用占用，请关闭占用程序或稍后重试。",
    ))
}

struct Open;
impl Open {
    fn new(hwnd: HWND) -> Result<Self, CommandError> {
        bounded_open(|| unsafe { OpenClipboard(hwnd) != 0 }, std::thread::sleep)?;
        Ok(Self)
    }
    fn close(self) -> Result<(), CommandError> {
        let result = unsafe { CloseClipboard() };
        std::mem::forget(self);
        if result == 0 {
            Err(error("close", "无法完成系统剪贴板操作，请重新复制。"))
        } else {
            Ok(())
        }
    }
}
impl Drop for Open {
    fn drop(&mut self) {
        unsafe {
            CloseClipboard();
        }
    }
}

struct Allocation(HANDLE);
impl Allocation {
    fn new(bytes: &[u8]) -> Result<Self, CommandError> {
        unsafe {
            let handle = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, bytes.len());
            if handle.is_null() {
                return Err(oversized());
            }
            let allocation = Self(handle);
            let pointer = GlobalLock(handle);
            if pointer.is_null() {
                return Err(error(
                    "memory",
                    "无法分配系统剪贴板内存，请关闭其他应用后重试。",
                ));
            }
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), pointer.cast(), bytes.len());
            GlobalUnlock(handle);
            Ok(allocation)
        }
    }
    fn transfer(mut self, format: u32) -> Result<(), CommandError> {
        if unsafe { SetClipboardData(format, self.0) }.is_null() {
            return Err(error(
                "publish",
                "图片复制未完成，系统剪贴板可能已改变，请重新复制。",
            ));
        }
        // Non-null HGLOBAL transfers ownership to Windows, including after process exit.
        self.0 = null_mut();
        Ok(())
    }
}
impl Drop for Allocation {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                GlobalFree(self.0);
            }
        }
    }
}

struct Locked {
    handle: HANDLE,
    pointer: *const u8,
    length: usize,
}
impl Locked {
    fn get(format: u32, maximum: usize) -> Result<Self, CommandError> {
        unsafe {
            let handle = GetClipboardData(format);
            if handle.is_null() {
                return Err(error("read", "无法读取剪贴板图片，请在原应用中重新复制。"));
            }
            let length = GlobalSize(handle);
            if length == 0 {
                return Err(invalid());
            }
            if length > maximum {
                return Err(oversized());
            }
            let pointer = GlobalLock(handle) as *const u8;
            if pointer.is_null() {
                return Err(error("read", "无法锁定剪贴板图片，请稍后重试。"));
            }
            Ok(Self {
                handle,
                pointer,
                length,
            })
        }
    }
    fn bytes(&self) -> &[u8] {
        unsafe { std::slice::from_raw_parts(self.pointer, self.length) }
    }
}
impl Drop for Locked {
    fn drop(&mut self) {
        unsafe {
            GlobalUnlock(self.handle);
        }
    }
}

struct WindowsClipboard {
    hwnd: HWND,
    generation: Arc<AtomicU64>,
    png: u32,
    private: u32,
}
impl WindowsClipboard {
    fn new(hwnd: HWND, generation: Arc<AtomicU64>) -> Result<Self, CommandError> {
        let png = unsafe { RegisterClipboardFormatW(wide("PNG").as_ptr()) };
        let private = unsafe { RegisterClipboardFormatW(wide("Preshot.Image.v1").as_ptr()) };
        if png == 0 || private == 0 {
            return Err(error("format", "无法注册图片剪贴板格式，请重新启动应用。"));
        }
        Ok(Self {
            hwnd,
            generation,
            png,
            private,
        })
    }
    fn available(format: u32) -> bool {
        unsafe { IsClipboardFormatAvailable(format) != 0 }
    }
}

impl ClipboardBackend for WindowsClipboard {
    fn identity(&self) -> Result<(u32, u64), CommandError> {
        let sequence = unsafe { GetClipboardSequenceNumber() };
        if sequence == 0 {
            Err(error("access", "无法访问系统剪贴板状态，请重试。"))
        } else {
            Ok((sequence, self.generation.load(Ordering::Acquire)))
        }
    }
    fn publish(
        &mut self,
        packet: &[u8],
        png: &[u8],
        dib: &[u8],
    ) -> Result<(u32, u64), CommandError> {
        let png_memory = Allocation::new(png)?;
        let dib_memory = Allocation::new(dib)?;
        let private_memory = Allocation::new(packet)?;
        let open = Open::new(self.hwnd)?;
        if unsafe { EmptyClipboard() } == 0 {
            return Err(error("empty", "无法写入系统剪贴板，请稍后重试。"));
        }
        // Exactly one Open/Empty/Close interval, no delayed rendering or convenience setters.
        png_memory.transfer(self.png)?;
        dib_memory.transfer(CF_DIBV5)?;
        private_memory.transfer(self.private)?;
        let generation = self.generation.load(Ordering::Acquire);
        if !Self::available(self.png)
            || !Self::available(CF_DIBV5)
            || !Self::available(self.private)
        {
            return Err(error("publish", "图片剪贴板格式发布不完整，请重新复制。"));
        }
        open.close()?;
        let identity = self.identity()?;
        if identity.1 != generation || unsafe { GetClipboardOwner() } != self.hwnd {
            return Err(error("changed", "剪贴板已被其他应用改变，请重新复制图片。"));
        }
        Ok(identity)
    }
    fn read(&mut self, retained: usize) -> Result<ClipboardRead, CommandError> {
        let open = Open::new(self.hwnd)?;
        let packet = if Self::available(self.private) {
            // An oversized/malformed untrusted private packet cannot suppress valid standard pixels.
            let handle = unsafe { GetClipboardData(self.private) };
            if handle.is_null() {
                return Err(error("read", "无法读取剪贴板标识，请重新复制图片。"));
            }
            let length = unsafe { GlobalSize(handle) };
            Some(if length > 0 && length <= 512 {
                let locked = Locked::get(self.private, 512)?;
                let bytes = locked.bytes();
                let length = bytes.iter().rposition(|&b| b != 0).map_or(0, |n| n + 1);
                bytes[..length].to_vec()
            } else {
                Vec::new()
            })
        } else {
            None
        };
        let raster = if Self::available(self.png) {
            let locked = Locked::get(self.png, MAX_ENCODED + 64)?;
            let bytes = locked.bytes();
            // HGLOBAL can be rounded up by Windows; trim only the PNG container's trailing padding.
            let length = png_length(bytes)?;
            if length > MAX_ENCODED {
                return Err(oversized());
            }
            Some(Raster::Png(bytes[..length].to_vec()))
        } else if Self::available(CF_DIBV5) || Self::available(CF_DIB) {
            let format = if Self::available(CF_DIBV5) {
                CF_DIBV5
            } else {
                CF_DIB
            };
            let locked = Locked::get(format, 128 * MIB + 2048)?;
            let layout = codec::dib_layout(locked.bytes(), locked.length)?;
            codec::check_budget(layout.pixels(), layout.pixels(), layout.length, 0, retained)?;
            Some(Raster::Dib(locked.bytes()[..layout.length].to_vec()))
        } else {
            None
        };
        // Delayed external rendering may update sequence during GetClipboardData; bind the final data.
        let (sequence, generation) = self.identity()?;
        open.close()?;
        Ok(ClipboardRead {
            sequence,
            generation,
            packet,
            raster,
        })
    }
    fn has_image(&mut self) -> Result<bool, CommandError> {
        let open = Open::new(self.hwnd)?;
        self.identity()?;
        let value =
            Self::available(self.png) || Self::available(CF_DIBV5) || Self::available(CF_DIB);
        open.close()?;
        Ok(value)
    }
}

fn png_length(bytes: &[u8]) -> Result<usize, CommandError> {
    if bytes.get(..8) != Some(b"\x89PNG\r\n\x1a\n") {
        return Err(invalid());
    }
    let mut at: usize = 8;
    loop {
        let header = bytes.get(at..at + 8).ok_or_else(invalid)?;
        let length = u32::from_be_bytes(header[..4].try_into().unwrap()) as usize;
        at = at
            .checked_add(length + 12)
            .filter(|&n| n <= bytes.len())
            .ok_or_else(invalid)?;
        if &header[4..] == b"IEND" {
            return if length == 0 { Ok(at) } else { Err(invalid()) };
        }
    }
}

#[cfg(test)]
#[path = "windows_tests.rs"]
mod integration;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn clipboard_lock_retries_are_bounded_and_actionable() {
        let mut attempts = 0;
        let mut delays = Vec::new();
        let result = bounded_open(
            || {
                attempts += 1;
                false
            },
            |d| delays.push(d.as_millis()),
        );
        assert_eq!(attempts, 6);
        assert_eq!(delays, [5, 10, 20, 40, 80]);
        assert_eq!(result.unwrap_err().code, "image_clipboard_locked");
    }
    #[test]
    fn clipboard_lock_stops_retrying_immediately_after_success() {
        let mut attempts = 0;
        let mut sleeps = 0;
        bounded_open(
            || {
                attempts += 1;
                attempts == 3
            },
            |_| sleeps += 1,
        )
        .unwrap();
        assert_eq!((attempts, sleeps), (3, 2));
    }
    #[test]
    fn png_padding_does_not_change_receipt_integrity() {
        let png = codec::encode_png(&image::RgbaImage::from_pixel(
            1,
            1,
            image::Rgba([1, 2, 3, 4]),
        ))
        .unwrap();
        let mut padded = png.clone();
        padded.extend_from_slice(&[0; 16]);
        assert_eq!(png_length(&padded).unwrap(), png.len());
    }
}
