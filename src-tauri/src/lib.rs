mod error;
mod menu;
mod pdf;
mod plan;
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(workspace::PendingProjectRollbacks::default())
        .setup(|app| {
            menu::install(app.handle())?;
            menu::register_handlers(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform_info,
            workspace::create_project,
            workspace::inspect_project,
            workspace::rollback_created_project,
            workspace::forget_created_project,
            plan::save_project_plan,
            plan::read_project_plan,
            plan::import_reference_image,
            plan::load_reference_image,
            plan::remove_reference_image,
            pdf::save_pdf,
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
