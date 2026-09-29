mod byte_write;
mod bundled_demo;
mod column_document;
mod docx;
mod error;
mod image_clipboard;
mod image_paste;
mod long_image;
mod library;
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
    if image_clipboard::run_codec_worker_if_requested() {
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(workspace::PendingProjectRollbacks::default())
        .manage(screenshot::ScreenCaptureSessions::default())
        .manage(image_clipboard::ImageClipboardState::default())
        .setup(move |app| {
            menu::install(app.handle())?;
            menu::register_handlers(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform_info,
            workspace::ensure_user_data_roots,
            workspace::bootstrap_user_data,
            workspace::create_project,
            workspace::inspect_project,
            workspace::default_projects_dir,
            workspace::rollback_created_project,
            workspace::forget_created_project,
            plan::save_project_plan,
            plan::read_project_plan,
            plan::import_reference_image,
            plan::crop_reference_image,
            plan::copy_reference_image_crop,
            plan::is_reference_image_retained_for_history,
            plan::commit_reference_image_crop,
            plan::rollback_reference_image_crop,
            plan::load_reference_image,
            plan::remove_reference_image,
            plan::import_plan_media,
            plan::load_plan_media,
            plan::remove_plan_media,
            image_clipboard::image_clipboard_write,
            image_clipboard::image_clipboard_read,
            image_clipboard::image_clipboard_has_image,
            image_paste::prepare_image_paste,
            image_paste::commit_image_paste,
            image_paste::get_image_paste_status,
            image_paste::abort_image_paste,
            library::library_search,
            library::library_get,
            library::library_save,
            library::library_begin_edit,
            library::library_begin_create,
            library::library_load_edit_image,
            library::library_import_edit_images,
            library::library_import_edit_image_data,
            library::library_crop_edit_image,
            library::library_commit_edit,
            library::library_discard_edit,
            library::library_update_metadata,
            library::library_set_deleted,
            library::library_purge,
            library::library_load_image,
            library::library_load_preview,
            library::library_save_preview,
            library::library_mark_preview_failed,
            library::library_prepare_insert,
            library::library_commit_insert,
            library::library_abort_insert,
            library::library_insert_status,
            pdf::save_pdf,
            docx::save_docx,
            long_image::save_long_images,
            reveal::open_project_directory,
            screenshot::start_screen_capture,
            screenshot::poll_screen_capture,
            screenshot::cancel_screen_capture,
            screenshot::discard_screen_capture,
            screenshot::import_screen_capture_media,
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
