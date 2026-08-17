mod error;
mod menu;
mod pdf;
mod plan;
mod reveal;
mod screenshot;
mod settings;
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
        .manage(screenshot::ScreenCaptureSessions::default())
        .setup(|app| {
            menu::install(app.handle())?;
            menu::register_handlers(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform_info,
            workspace::create_project,
            workspace::inspect_project,
            workspace::default_projects_dir,
            workspace::rollback_created_project,
            workspace::forget_created_project,
            plan::save_project_plan,
            plan::read_project_plan,
            plan::import_reference_image,
            plan::load_reference_image,
            plan::remove_reference_image,
            plan::import_plan_media,
            plan::load_plan_media,
            plan::remove_plan_media,
            pdf::save_pdf,
            reveal::reveal_path,
            reveal::open_project_directory,
            screenshot::start_screen_capture,
            screenshot::poll_screen_capture,
            screenshot::cancel_screen_capture,
            settings::read_settings,
            settings::write_settings,
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
