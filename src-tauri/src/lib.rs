use tauri::Manager;

pub mod agent;
mod agent_store;
mod byte_write;
pub mod copilot;
mod docx;
mod error;
mod long_image;
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
    let agent_bridge = std::sync::Arc::new(agent::RendererAgentBridge::default());
    let agent_runtime = agent::AgentRuntimeService::with_dependencies(
        workspace::preshot_home(),
        agent_bridge.clone(),
        agent_bridge.clone(),
    );
    let agent_bridge_for_setup = agent_bridge.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(agent_bridge)
        .manage(agent_runtime)
        .manage(workspace::PendingProjectRollbacks::default())
        .manage(screenshot::ScreenCaptureSessions::default())
        .setup(move |app| {
            let store = agent_store::AgentMetadataStore::for_current_user()?;
            agent_bridge_for_setup.configure_store(store.clone());
            app.manage(store);
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
            plan::commit_reference_image_crop,
            plan::rollback_reference_image_crop,
            plan::load_reference_image,
            plan::remove_reference_image,
            plan::import_plan_media,
            plan::load_plan_media,
            plan::remove_plan_media,
            pdf::save_pdf,
            docx::save_docx,
            long_image::save_long_images,
            reveal::open_project_directory,
            screenshot::start_screen_capture,
            screenshot::poll_screen_capture,
            screenshot::cancel_screen_capture,
            screenshot::discard_screen_capture,
            settings::read_settings,
            settings::write_settings,
            agent_store::agent_store_adopt_project,
            agent_store::agent_store_list_sessions,
            agent_store::agent_store_create_session,
            agent_store::agent_store_update_session,
            agent_store::agent_store_rename_session,
            agent_store::agent_store_delete_session,
            agent_store::agent_store_read_draft,
            agent_store::agent_store_write_draft,
            agent_store::agent_store_create_proposal,
            agent_store::agent_store_list_proposals,
            agent_store::agent_store_mark_proposal_stale,
            agent_store::agent_store_set_proposal_status,
            agent_store::agent_store_apply_proposal,
            agent_store::agent_store_commit_proposal_apply,
            agent_store::agent_store_undo_proposal,
            agent_store::agent_store_save_checkpoint,
            agent_store::agent_store_read_latest_checkpoint,
            agent_store::agent_store_begin_proposal_recovery,
            agent_store::agent_store_list_proposal_recovery,
            agent_store::agent_store_finalize_proposal_recovery,
            agent_store::agent_store_abort_proposal_recovery,
            agent_store::agent_store_mark_proposal_recovery_conflict,
            agent_store::agent_store_record_proposal_recovery_error,
            agent_store::agent_store_update_usage,
            agent_store::agent_store_delete_project,
            agent_store::agent_store_add_cleanup_tombstone,
            agent_store::agent_store_list_cleanup_tombstones,
            agent_store::agent_store_retry_cleanup_tombstone,
            agent_store::agent_store_remove_cleanup_tombstone,
            agent::commands::agent_list_models,
            agent::commands::agent_probe_model,
            agent::commands::agent_register_request_context,
            agent::commands::agent_create_session,
            agent::commands::agent_resume_session,
            agent::commands::agent_send,
            agent::commands::agent_abort,
            agent::commands::agent_disconnect_session,
            agent::commands::agent_delete_session,
            agent::commands::agent_get_events,
            agent::commands::agent_get_usage,
            agent::commands::agent_subscribe_events,
            agent::commands::agent_unsubscribe_events,
            agent::commands::agent_resolve_permission,
            agent::commands::agent_resolve_input,
            agent::commands::agent_resolve_elicitation,
            agent::commands::agent_stop_runtime,
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
