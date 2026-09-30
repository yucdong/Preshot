//! The MSI finish action is a launcher only: initialize data in the desktop user's process.
#[cfg(windows)]
fn launch() -> Result<(), String> {
    use std::{
        mem::{size_of, zeroed},
        os::windows::ffi::OsStrExt,
        ptr::{null, null_mut},
    };
    use windows_sys::Win32::{
        Foundation::{CloseHandle, HANDLE},
        Security::{
            DuplicateTokenEx, GetTokenInformation, SecurityImpersonation, TokenElevation,
            TokenPrimary, TOKEN_DUPLICATE, TOKEN_ELEVATION, TOKEN_QUERY,
        },
        System::{
            Environment::{CreateEnvironmentBlock, DestroyEnvironmentBlock},
            Threading::{
                CreateProcessWithTokenW, GetCurrentProcess, OpenProcess, OpenProcessToken,
                CREATE_UNICODE_ENVIRONMENT, LOGON_WITH_PROFILE, PROCESS_INFORMATION,
                PROCESS_QUERY_LIMITED_INFORMATION, STARTUPINFOW,
            },
        },
        UI::WindowsAndMessaging::{GetShellWindow, GetWindowThreadProcessId},
    };
    struct Handle(HANDLE);
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
    fn error() -> String {
        std::io::Error::last_os_error().to_string()
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    unsafe {
        let mut token = null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return Err(error());
        }
        let token = Handle(token);
        let mut elevation: TOKEN_ELEVATION = zeroed();
        let mut returned = 0;
        if GetTokenInformation(
            token.0,
            TokenElevation,
            &mut elevation as *mut _ as _,
            size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned,
        ) == 0
        {
            return Err(error());
        }
        if elevation.TokenIsElevated == 0 {
            std::process::Command::new(exe)
                .spawn()
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
        let shell = GetShellWindow();
        if shell.is_null() {
            return Err("The normal user's Windows desktop is unavailable. Open Preshot from the Start Menu.".into());
        }
        let mut pid = 0;
        GetWindowThreadProcessId(shell, &mut pid);
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return Err(error());
        }
        let process = Handle(process);
        let mut token = null_mut();
        if OpenProcessToken(process.0, TOKEN_QUERY | TOKEN_DUPLICATE, &mut token) == 0 {
            return Err(format!("Open desktop user token: {}", error()));
        }
        let token = Handle(token);
        let mut primary = null_mut();
        if DuplicateTokenEx(
            token.0,
            0x02000000,
            null(),
            SecurityImpersonation,
            TokenPrimary,
            &mut primary,
        ) == 0
        {
            return Err(format!("Duplicate desktop user token: {}", error()));
        }
        let token = Handle(primary);
        let mut environment = null_mut();
        if CreateEnvironmentBlock(&mut environment, token.0, 0) == 0 {
            return Err(error());
        }
        let application: Vec<u16> = exe.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut command: Vec<u16> = format!("\"{}\"", exe.display())
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let mut startup: STARTUPINFOW = zeroed();
        startup.cb = size_of::<STARTUPINFOW>() as u32;
        let mut child: PROCESS_INFORMATION = zeroed();
        let success = CreateProcessWithTokenW(
            token.0,
            LOGON_WITH_PROFILE,
            application.as_ptr(),
            command.as_mut_ptr(),
            CREATE_UNICODE_ENVIRONMENT,
            environment,
            null(),
            &startup,
            &mut child,
        );
        let failure = error();
        DestroyEnvironmentBlock(environment);
        if success == 0 {
            return Err(failure);
        }
        CloseHandle(child.hThread);
        CloseHandle(child.hProcess);
    }
    Ok(())
}

pub(crate) fn handle_request() -> bool {
    if std::env::args().nth(1).as_deref() != Some("--from-installer") {
        return false;
    }
    #[cfg(windows)]
    if let Err(error) = launch() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
        let message: Vec<u16> =
            format!("Unable to open Preshot: {error}\nOpen Preshot from the Start Menu.")
                .encode_utf16()
                .chain(Some(0))
                .collect();
        let title: Vec<u16> = "Preshot".encode_utf16().chain(Some(0)).collect();
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                message.as_ptr(),
                title.as_ptr(),
                MB_OK | MB_ICONERROR,
            );
        }
    }
    true
}
