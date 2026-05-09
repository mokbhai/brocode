use std::path::PathBuf;

use serde::Deserialize;
use tauri::{AppHandle, State, Url};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

use crate::backend::BackendState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFileFilter {
    name: String,
    extensions: Vec<String>,
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

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    #[test]
    fn path_for_bridge_uses_display_string() {
        assert_eq!(
            super::path_for_bridge(PathBuf::from("/tmp/dpcode")).as_deref(),
            Some("/tmp/dpcode"),
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
            super::non_empty_path("/tmp/dpcode"),
            Some(PathBuf::from("/tmp/dpcode"))
        );
    }
}
