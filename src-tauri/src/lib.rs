mod error;
mod workspace;

#[derive(Debug, PartialEq, serde::Serialize)]
struct PlatformInfo {
    os: &'static str,
}

fn current_platform() -> PlatformInfo {
    PlatformInfo {
        os: std::env::consts::OS,
    }
}

#[tauri::command]
fn platform_info() -> PlatformInfo {
    current_platform()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            platform_info,
            workspace::create_project,
            workspace::inspect_project,
            workspace::remove_created_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Preshot");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_the_compilation_platform() {
        assert_eq!(
            current_platform(),
            PlatformInfo {
                os: std::env::consts::OS
            }
        );
    }
}
