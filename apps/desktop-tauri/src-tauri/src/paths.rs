use std::path::{Path, PathBuf};

const BUNDLED_RUNTIME_DIR: &str = "brocode-runtime";

pub fn repo_root_from_manifest_dir() -> PathBuf {
    resolve_repo_root_from_manifest_dir(&PathBuf::from(env!("CARGO_MANIFEST_DIR")))
        .expect("src-tauri should live under the BroCode repository")
}

pub fn runtime_root(resource_dir: Option<PathBuf>) -> PathBuf {
    if let Some(resource_dir) = resource_dir {
        let runtime_root = resource_dir.join(BUNDLED_RUNTIME_DIR);
        if runtime_root.join("apps/server/dist/index.mjs").is_file() {
            return runtime_root;
        }
    }

    repo_root_from_manifest_dir()
}

pub fn default_dev_home(repo_root: &Path) -> PathBuf {
    repo_root.join(".brocode-tauri-dev")
}

pub fn default_home(
    runtime_root: &Path,
    user_home_dir: Option<PathBuf>,
    app_data_dir: Option<PathBuf>,
) -> PathBuf {
    if is_repo_root(runtime_root) {
        return default_dev_home(runtime_root);
    }

    user_home_dir
        .map(|home_dir| home_dir.join(".brocode"))
        .or(app_data_dir)
        .unwrap_or_else(|| default_dev_home(runtime_root))
}

pub fn browser_use_pipe_path(home_dir: &Path) -> PathBuf {
    if cfg!(windows) {
        PathBuf::from(r"\\.\pipe\brocode-browser-use")
    } else {
        home_dir.join("browser-use.sock")
    }
}

fn is_repo_root(path: &Path) -> bool {
    path.join("package.json").is_file() && path.join("apps/server/package.json").is_file()
}

fn resolve_repo_root_from_manifest_dir(manifest_dir: &Path) -> Option<PathBuf> {
    manifest_dir
        .ancestors()
        .find(|candidate| is_repo_root(candidate))
        .map(Path::to_path_buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_dev_home_lives_under_repo_root() {
        let repo_root = repo_root_from_manifest_dir();

        assert_eq!(
            default_dev_home(&repo_root),
            repo_root.join(".brocode-tauri-dev")
        );
    }

    #[test]
    fn default_home_uses_dev_home_for_repo_runtime_root() {
        let repo_root = repo_root_from_manifest_dir();

        assert_eq!(
            default_home(
                &repo_root,
                Some(PathBuf::from("/Users/example")),
                Some(PathBuf::from("/tmp/brocode-app-data")),
            ),
            repo_root.join(".brocode-tauri-dev")
        );
    }

    #[test]
    fn default_home_uses_brocode_home_for_bundled_runtime_root() {
        let bundled_runtime_root =
            PathBuf::from("/Applications/BroCode.app/Contents/Resources/brocode-runtime");
        let user_home_dir = PathBuf::from("/Users/example");
        let app_data_dir =
            PathBuf::from("/Users/example/Library/Application Support/com.t3tools.brocode");

        assert_eq!(
            default_home(
                &bundled_runtime_root,
                Some(user_home_dir.clone()),
                Some(app_data_dir)
            ),
            user_home_dir.join(".brocode")
        );
    }

    #[test]
    fn default_home_uses_brocode_home_for_bundled_runtime_under_repo_target() {
        let repo_root = repo_root_from_manifest_dir();
        let bundled_runtime_root = repo_root
            .join("apps/desktop-tauri/src-tauri/target/release/bundle/macos/BroCode.app")
            .join("Contents/Resources/brocode-runtime");
        let user_home_dir = PathBuf::from("/Users/example");
        let app_data_dir =
            PathBuf::from("/Users/example/Library/Application Support/com.t3tools.brocode");

        assert_eq!(
            default_home(
                &bundled_runtime_root,
                Some(user_home_dir.clone()),
                Some(app_data_dir)
            ),
            user_home_dir.join(".brocode")
        );
    }

    #[test]
    fn repo_root_contains_workspace_markers() {
        let repo_root = repo_root_from_manifest_dir();

        assert!(repo_root.join("package.json").is_file());
        assert!(repo_root.join("apps/server/package.json").is_file());
    }

    #[test]
    fn browser_use_pipe_path_lives_under_home_on_unix() {
        if cfg!(windows) {
            return;
        }

        assert_eq!(
            browser_use_pipe_path(&PathBuf::from("/Users/example/.brocode")),
            PathBuf::from("/Users/example/.brocode/browser-use.sock")
        );
    }

    #[test]
    fn repo_root_resolution_skips_apps_directory() {
        let repo_root = repo_root_from_manifest_dir();
        let manifest_dir = repo_root.join("apps/desktop-tauri/src-tauri");

        assert_eq!(
            resolve_repo_root_from_manifest_dir(&manifest_dir),
            Some(repo_root)
        );
    }

    #[test]
    fn runtime_root_prefers_bundled_server_when_available() {
        let temp_dir =
            std::env::temp_dir().join(format!("brocode-tauri-runtime-root-{}", std::process::id()));
        let server_dist = temp_dir.join(BUNDLED_RUNTIME_DIR).join("apps/server/dist");
        std::fs::create_dir_all(&server_dist).unwrap();
        std::fs::write(server_dist.join("index.mjs"), "").unwrap();

        assert_eq!(
            runtime_root(Some(temp_dir.clone())),
            temp_dir.join(BUNDLED_RUNTIME_DIR)
        );

        std::fs::remove_dir_all(temp_dir).unwrap();
    }
}
