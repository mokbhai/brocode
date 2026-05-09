use std::{
    fmt,
    path::PathBuf,
    process::{ExitStatus, Stdio},
    sync::Arc,
    time::Duration,
};

#[cfg(unix)]
use std::os::unix::process::ExitStatusExt;

use tokio::{
    process::{Child, Command},
    sync::Mutex,
    time::{sleep, timeout, Instant},
};

const READINESS_TIMEOUT: Duration = Duration::from_secs(30);
const READINESS_INTERVAL: Duration = Duration::from_millis(200);
const READINESS_REQUEST_TIMEOUT: Duration = Duration::from_secs(2);
const SHUTDOWN_GRACE_PERIOD: Duration = Duration::from_secs(3);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BackendConfig {
    pub port: u16,
    pub host: String,
    pub home_dir: PathBuf,
    pub repo_root: PathBuf,
}

impl BackendConfig {
    pub fn http_url(&self) -> String {
        format!("http://{}:{}", self.host, self.port)
    }

    pub fn ws_url(&self) -> String {
        format!("ws://{}:{}", self.host, self.port)
    }

    fn health_url(&self) -> String {
        format!("{}/health", self.http_url())
    }
}

#[derive(Clone, Default)]
pub struct BackendState {
    inner: Arc<Mutex<BackendInner>>,
}

#[derive(Default)]
struct BackendInner {
    child: Option<Child>,
    ws_url: Option<String>,
}

#[derive(Debug, Eq, PartialEq)]
struct BackendCommandSpec {
    current_dir: PathBuf,
    args: [&'static str; 4],
}

impl BackendState {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn ws_url(&self) -> Option<String> {
        self.inner.lock().await.ws_url.clone()
    }
}

#[derive(Debug)]
pub enum BackendError {
    ChildExitedEarly { status: String },
    ChildMissingDuringStartup,
    Io(std::io::Error),
    ReadinessTimeout { url: String },
}

impl fmt::Display for BackendError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ChildExitedEarly { status } => {
                write!(f, "backend exited before readiness: {status}")
            }
            Self::ChildMissingDuringStartup => {
                write!(f, "backend process disappeared before readiness")
            }
            Self::Io(error) => write!(f, "{error}"),
            Self::ReadinessTimeout { url } => {
                write!(f, "backend did not become ready at {url} within 30s")
            }
        }
    }
}

impl std::error::Error for BackendError {}

impl From<std::io::Error> for BackendError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

pub async fn start_backend(state: BackendState, config: BackendConfig) -> Result<(), BackendError> {
    {
        let mut inner = state.inner.lock().await;
        if inner.child.is_some() {
            return Ok(());
        }

        let home_dir = config.home_dir.to_string_lossy().to_string();
        let command_spec = backend_command_spec(&config);
        let mut command = Command::new("bun");
        command
            .args(command_spec.args)
            .current_dir(command_spec.current_dir)
            .env("T3CODE_MODE", "desktop")
            .env("T3CODE_HOST", &config.host)
            .env("T3CODE_PORT", config.port.to_string())
            .env("T3CODE_HOME", &home_dir)
            .env("DPCODE_HOME", &home_dir)
            .env("T3CODE_NO_BROWSER", "1")
            .env_remove("T3CODE_AUTH_TOKEN")
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit());

        prepare_backend_command(&mut command);
        let child = command.spawn()?;

        inner.child = Some(child);
        inner.ws_url = None;
    }

    let health_url = config.health_url();
    if let Err(error) = wait_for_http_ready(&state, &health_url).await {
        let child = {
            let mut inner = state.inner.lock().await;
            inner.ws_url = None;
            inner.child.take()
        };

        if let Some(child) = child {
            stop_child(child).await?;
        }

        return Err(error);
    }

    let mut inner = state.inner.lock().await;
    if inner.child.is_some() {
        inner.ws_url = Some(config.ws_url());
    }

    Ok(())
}

pub async fn stop_backend(state: BackendState) -> Result<(), BackendError> {
    let child = {
        let mut inner = state.inner.lock().await;
        inner.ws_url = None;
        inner.child.take()
    };

    if let Some(child) = child {
        stop_child(child).await?;
    }

    Ok(())
}

fn backend_command_spec(config: &BackendConfig) -> BackendCommandSpec {
    BackendCommandSpec {
        current_dir: config.repo_root.clone(),
        args: ["run", "--cwd", "apps/server", "dev"],
    }
}

#[cfg(unix)]
fn prepare_backend_command(command: &mut Command) {
    unsafe {
        command.pre_exec(|| {
            if libc::setpgid(0, 0) == -1 {
                return Err(std::io::Error::last_os_error());
            }

            Ok(())
        });
    }
}

#[cfg(not(unix))]
fn prepare_backend_command(_command: &mut Command) {}

async fn stop_child(mut child: Child) -> Result<(), BackendError> {
    if let Some(_) = child.try_wait()? {
        return Ok(());
    }

    terminate_child(&mut child)?;

    match timeout(SHUTDOWN_GRACE_PERIOD, child.wait()).await {
        Ok(result) => {
            result?;
        }
        Err(_) => {
            kill_child(&mut child)?;
            child.wait().await?;
        }
    }

    Ok(())
}

#[cfg(unix)]
fn terminate_child(child: &mut Child) -> Result<(), BackendError> {
    signal_child_process_group(child, libc::SIGTERM)
}

