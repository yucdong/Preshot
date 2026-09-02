use std::path::{Path, PathBuf};
use std::time::Duration;

use github_copilot_sdk::{
    install_bundled_cli, Client, ClientMode, ClientOptions, IndexMap, LogLevel, SessionConfig,
    Transport, HAS_BUNDLED_CLI,
};

pub const COPILOT_SDK_VERSION: &str = "1.0.11";
pub const COPILOT_CLI_RELEASE_VERSION: &str = "1.0.79";
pub const COPILOT_CLI_SELF_REPORTED_VERSION: &str = "1.0.81-7";
const HEALTH_MESSAGE: &str = "preshot-managed-cli-health";
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedCliPaths {
    pub base_directory: PathBuf,
    pub extract_directory: PathBuf,
    pub executable: PathBuf,
}

impl ManagedCliPaths {
    pub fn under(preshot_root: &Path) -> Self {
        let extract_directory = preshot_root
            .join("copilot")
            .join("bin")
            .join(COPILOT_CLI_RELEASE_VERSION);
        Self {
            base_directory: preshot_root.join("copilot"),
            executable: extract_directory.join(if cfg!(windows) {
                "copilot.exe"
            } else {
                "copilot"
            }),
            extract_directory,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedCliHealth {
    pub sdk_version: &'static str,
    pub cli_release_version: &'static str,
    pub executable: PathBuf,
    pub pid: u32,
    pub protocol_version: Option<u32>,
}

pub struct ManagedCopilotService {
    _keep_bundled_cli_linked: fn() -> Option<PathBuf>,
}

impl ManagedCopilotService {
    pub fn new() -> Self {
        Self {
            _keep_bundled_cli_linked: install_bundled_cli,
        }
    }

    pub fn client_options(
        &self,
        preshot_root: &Path,
        proxy_url: Option<&str>,
    ) -> Result<ClientOptions, String> {
        if !HAS_BUNDLED_CLI {
            return Err("github-copilot-sdk was built without the bundled CLI".to_string());
        }
        if std::env::var_os("COPILOT_CLI_PATH").is_some() {
            return Err(
                "COPILOT_CLI_PATH must be unset so the reviewed bundled CLI is used".to_string(),
            );
        }

        let paths = ManagedCliPaths::under(preshot_root);
        let mut environment = Vec::new();
        if let Some(proxy_url) = proxy_url {
            environment.push(("COPILOT_API_URL", proxy_url));
            environment.push(("COPILOT_DEBUG_GITHUB_API_URL", proxy_url));
        }

        Ok(ClientOptions::new()
            .with_mode(ClientMode::Empty)
            .with_transport(Transport::Stdio)
            .with_use_logged_in_user(false)
            .with_log_level(LogLevel::Warning)
            .with_enable_remote_sessions(false)
            .with_base_directory(paths.base_directory)
            .with_bundled_cli_extract_dir(paths.extract_directory)
            .with_cwd(preshot_root)
            .with_env(environment)
            .with_env_remove(["GH_TOKEN", "GITHUB_TOKEN", "COPILOT_SDK_AUTH_TOKEN"]))
    }

    pub async fn health_check(
        &self,
        preshot_root: &Path,
        proxy_url: Option<&str>,
    ) -> Result<ManagedCliHealth, String> {
        let paths = ManagedCliPaths::under(preshot_root);
        std::fs::create_dir_all(&paths.base_directory).map_err(|error| {
            format!(
                "failed to create Copilot base directory {}: {error}",
                paths.base_directory.display()
            )
        })?;
        std::fs::create_dir_all(&paths.extract_directory).map_err(|error| {
            format!(
                "failed to create Copilot CLI extraction directory {}: {error}",
                paths.extract_directory.display()
            )
        })?;

        let options = self.client_options(preshot_root, proxy_url)?;
        let client = Client::start(options)
            .await
            .map_err(|error| format!("failed to start managed Copilot CLI: {error}"))?;
        let pid = client
            .pid()
            .ok_or_else(|| "managed Copilot CLI did not expose a child process ID".to_string());
        let protocol_version = client.protocol_version();
        let health = client
            .ping(Some(HEALTH_MESSAGE))
            .await
            .map_err(|error| format!("managed Copilot CLI health check failed: {error}"));

        let stop = tokio::time::timeout(SHUTDOWN_TIMEOUT, client.stop()).await;
        match stop {
            Ok(Ok(())) if client.pid().is_none() => {}
            Ok(Ok(())) => {
                client.force_stop();
                return Err("managed Copilot CLI retained a child process after stop".to_string());
            }
            Ok(Err(error)) => {
                client.force_stop();
                return Err(format!("managed Copilot CLI shutdown failed: {error}"));
            }
            Err(_) => {
                client.force_stop();
                return Err(format!(
                    "managed Copilot CLI shutdown exceeded {} seconds",
                    SHUTDOWN_TIMEOUT.as_secs()
                ));
            }
        }

        let pid = pid?;
        health?;
        if !paths.executable.is_file() {
            return Err(format!(
                "bundled Copilot CLI was not extracted to {}",
                paths.executable.display()
            ));
        }

        Ok(ManagedCliHealth {
            sdk_version: COPILOT_SDK_VERSION,
            cli_release_version: COPILOT_CLI_RELEASE_VERSION,
            executable: paths.executable,
            pid,
            protocol_version,
        })
    }

    pub fn empty_session_config(&self) -> SessionConfig {
        SessionConfig::default()
            .with_available_tools(Vec::<String>::new())
            .with_mcp_servers(IndexMap::new())
            .with_enable_config_discovery(false)
            .with_skip_embedding_retrieval(true)
            .with_enable_on_demand_instruction_discovery(false)
            .with_enable_file_hooks(false)
            .with_enable_host_git_operations(false)
            .with_enable_session_store(false)
            .with_enable_skills(false)
            .with_enable_session_telemetry(false)
            .with_skip_custom_instructions(true)
            .with_custom_agents_local_only(true)
            .with_coauthor_enabled(false)
            .with_manage_schedule_enabled(false)
    }
}

impl Default for ManagedCopilotService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::{TcpStream, ToSocketAddrs};

    use super::*;

    const LOCAL_PROXY_URL: &str = "http://localhost:4141";

    #[test]
    fn managed_cli_contract_uses_bundled_stdio_and_isolated_paths() {
        let temp = tempfile::tempdir().expect("create temporary root");
        let preshot_root = temp.path().join(".preshot");
        let service = ManagedCopilotService::new();
        let options = service
            .client_options(&preshot_root, None)
            .expect("build managed CLI options");
        let paths = ManagedCliPaths::under(&preshot_root);

        assert!(HAS_BUNDLED_CLI);
        assert_eq!(options.mode, ClientMode::Empty);
        assert!(matches!(options.transport, Transport::Stdio));
        assert_eq!(options.use_logged_in_user, Some(false));
        assert_eq!(options.log_level, Some(LogLevel::Warning));
        assert!(!options.enable_remote_sessions);
        assert_eq!(
            options.base_directory.as_deref(),
            Some(paths.base_directory.as_path())
        );
        assert_eq!(
            options.bundled_cli_extract_dir.as_deref(),
            Some(paths.extract_directory.as_path())
        );
        assert_eq!(options.working_directory, preshot_root);
        assert!(options.env.is_empty());
        assert_eq!(
            options.env_remove,
            ["GH_TOKEN", "GITHUB_TOKEN", "COPILOT_SDK_AUTH_TOKEN"].map(std::ffi::OsString::from)
        );
    }

    #[test]
    fn empty_session_config_has_no_ambient_tools_or_discovery() {
        let config = ManagedCopilotService::new().empty_session_config();

        assert_eq!(config.available_tools, Some(Vec::new()));
        assert!(config.mcp_servers.as_ref().is_some_and(IndexMap::is_empty));
        assert_eq!(config.enable_config_discovery, Some(false));
        assert_eq!(config.skip_embedding_retrieval, Some(true));
        assert_eq!(config.enable_on_demand_instruction_discovery, Some(false));
        assert_eq!(config.enable_file_hooks, Some(false));
        assert_eq!(config.enable_host_git_operations, Some(false));
        assert_eq!(config.enable_session_store, Some(false));
        assert_eq!(config.enable_skills, Some(false));
        assert_eq!(config.enable_session_telemetry, Some(false));
        assert_eq!(config.skip_custom_instructions, Some(true));
        assert_eq!(config.custom_agents_local_only, Some(true));
        assert_eq!(config.coauthor_enabled, Some(false));
        assert_eq!(config.manage_schedule_enabled, Some(false));
        assert!(config.tools.is_none());
        assert!(config.custom_agents.is_none());
        assert!(config.skill_directories.is_none());
        assert!(config.instruction_directories.is_none());
        assert!(config.plugin_directories.is_none());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn managed_cli_extracts_health_checks_and_stops() {
        let temp = tempfile::tempdir().expect("create temporary root");
        let preshot_root = temp.path().join(".preshot");

        let report = ManagedCopilotService::new()
            .health_check(&preshot_root, None)
            .await
            .expect("managed CLI health check");

        assert_eq!(report.cli_release_version, COPILOT_CLI_RELEASE_VERSION);
        assert_eq!(report.sdk_version, COPILOT_SDK_VERSION);
        assert!(report.pid > 0);
        assert!(report.protocol_version.is_some());
        assert!(report.executable.is_file());
        assert!(report.executable.starts_with(&preshot_root));

        let version = std::process::Command::new(&report.executable)
            .arg("--version")
            .output()
            .expect("query extracted CLI version");
        assert!(version.status.success());
        assert!(
            String::from_utf8_lossy(&version.stdout).contains(COPILOT_CLI_SELF_REPORTED_VERSION)
        );
    }

    #[tokio::test(flavor = "current_thread")]
    #[ignore = "requires a local Copilot replay proxy listening on http://localhost:4141"]
    async fn managed_cli_local_proxy_smoke() {
        assert_http_ready(LOCAL_PROXY_URL).expect("local Copilot proxy readiness");
        let temp = tempfile::tempdir().expect("create temporary root");
        let preshot_root = temp.path().join(".preshot");

        ManagedCopilotService::new()
            .health_check(&preshot_root, Some(LOCAL_PROXY_URL))
            .await
            .expect("managed CLI local proxy smoke");
    }

    fn assert_http_ready(url: &str) -> Result<(), String> {
        let authority = url
            .strip_prefix("http://")
            .ok_or_else(|| format!("unsupported readiness URL: {url}"))?;
        let mut addresses = authority
            .to_socket_addrs()
            .map_err(|error| format!("failed to resolve {authority}: {error}"))?;
        let address = addresses
            .next()
            .ok_or_else(|| format!("no address resolved for {authority}"))?;
        let timeout = Duration::from_secs(2);
        let mut stream = TcpStream::connect_timeout(&address, timeout)
            .map_err(|error| format!("{url} is not accepting connections: {error}"))?;
        stream
            .set_read_timeout(Some(timeout))
            .map_err(|error| format!("failed to set readiness timeout: {error}"))?;
        stream
            .write_all(
                format!("GET / HTTP/1.1\r\nHost: {authority}\r\nConnection: close\r\n\r\n")
                    .as_bytes(),
            )
            .map_err(|error| format!("failed to write readiness request: {error}"))?;
        let mut response = [0_u8; 12];
        stream
            .read_exact(&mut response)
            .map_err(|error| format!("failed to read readiness response: {error}"))?;
        if !response.starts_with(b"HTTP/1.") {
            return Err(format!("{url} did not return an HTTP response"));
        }
        Ok(())
    }

    #[test]
    fn dependency_bundle_and_notice_contracts_stay_pinned() {
        let cargo = include_str!("../Cargo.toml");
        let lock = include_str!("../Cargo.lock");
        let tauri = include_str!("../tauri.conf.json");
        let notice = include_str!("../../THIRD_PARTY_NOTICES.md");
        let cache = include_str!("../../.cargo/config.toml");

        assert!(cargo.contains(
            "github-copilot-sdk = { version = \"=1.0.11\", default-features = false, features = [\"bundled-cli\"] }"
        ));
        assert!(!cargo.contains("bundled-in-process"));
        assert!(lock.contains("name = \"github-copilot-sdk\"\nversion = \"1.0.11\""));
        assert!(!lock.contains("C:\\projects\\copilot-sdk"));
        assert!(tauri.contains("GITHUB-COPILOT-CLI-LICENSE.md"));
        assert!(tauri.contains("GITHUB-COPILOT-SDK-MIT.txt"));
        assert!(tauri.contains("THIRD_PARTY_NOTICES.md"));
        assert!(notice.contains("GitHub Copilot CLI"));
        assert!(notice.contains("Release/archive and Windows file version: `1.0.79`"));
        assert!(notice.contains("Self-reported runtime version: `1.0.81-7`"));
        assert!(notice.contains("Windows x64 archive size: `100,644,089` bytes"));
        assert!(notice.contains("Unmodified `copilot.exe` size: `159,403,296` bytes"));
        assert!(notice.contains("ae87705442b502853374a58938ca48309b44ad1aef201e3de56b9ff89fe3b6bd"));
        assert!(cache.contains("BUNDLED_CLI_CACHE_DIR"));
    }
}
