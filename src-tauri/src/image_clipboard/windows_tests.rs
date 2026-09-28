use super::*;
use std::{
    os::windows::{io::AsRawHandle, process::CommandExt},
    process::{Command, Stdio},
};
use windows_sys::Win32::{
    Foundation::{GENERIC_ALL, WAIT_TIMEOUT},
    System::{
        StationsAndDesktops::{
            CloseDesktop, CloseWindowStation, CreateDesktopW, CreateWindowStationW,
            GetProcessWindowStation, GetThreadDesktop, OpenDesktopW, OpenWindowStationW,
            SetProcessWindowStation, SetThreadDesktop, HDESK, HWINSTA,
        },
        Threading::{GetCurrentThreadId, WaitForSingleObject, CREATE_NO_WINDOW},
    },
};

const ENABLED: &str = "PRESHOT_PRIVATE_CLIPBOARD_TEST";
const STATION: &str = "PRESHOT_PRIVATE_CLIPBOARD_STATION";
const DESKTOP: &str = "PreshotImageClipboard";

struct PrivateStation {
    station: HWINSTA,
    desktop: HDESK,
    original_station: HWINSTA,
    original_desktop: HDESK,
    name: String,
}

impl PrivateStation {
    fn enter(existing: Option<String>) -> Self {
        assert_eq!(std::env::var(ENABLED).as_deref(), Ok("1"));
        let name = existing
            .clone()
            .unwrap_or_else(|| format!("PreshotClipboardTest.{}", Uuid::new_v4()));
        assert!(name.starts_with("PreshotClipboardTest."));
        let original_station = unsafe { GetProcessWindowStation() };
        let original_desktop = unsafe { GetThreadDesktop(GetCurrentThreadId()) };
        let station = unsafe {
            if existing.is_some() {
                OpenWindowStationW(wide(&name).as_ptr(), 0, GENERIC_ALL)
            } else {
                CreateWindowStationW(wide(&name).as_ptr(), 0, GENERIC_ALL, null())
            }
        };
        assert!(
            !station.is_null(),
            "private station: {}",
            std::io::Error::last_os_error()
        );
        assert_ne!(station, original_station);
        assert_ne!(unsafe { SetProcessWindowStation(station) }, 0);
        let desktop = unsafe {
            if existing.is_some() {
                OpenDesktopW(wide(DESKTOP).as_ptr(), 0, 0, GENERIC_ALL)
            } else {
                CreateDesktopW(
                    wide(DESKTOP).as_ptr(),
                    null(),
                    null(),
                    0,
                    GENERIC_ALL,
                    null(),
                )
            }
        };
        assert!(
            !desktop.is_null(),
            "private desktop: {}",
            std::io::Error::last_os_error()
        );
        assert_ne!(unsafe { SetThreadDesktop(desktop) }, 0);
        assert_eq!(unsafe { GetProcessWindowStation() }, station);
        // No clipboard API is called until both the child process and its UI thread
        // are bound to this noninteractive, newly-created window station/desktop.
        Self {
            station,
            desktop,
            original_station,
            original_desktop,
            name,
        }
    }
}
impl Drop for PrivateStation {
    fn drop(&mut self) {
        unsafe {
            SetProcessWindowStation(self.original_station);
            SetThreadDesktop(self.original_desktop);
            CloseDesktop(self.desktop);
            CloseWindowStation(self.station);
        }
    }
}