#[cfg(unix)]
fn kill_child(child: &mut Child) -> Result<(), BackendError> {
    signal_child_process_group(child, libc::SIGKILL)
}

#[cfg(unix)]
fn signal_child_process_group(child: &mut Child, signal: libc::c_int) -> Result<(), BackendError> {
    let Some(child_id) = child.id() else {
        return Ok(());
    };
    let process_group_id = -(child_id as libc::pid_t);
    let result = unsafe { libc::kill(process_group_id, signal) };

    if result == -1 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() != Some(libc::ESRCH) {
            return Err(error.into());
        }
    }

    Ok(())
}

#[cfg(not(unix))]
fn terminate_child(child: &mut Child) -> Result<(), BackendError> {
    child.start_kill()?;
    Ok(())
}

#[cfg(not(unix))]
fn kill_child(child: &mut Child) -> Result<(), BackendError> {
    child.start_kill()?;
    Ok(())
}

async fn wait_for_http_ready(state: &BackendState, url: &str) -> Result<(), BackendError> {
    let deadline = Instant::now() + READINESS_TIMEOUT;
    let client = reqwest::Client::builder()
        .timeout(READINESS_REQUEST_TIMEOUT)
        .build()
        .map_err(std::io::Error::other)?;

    loop {
        ensure_child_running(state).await?;

        if let Ok(response) = client.get(url).send().await {
            let is_ready = response.status().is_success()
                && health_response_is_ready(
                    response
                        .text()
                        .await
                        .ok()
                        .and_then(|body| serde_json::from_str::<serde_json::Value>(&body).ok())
                        .as_ref(),
                );
            if is_ready {
                ensure_child_running(state).await?;
                return Ok(());
            }
        }

        ensure_child_running(state).await?;

        if Instant::now() >= deadline {
            return Err(BackendError::ReadinessTimeout {
                url: url.to_string(),
            });
        }

        sleep(READINESS_INTERVAL).await;
    }
}

async fn ensure_child_running(state: &BackendState) -> Result<(), BackendError> {
    let mut inner = state.inner.lock().await;
    let Some(child) = inner.child.as_mut() else {
        return Err(BackendError::ChildMissingDuringStartup);
    };

    if let Some(status) = child.try_wait()? {
        return Err(BackendError::ChildExitedEarly {
            status: exit_status_message(status),
        });
    }

    Ok(())
}

fn exit_status_message(status: ExitStatus) -> String {
    #[cfg(unix)]
    if let Some(signal) = status.signal() {
        return format!("signal {signal}");
    }

    status.to_string()
}

fn health_response_is_ready(value: Option<&serde_json::Value>) -> bool {
    value
        .and_then(serde_json::Value::as_object)
        .is_some_and(|object| {
            object.get("status").and_then(serde_json::Value::as_str) == Some("ok")
                && object
                    .get("startupReady")
                    .and_then(serde_json::Value::as_bool)
                    == Some(true)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn backend_config_builds_http_and_ws_urls() {
        let config = BackendConfig {
            port: 58090,
            host: "127.0.0.1".to_string(),
            home_dir: PathBuf::from(".dpcode-tauri-dev"),
            repo_root: PathBuf::from("."),
        };

        assert_eq!(config.http_url(), "http://127.0.0.1:58090");
        assert_eq!(config.ws_url(), "ws://127.0.0.1:58090");
        assert_eq!(config.health_url(), "http://127.0.0.1:58090/health");
    }

    #[test]
    fn backend_state_starts_without_ws_url() {
        let runtime = tokio::runtime::Runtime::new().expect("create test runtime");
        let state = BackendState::new();

        assert_eq!(runtime.block_on(state.ws_url()), None);
    }

    #[test]
    fn backend_command_uses_repo_root_and_server_workspace() {
        let config = BackendConfig {
            port: 58090,
            host: "127.0.0.1".to_string(),
            home_dir: PathBuf::from("/tmp/dpcode-home"),
            repo_root: PathBuf::from("/tmp/dpcode"),
        };

        let command = backend_command_spec(&config);

        assert_eq!(command.current_dir, PathBuf::from("/tmp/dpcode"));
        assert_eq!(command.args, ["run", "--cwd", "apps/server", "dev"]);
    }

    #[test]
    fn health_response_requires_ok_status_and_startup_ready() {
        let ready = serde_json::json!({
            "status": "ok",
            "startupReady": true,
            "pushBusReady": true
        });
        let starting = serde_json::json!({
            "status": "ok",
            "startupReady": false,
            "pushBusReady": true
        });
        let wrong_server = serde_json::json!({
            "status": "ok"
        });

        assert!(health_response_is_ready(Some(&ready)));
        assert!(!health_response_is_ready(Some(&starting)));
        assert!(!health_response_is_ready(Some(&wrong_server)));
        assert!(!health_response_is_ready(None));
    }

    #[cfg(unix)]
    #[test]
    fn ensure_child_running_detects_exited_child() {
        let runtime = tokio::runtime::Runtime::new().expect("create test runtime");

        runtime.block_on(async {
            let state = BackendState::new();
            let child = Command::new("sh")
                .arg("-c")
                .arg("exit 7")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("spawn short-lived child");

            state.inner.lock().await.child = Some(child);
            sleep(Duration::from_millis(50)).await;

            let error = ensure_child_running(&state)
                .await
                .expect_err("child should have exited");

            assert!(matches!(error, BackendError::ChildExitedEarly { .. }));
        });
    }
}
