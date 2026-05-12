mod backend;
mod bridge;
mod paths;

use std::{env, path::PathBuf};

use backend::{start_backend, stop_backend, BackendConfig, BackendState};
use tauri::{Manager, RunEvent, WindowEvent};

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            bridge::get_ws_url,
            bridge::pick_folder,
            bridge::save_file,
            bridge::confirm,
            bridge::open_external,
            bridge::show_in_folder,
            bridge::close_window,
            bridge::notifications_is_supported,
            bridge::notifications_show,
        ])
        .setup(|app| {
            let repo_root = paths::runtime_root(app.path().resource_dir().ok());
            let user_home_dir = app.path().home_dir().ok();
            let app_data_dir = app.path().app_data_dir().ok();
            let home_dir = env::var_os("BROCODE_HOME")
                .or_else(|| env::var_os("DPCODE_HOME"))
                .map(PathBuf::from)
                .unwrap_or_else(|| paths::default_home(&repo_root, user_home_dir, app_data_dir));
            let configured_port = env::var("T3CODE_PORT")
                .ok()
                .and_then(|value| value.parse::<u16>().ok());
            let port = configured_port.unwrap_or(58090);

            let config = BackendConfig {
                port,
                host: "127.0.0.1".to_string(),
                home_dir,
                repo_root,
                allow_port_fallback: configured_port.is_none(),
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
                stop_backend_now(state);
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build BroCode Tauri shell");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            let state = app_handle.state::<BackendState>().inner().clone();
            stop_backend_now(state);
        }
    });
}

fn stop_backend_now(state: BackendState) {
    if let Err(error) = tauri::async_runtime::block_on(stop_backend(state)) {
        eprintln!("failed to stop BroCode backend: {error}");
    }
}
