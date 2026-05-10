mod backend;
mod bridge;
mod paths;

use std::{env, path::PathBuf};

use backend::{start_backend, stop_backend, BackendConfig, BackendState};
use tauri::{Manager, WindowEvent};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            bridge::get_ws_url,
            bridge::pick_folder,
            bridge::save_file,
            bridge::confirm,
            bridge::open_external,
            bridge::show_in_folder,
        ])
        .setup(|app| {
            let repo_root = paths::repo_root_from_manifest_dir();
            let home_dir = env::var_os("BROCODE_HOME")
                .or_else(|| env::var_os("DPCODE_HOME"))
                .map(PathBuf::from)
                .unwrap_or_else(|| paths::default_dev_home(&repo_root));
            let port = env::var("T3CODE_PORT")
                .ok()
                .and_then(|value| value.parse::<u16>().ok())
                .unwrap_or(58090);

            let config = BackendConfig {
                port,
                host: "127.0.0.1".to_string(),
                home_dir,
                repo_root,
            };
            let state = BackendState::new();

            app.manage(state.clone());
            tauri::async_runtime::spawn(async move {
                if let Err(error) = start_backend(state, config).await {
                    eprintln!("failed to start BroCode backend: {error}");
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::CloseRequested { .. }) {
                let state = window.state::<BackendState>().inner().clone();
                if let Err(error) = tauri::async_runtime::block_on(stop_backend(state)) {
                    eprintln!("failed to stop BroCode backend: {error}");
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run BroCode Tauri shell");
}
