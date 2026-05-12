use std::path::PathBuf;

use serde::Deserialize;
use tauri::{AppHandle, Manager, State, Url};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_notification::{NotificationExt, PermissionState};

use crate::backend::BackendState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFileFilter {
    name: String,
    extensions: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopNotificationInput {
    title: Option<String>,
    body: Option<String>,
    silent: Option<bool>,
    thread_id: Option<String>,
}

#[tauri::command]
pub fn get_ws_url(state: State<'_, BackendState>) -> Result<Option<String>, String> {
    Ok(tauri::async_runtime::block_on(state.ws_url()))
}

#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    let folder = app.dialog().file().blocking_pick_folder();
    folder
        .map(file_path_to_path_buf)
        .transpose()
        .map(|path| path.and_then(path_for_bridge))
}

#[tauri::command]
pub async fn save_file(
    app: AppHandle,
    default_filename: String,
    contents: String,
    filters: Option<Vec<SaveFileFilter>>,
) -> Result<Option<String>, String> {
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Save File")
        .set_file_name(default_filename);

    if let Some(filters) = filters {
        for filter in filters {
            let extensions = filter
                .extensions
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>();
            dialog = dialog.add_filter(filter.name, &extensions);
        }
    }

    let Some(file_path) = dialog.blocking_save_file() else {
        return Ok(None);
    };

    let path = file_path_to_path_buf(file_path)?;
    std::fs::write(&path, contents).map_err(|error| error.to_string())?;

    Ok(path_for_bridge(path))
}

#[tauri::command]
pub async fn confirm(app: AppHandle, message: String) -> Result<bool, String> {
    Ok(app
        .dialog()
        .message(message)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Yes".to_string(),
            "No".to_string(),
        ))
        .blocking_show())
}

#[tauri::command]
pub async fn open_external(url: String) -> Result<bool, String> {
    let Some(url) = safe_external_url(&url) else {
        return Ok(false);
    };

    tauri_plugin_opener::open_url(url, None::<&str>)
        .map(|_| true)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn show_in_folder(path: String) -> Result<(), String> {
    let path =
        non_empty_path(&path).ok_or_else(|| "show_in_folder path must not be empty".to_string())?;
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn close_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window was not found".to_string())?;
    window.close().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn notifications_is_supported(app: AppHandle) -> Result<bool, String> {
    let permission = app
        .notification()
        .permission_state()
        .map_err(|error| error.to_string())?;
    Ok(is_notification_permission_usable(permission))
}

#[tauri::command]
pub async fn notifications_show(
    app: AppHandle,
    input: Option<DesktopNotificationInput>,
) -> Result<bool, String> {
    let Some(input) = input else {
        return Ok(false);
    };
    let Some(title) = input.title.as_deref().and_then(trimmed_non_empty) else {
        return Ok(false);
    };
    let body = input.body.as_deref().and_then(trimmed_non_empty);

    let mut permission = app
        .notification()
        .permission_state()
        .map_err(|error| error.to_string())?;
    if should_request_notification_permission(permission) {
        permission = app
            .notification()
            .request_permission()
            .map_err(|error| error.to_string())?;
    }
    if permission != PermissionState::Granted {
        return Ok(false);
    }

    let mut notification = app.notification().builder().title(title);
    if input.silent == Some(true) {
        notification = notification.silent();
    }
    if let Some(body) = body {
        notification = notification.body(body);
    }
    if let Some(thread_id) = input.thread_id.as_deref().and_then(trimmed_non_empty) {
        notification = notification.group(format!("thread:{thread_id}"));
    }

    notification.show().map_err(|error| error.to_string())?;
    Ok(true)
}

fn file_path_to_path_buf(file_path: tauri_plugin_dialog::FilePath) -> Result<PathBuf, String> {
    file_path.into_path().map_err(|error| error.to_string())
}

fn path_for_bridge(path: PathBuf) -> Option<String> {
    Some(path.to_string_lossy().into_owned())
}

fn safe_external_url(raw_url: &str) -> Option<String> {
    if raw_url.is_empty() {
        return None;
    }

    let parsed_url = Url::parse(raw_url).ok()?;
    if parsed_url.scheme() != "https" && parsed_url.scheme() != "http" {
        return None;
    }

    Some(parsed_url.to_string())
}

fn non_empty_path(raw_path: &str) -> Option<PathBuf> {
    if raw_path.trim().is_empty() {
        return None;
    }

    Some(PathBuf::from(raw_path))
}

fn trimmed_non_empty(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed)
}

fn is_notification_permission_usable(permission: PermissionState) -> bool {
    matches!(
        permission,
        PermissionState::Granted | PermissionState::Prompt | PermissionState::PromptWithRationale
    )
}

fn should_request_notification_permission(permission: PermissionState) -> bool {
    matches!(
        permission,
        PermissionState::Prompt | PermissionState::PromptWithRationale
    )
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    #[test]
    fn path_for_bridge_uses_display_string() {
        assert_eq!(
            super::path_for_bridge(PathBuf::from("/tmp/brocode")).as_deref(),
            Some("/tmp/brocode"),
        );
    }

    #[test]
    fn safe_external_url_accepts_http_and_https_urls() {
        assert_eq!(
            super::safe_external_url("https://example.com/path?q=1").as_deref(),
            Some("https://example.com/path?q=1"),
        );
        assert_eq!(
            super::safe_external_url("http://localhost:58090").as_deref(),
            Some("http://localhost:58090/"),
        );
    }

    #[test]
    fn safe_external_url_rejects_invalid_or_disallowed_urls() {
        assert_eq!(super::safe_external_url(""), None);
        assert_eq!(super::safe_external_url("not a url"), None);
        assert_eq!(super::safe_external_url("file:///tmp/secret"), None);
        assert_eq!(super::safe_external_url("javascript:alert(1)"), None);
    }

    #[test]
    fn non_empty_path_rejects_empty_or_whitespace_paths() {
        assert_eq!(super::non_empty_path(""), None);
        assert_eq!(super::non_empty_path("   \n\t"), None);
        assert_eq!(
            super::non_empty_path("/tmp/brocode"),
            Some(PathBuf::from("/tmp/brocode"))
        );
    }

    #[test]
    fn notification_permission_supports_prompt_and_granted_states() {
        assert!(super::is_notification_permission_usable(
            tauri_plugin_notification::PermissionState::Granted
        ));
        assert!(super::is_notification_permission_usable(
            tauri_plugin_notification::PermissionState::Prompt
        ));
        assert!(super::is_notification_permission_usable(
            tauri_plugin_notification::PermissionState::PromptWithRationale
        ));
        assert!(!super::is_notification_permission_usable(
            tauri_plugin_notification::PermissionState::Denied
        ));
    }

    #[test]
    fn notification_permission_request_only_prompts_when_needed() {
        assert!(!super::should_request_notification_permission(
            tauri_plugin_notification::PermissionState::Granted
        ));
        assert!(!super::should_request_notification_permission(
            tauri_plugin_notification::PermissionState::Denied
        ));
        assert!(super::should_request_notification_permission(
            tauri_plugin_notification::PermissionState::Prompt
        ));
        assert!(super::should_request_notification_permission(
            tauri_plugin_notification::PermissionState::PromptWithRationale
        ));
    }

    #[test]
    fn trimmed_non_empty_rejects_empty_notification_text() {
        assert_eq!(super::trimmed_non_empty(""), None);
        assert_eq!(super::trimmed_non_empty("  \n"), None);
        assert_eq!(super::trimmed_non_empty("  Done  "), Some("Done"));
    }
}
