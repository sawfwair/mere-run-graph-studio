use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CONFIG_SCHEMA_VERSION: u32 = 1;
pub const PROJECT_PACKAGE_CONTRACT: &str = "mere.run/graph-studio-project.v1";
pub const SIDECAR_KIND: &str = "mere.run/workflow-editor";
pub const MAX_DIAGNOSTIC_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AppConfig {
    pub schema_version: u32,
    pub onboarding_complete: bool,
    pub workspace: PathBuf,
    pub mere_run_command: Option<PathBuf>,
    pub workflow_tools_command: Option<PathBuf>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ConfigureRequest {
    pub workspace: String,
    pub mere_run_command: String,
    #[serde(default)]
    pub workflow_tools_command: String,
    #[serde(default = "default_true")]
    pub onboarding_complete: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, Serialize)]
pub struct CommandStatus {
    pub path: Option<String>,
    pub available: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct DesktopStatus {
    pub app_version: String,
    pub platform: String,
    pub architecture: String,
    pub config_path: String,
    pub workspace: String,
    pub onboarding_complete: bool,
    pub mere_run: CommandStatus,
    pub workflow_tools: CommandStatus,
}

#[derive(Clone, Debug)]
pub struct CommandResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

impl CommandResult {
    pub fn document(&self) -> Value {
        let parsed = if self.stdout.trim().is_empty() {
            None
        } else {
            serde_json::from_str::<Value>(&self.stdout).ok()
        };
        serde_json::json!({
            "exit_code": self.exit_code,
            "result": parsed.clone().unwrap_or(Value::Null),
            "stdout": if parsed.is_some() { String::new() } else { tail(&self.stdout, MAX_DIAGNOSTIC_BYTES) },
            "stderr": tail(&self.stderr, MAX_DIAGNOSTIC_BYTES),
        })
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct StudioRun {
    pub id: String,
    pub executor: String,
    pub run_directory: PathBuf,
    pub graph_path: PathBuf,
    pub inputs_path: PathBuf,
    pub state: String,
    pub created_at: String,
    pub updated_at: String,
    pub exit_code: Option<i32>,
    pub result: Value,
    pub stderr: String,
    pub remote_reference: Option<String>,
    pub history: Vec<Value>,
}

/// In-progress or completed local model installation, tracked in memory and
/// polled by the frontend. `mere.run model pull` streams human-readable
/// progress on stderr (there is no `--json` for a live pull), so the host reads
/// those lines and distils them into this record.
#[derive(Clone, Debug, Serialize)]
pub struct ModelPull {
    pub model: String,
    /// preparing | downloading | installing | installed | failed
    pub state: String,
    pub percent: Option<f64>,
    pub received_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub detail: Option<String>,
    pub install_path: Option<String>,
    pub stderr: String,
    pub updated_at: String,
}

impl ModelPull {
    pub fn preparing(model: &str, updated_at: String) -> Self {
        Self {
            model: model.to_owned(),
            state: "preparing".to_owned(),
            percent: None,
            received_bytes: None,
            total_bytes: None,
            detail: None,
            install_path: None,
            stderr: String::new(),
            updated_at,
        }
    }

    pub fn is_active(&self) -> bool {
        matches!(
            self.state.as_str(),
            "preparing" | "downloading" | "installing"
        )
    }
}

pub fn tail(value: &str, limit: usize) -> String {
    if value.len() <= limit {
        return value.to_owned();
    }
    let mut start = value.len() - limit;
    while !value.is_char_boundary(start) {
        start += 1;
    }
    value[start..].to_owned()
}

pub fn synthetic_document(result: Value) -> Value {
    serde_json::json!({
        "exit_code": 0,
        "result": result,
        "stdout": "",
        "stderr": "",
    })
}
