use serde_json::json;
use tauri::{
    menu::{MenuBuilder, SubmenuBuilder},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use uuid::Uuid;

pub const MENU_EVENT: &str = "workspace://menu";

const WORKSPACE_NEW_ID: &str = "workspace_new";
const WORKSPACE_OPEN_ID: &str = "workspace_open";
const WORKSPACE_NEW_WINDOW_ID: &str = "workspace_new_window";
const WORKSPACE_CLOSE_ID: &str = "workspace_close";
const WINDOW_LABEL_PREFIX: &str = "workspace-";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceMenuRoute {
    NewProject,
    OpenProject,
    NewWindow,
    CloseWindow,
}

impl WorkspaceMenuRoute {
    fn frontend_payload(self) -> Option<&'static str> {
        match self {
            Self::NewProject => Some("new-project"),
            Self::OpenProject => Some("open-project"),
            Self::NewWindow | Self::CloseWindow => None,
        }
    }
}

pub fn route_menu_action(menu_id: &str) -> Option<WorkspaceMenuRoute> {
    match menu_id {
        WORKSPACE_NEW_ID => Some(WorkspaceMenuRoute::NewProject),
        WORKSPACE_OPEN_ID => Some(WorkspaceMenuRoute::OpenProject),
        WORKSPACE_NEW_WINDOW_ID => Some(WorkspaceMenuRoute::NewWindow),
        WORKSPACE_CLOSE_ID => Some(WorkspaceMenuRoute::CloseWindow),
        _ => None,
    }
}

pub fn workspace_window_label(window_id: Uuid) -> String {
    format!("{WINDOW_LABEL_PREFIX}{window_id}")
}

fn log_menu(level: &str, message: &str, data: serde_json::Value) {
    eprintln!(
        "{}",
        json!({
            "service": "workspace-menu",
            "level": level,
            "message": message,
            "data": data,
        })
    );
}

fn log_menu_error(message: &str, error: impl std::fmt::Display) {
    log_menu("ERROR", message, json!({ "error": error.to_string() }));
}

fn log_menu_warning(message: &str, data: serde_json::Value) {
    log_menu("WARN", message, data);
}

fn focused_webview_window(app: &AppHandle) -> Option<WebviewWindow> {
    for window in app.webview_windows().into_values() {
        match window.is_focused() {
            Ok(true) => return Some(window),
            Ok(false) => {}
            Err(error) => {
                log_menu_error("Unable to inspect focused workspace window", error);
            }
        }
    }

    None
}

fn emit_to_focused_webview(app: &AppHandle, payload: &str) -> tauri::Result<()> {
    match focused_webview_window(app) {
        Some(window) => window.emit(MENU_EVENT, payload),
        None => {
            log_menu_warning(
                "Ignoring workspace menu action because no focused webview is available",
                json!({ "event": MENU_EVENT, "payload": payload }),
            );
            Ok(())
        }
    }
}

fn close_focused_window(app: &AppHandle) -> tauri::Result<()> {
    match focused_webview_window(app) {
        Some(window) => window.close(),
        None => {
            log_menu_warning(
                "Ignoring close menu action because no focused webview is available",
                json!({ "menuId": WORKSPACE_CLOSE_ID }),
            );
            Ok(())
        }
    }
}

fn open_new_workspace_window(app: &AppHandle) -> tauri::Result<()> {
    WebviewWindowBuilder::new(
        app,
        workspace_window_label(Uuid::new_v4()),
        WebviewUrl::App("index.html".into()),
    )
    .title("Preshot")
    .inner_size(1280.0, 800.0)
    .min_inner_size(960.0, 640.0)
    .build()?;

    Ok(())
}

fn handle_menu_route(app: &AppHandle, route: WorkspaceMenuRoute) -> tauri::Result<()> {
    if let Some(payload) = route.frontend_payload() {
        return emit_to_focused_webview(app, payload);
    }

    match route {
        WorkspaceMenuRoute::NewWindow => open_new_workspace_window(app),
        WorkspaceMenuRoute::CloseWindow => close_focused_window(app),
        WorkspaceMenuRoute::NewProject | WorkspaceMenuRoute::OpenProject => Ok(()),
    }
}

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let file_menu = SubmenuBuilder::new(app, "File")
        .text(WORKSPACE_NEW_ID, "New Project")
        .text(WORKSPACE_OPEN_ID, "Open Project")
        .separator()
        .text(WORKSPACE_NEW_WINDOW_ID, "Open New Window")
        .separator()
        .text(WORKSPACE_CLOSE_ID, "Close")
        .build()?;
    let menu = MenuBuilder::new(app).item(&file_menu).build()?;

    app.set_menu(menu)?;
    Ok(())
}

pub fn register_handlers(app: AppHandle) {
    app.on_menu_event(|app_handle, event| {
        let menu_id = event.id().0.as_str();

        match route_menu_action(menu_id) {
            Some(route) => {
                if let Err(error) = handle_menu_route(app_handle, route) {
                    log_menu_error("Unable to handle workspace menu action", error);
                }
            }
            None => {
                log_menu_warning(
                    "Ignoring unknown workspace menu action",
                    json!({ "menuId": menu_id }),
                );
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn routes_all_known_menu_ids_and_rejects_unknown_ids() {
        assert_eq!(
            route_menu_action("workspace_new"),
            Some(WorkspaceMenuRoute::NewProject)
        );
        assert_eq!(
            route_menu_action("workspace_open"),
            Some(WorkspaceMenuRoute::OpenProject)
        );
        assert_eq!(
            route_menu_action("workspace_new_window"),
            Some(WorkspaceMenuRoute::NewWindow)
        );
        assert_eq!(
            route_menu_action("workspace_close"),
            Some(WorkspaceMenuRoute::CloseWindow)
        );
        assert_eq!(route_menu_action("workspace_unknown"), None);
        assert_eq!(route_menu_action(""), None);
    }

    #[test]
    fn builds_workspace_window_labels_with_the_expected_prefix() {
        let id = Uuid::parse_str("12345678-1234-4abc-8def-1234567890ab").unwrap();

        assert_eq!(
            workspace_window_label(id),
            "workspace-12345678-1234-4abc-8def-1234567890ab"
        );
    }
}
