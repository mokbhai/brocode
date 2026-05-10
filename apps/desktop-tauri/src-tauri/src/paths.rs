use std::path::{Path, PathBuf};

pub fn repo_root_from_manifest_dir() -> PathBuf {
    resolve_repo_root_from_manifest_dir(&PathBuf::from(env!("CARGO_MANIFEST_DIR")))
        .expect("src-tauri should live under the BroCode repository")
}

pub fn default_dev_home(repo_root: &Path) -> PathBuf {
    repo_root.join(".brocode-tauri-dev")
}

fn resolve_repo_root_from_manifest_dir(manifest_dir: &Path) -> Option<PathBuf> {
    manifest_dir
        .ancestors()
        .find(|candidate| {
            candidate.join("package.json").is_file()
                && candidate.join("apps/server/package.json").is_file()
        })
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
    fn repo_root_contains_workspace_markers() {
        let repo_root = repo_root_from_manifest_dir();

        assert!(repo_root.join("package.json").is_file());
        assert!(repo_root.join("apps/server/package.json").is_file());
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
}