fn run_fixture(name: &str, station: Option<&str>) {
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args(["--exact", name, "--ignored", "--nocapture"])
        .env(ENABLED, "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW);
    if let Some(station) = station {
        command.env(STATION, station);
    } else {
        command.env_remove(STATION);
    }
    let mut child = command.spawn().unwrap();
    if unsafe { WaitForSingleObject(child.as_raw_handle() as HANDLE, 20_000) } == WAIT_TIMEOUT {
        child.kill().unwrap();
        let output = child.wait_with_output().unwrap();
        panic!(
            "isolated clipboard child timed out: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "isolated clipboard child failed:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn image_input() -> ImageClipboardInput {
    let mut input = super::super::tests::input();
    input.data_url = format!(
        "data:image/png;base64,{}",
        STANDARD.encode(
            codec::encode_png(
                &image::RgbaImage::from_raw(1, 2, vec![255, 0, 0, 128, 0, 0, 255, 255],).unwrap()
            )
            .unwrap(),
        )
    );
    input
}

fn contents(engine: &mut Engine, backend: &mut WindowsClipboard) -> ImageClipboardContents {
    match engine.execute(backend, Request::Read).unwrap() {
        Response::Contents(Some(contents)) => contents,
        _ => panic!("expected clipboard image"),
    }
}

fn assert_public_formats(backend: &mut WindowsClipboard) {
    let open = Open::new(backend.hwnd).unwrap();
    assert!(WindowsClipboard::available(backend.png));
    assert!(WindowsClipboard::available(CF_DIBV5));
    assert!(WindowsClipboard::available(backend.private));
    let png = Locked::get(backend.png, MAX_ENCODED + 64).unwrap();
    let rgba = image::load_from_memory(&png.bytes()[..png_length(png.bytes()).unwrap()])
        .unwrap()
        .into_rgba8();
    assert_eq!(rgba.get_pixel(0, 0).0, [255, 0, 0, 128]);
    assert_eq!(rgba.get_pixel(0, 1).0, [0, 0, 255, 255]);
    drop(png);
    let dib = Locked::get(CF_DIBV5, 1024).unwrap();
    let rgba = codec::decode_dib(dib.bytes()).unwrap();
    assert_eq!(rgba.get_pixel(0, 0).0, [255, 0, 0, 128]);
    assert_eq!(rgba.get_pixel(0, 1).0, [0, 0, 255, 255]);
    drop(dib);
    let packet = Locked::get(backend.private, 512).unwrap();
    let length = packet.bytes().iter().rposition(|&b| b != 0).unwrap() + 1;
    let json: serde_json::Value = serde_json::from_slice(&packet.bytes()[..length]).unwrap();
    assert_eq!(json.as_object().unwrap().len(), 3);
    drop(packet);
    open.close().unwrap();
}

#[test]
fn actual_win32_clipboard_is_verified_in_a_private_window_station() {
    run_fixture(
        "image_clipboard::windows::integration::private_station_fixture",
        None,
    );
}

#[test]
#[ignore = "Private noninteractive window-station subprocess fixture; invoked automatically"]
fn private_station_fixture() {
    let station = PrivateStation::enter(None);
    let generation = Arc::new(AtomicU64::new(1));
    let window = OwnerWindow::create(generation.clone()).unwrap();
    let mut backend = WindowsClipboard::new(window.hwnd, generation).unwrap();
    let mut engine = Engine::default();
    let image = image_input();
    let original = image.data_url.clone();
    engine.execute(&mut backend, Request::Write(image)).unwrap();
    assert_eq!(unsafe { GetClipboardOwner() }, window.hwnd);
    assert_public_formats(&mut backend);
    let native = contents(&mut engine, &mut backend);
    assert!(!native.external);
    assert_eq!(native.original.data_url, original);
    assert!(backend.has_image().unwrap());
    let held = Open::new(window.hwnd).unwrap();
    let desktop = station.desktop as usize;
    let code = std::thread::spawn(move || {
        assert_ne!(unsafe { SetThreadDesktop(desktop as HDESK) }, 0);
        let contender = OwnerWindow::create(Arc::new(AtomicU64::new(1))).unwrap();
        Open::new(contender.hwnd)
            .err()
            .expect("another window owns the lock")
            .code
    })
    .join()
    .unwrap();
    assert_eq!(code, "image_clipboard_locked");
    held.close().unwrap();

    let prepared = codec::prepare(image_input(), 0).unwrap();
    backend
        .publish(b"untrusted packet", &prepared.png, &prepared.dib)
        .unwrap();
    assert!(contents(&mut engine, &mut backend).external);
    assert!(engine.current.is_none());

    let mut dib24 = vec![0; 48];
    dib24[0..4].copy_from_slice(&40u32.to_le_bytes());
    dib24[4..8].copy_from_slice(&1u32.to_le_bytes());
    dib24[8..12].copy_from_slice(&2u32.to_le_bytes());
    dib24[12..14].copy_from_slice(&1u16.to_le_bytes());
    dib24[14..16].copy_from_slice(&24u16.to_le_bytes());
    dib24[40..48].copy_from_slice(&[255, 0, 0, 0, 0, 0, 255, 0]);
    for (format, pixels, alpha) in [
        (CF_DIBV5, prepared.dib.as_slice(), 128),
        (CF_DIB, dib24.as_slice(), 255),
    ] {
        let allocation = Allocation::new(pixels).unwrap();
        let open = Open::new(window.hwnd).unwrap();
        assert_ne!(unsafe { EmptyClipboard() }, 0);
        allocation.transfer(format).unwrap();
        open.close().unwrap();
        assert!(!WindowsClipboard::available(backend.png));
        assert!(backend.has_image().unwrap());
        let external = contents(&mut engine, &mut backend);
        assert!(external.external);
        let bytes = STANDARD
            .decode(external.rendered_data_url.split_once(',').unwrap().1)
            .unwrap();
        let rgba = image::load_from_memory(&bytes).unwrap().into_rgba8();
        assert_eq!(rgba.get_pixel(0, 0).0, [255, 0, 0, alpha]);
        assert_eq!(rgba.get_pixel(0, 1).0, [0, 0, 255, 255]);
    }

    let open = Open::new(window.hwnd).unwrap();
    assert_ne!(unsafe { EmptyClipboard() }, 0);
    open.close().unwrap();
    assert!(!backend.has_image().unwrap());
    assert!(matches!(
        engine.execute(&mut backend, Request::Read).unwrap(),
        Response::Contents(None)
    ));
    drop(window);

    // Publisher exits entirely. The host keeps only the private station alive,
    // not its HWND, process, rich snapshot, or any delayed rendering callback.
    run_fixture(
        "image_clipboard::windows::integration::publisher_exit_fixture",
        Some(&station.name),
    );
    let generation = Arc::new(AtomicU64::new(1));
    let window = OwnerWindow::create(generation.clone()).unwrap();
    let mut backend = WindowsClipboard::new(window.hwnd, generation).unwrap();
    assert_public_formats(&mut backend);
    let survived = contents(&mut Engine::default(), &mut backend);
    assert!(survived.external);
    let bytes = STANDARD
        .decode(survived.rendered_data_url.split_once(',').unwrap().1)
        .unwrap();
    assert_eq!(
        image::load_from_memory(&bytes)
            .unwrap()
            .into_rgba8()
            .get_pixel(0, 0)
            .0,
        [255, 0, 0, 128]
    );
    drop(window);
    drop(station);
}

#[test]
#[ignore = "Private window-station publisher fixture; never targets the interactive clipboard"]
fn publisher_exit_fixture() {
    let station_name = std::env::var(STATION).expect("requires the isolated host's station");
    let _station = PrivateStation::enter(Some(station_name));
    let generation = Arc::new(AtomicU64::new(1));
    let window = OwnerWindow::create(generation.clone()).unwrap();
    let mut backend = WindowsClipboard::new(window.hwnd, generation).unwrap();
    Engine::default()
        .execute(&mut backend, Request::Write(image_input()))
        .unwrap();
    assert_public_formats(&mut backend);
    std::process::exit(0);
}
