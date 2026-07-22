use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use std::time::Duration;

use chrono::{DateTime, Utc};
use regex::Regex;
use serde_json::{Map, Value, json};
use tempfile::NamedTempFile;
use uuid::Uuid;
use walkdir::WalkDir;

use crate::error::{StudioResult, error};
use crate::model::{
    AppConfig, CONFIG_SCHEMA_VERSION, CommandResult, CommandStatus, ConfigureRequest,
    DesktopStatus, MAX_DIAGNOSTIC_BYTES, ModelPull, PROJECT_PACKAGE_CONTRACT, SIDECAR_KIND,
    StudioRun, synthetic_document, tail,
};

const MAX_PROJECTS: usize = 250;
const MAX_PREFLIGHT_EXECUTORS: usize = 16;
const MAX_IMPORTED_ASSETS: usize = 64;

pub struct StudioService {
    config_path: PathBuf,
    config: RwLock<AppConfig>,
    runs: Mutex<HashMap<String, StudioRun>>,
    processes: Mutex<HashMap<String, Arc<Mutex<Child>>>>,
    model_pulls: Mutex<HashMap<String, ModelPull>>,
}

include!("service_projects.rs");
include!("service_support.rs");

include!("service_tools.rs");

include!("service_runs.rs");

include!("service_run_support.rs");
#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_graph() -> Value {
        json!({
            "schema_version": 1,
            "kind": "mere.run/workflow-graph",
            "name": "fixture",
            "inputs": {},
            "nodes": [],
            "outputs": {},
        })
    }

    #[test]
    fn local_project_contract_needs_no_identity_or_network() {
        let root = tempfile::tempdir().expect("temporary app data");
        let service = StudioService::new(root.path().to_path_buf()).expect("service");
        let config = ConfigureRequest {
            workspace: root.path().join("workspace").display().to_string(),
            mere_run_command: std::env::current_exe()
                .expect("test executable")
                .display()
                .to_string(),
            workflow_tools_command: String::new(),
            onboarding_complete: true,
        };
        let status = service.configure(config).expect("configure");
        assert!(status.onboarding_complete);
        assert_eq!(
            status.workspace,
            root.path()
                .join("workspace")
                .canonicalize()
                .expect("workspace")
                .display()
                .to_string()
        );
        service
            .save_project(json!({
                "path": "workflows/fixture",
                "graph": fixture_graph(),
                "inputs": { "prompt": "portable" },
                "sidecar": default_sidecar(),
            }))
            .expect("save project");
        let project = service
            .load_project("workflows/fixture")
            .expect("load project");
        assert_eq!(project["graph"], fixture_graph());
        assert_eq!(project["inputs"], json!({ "prompt": "portable" }));
        assert!(project["graph"].get("viewport").is_none());
    }

    #[test]
    fn project_package_round_trips_through_the_native_contract() {
        let root = tempfile::tempdir().expect("temporary app data");
        let service = StudioService::new(root.path().to_path_buf()).expect("service");
        let document = json!({
            "graph": fixture_graph(),
            "inputs": { "prompt": "portable" },
            "sidecar": default_sidecar(),
        });

        let package = service
            .export_project(document.clone())
            .expect("export project");
        assert_eq!(
            package["contract_version"],
            Value::String(PROJECT_PACKAGE_CONTRACT.to_owned())
        );
        assert_eq!(
            service.import_project(package).expect("import project"),
            document
        );
        assert!(
            service
                .import_project(json!({
                    "contract_version": "unsupported",
                    "graph": fixture_graph(),
                    "inputs": {},
                    "sidecar": default_sidecar(),
                }))
                .is_err()
        );
    }

    #[test]
    fn dropped_assets_are_copied_into_the_workspace_and_read_back_safely() {
        let root = tempfile::tempdir().expect("temporary app data");
        let source = root.path().join("hero image.png");
        fs::write(&source, b"portable-image").expect("source asset");
        let service = StudioService::new(root.path().join("app-data")).expect("service");
        service
            .configure(ConfigureRequest {
                workspace: root.path().join("workspace").display().to_string(),
                mere_run_command: std::env::current_exe()
                    .expect("test executable")
                    .display()
                    .to_string(),
                workflow_tools_command: String::new(),
                onboarding_complete: true,
            })
            .expect("configure");

        let imported = service
            .import_assets(json!({ "paths": [source.display().to_string()] }))
            .expect("import");
        let path = imported["assets"][0]["path"]
            .as_str()
            .expect("relative path");
        assert!(path.starts_with("assets/"));
        assert_eq!(imported["assets"][0]["content_type"], "image/png");
        assert_eq!(
            service.input_asset_bytes(path).expect("asset bytes"),
            b"portable-image"
        );
        assert!(service.input_asset_bytes("../hero image.png").is_err());
    }

    #[test]
    fn rejects_escape_paths_and_undeclared_artifact_references() {
        assert!(validate_relative_path("../escape", "project").is_err());
        assert!(validate_relative_path("workflows/valid", "project").is_ok());
        assert!(validate_artifact_path("../secret").is_err());
        assert!(validate_artifact_path("outputs/image.png").is_ok());
    }

    #[test]
    fn discovers_nested_remote_references_and_states() {
        let document =
            json!({ "nested": [{ "reference": "relay://fleet/job-1", "state": "queued" }] });
        assert_eq!(
            find_remote_reference(&document),
            Some("relay://fleet/job-1")
        );
        assert_eq!(find_run_state(&document), Some("queued"));
    }

    #[test]
    fn parses_download_progress_line() {
        let progress =
            parse_pull_progress("[image-zimage-nano] 45%  120 MB / 260 MB  30 MB/s  ETA 5s");
        assert_eq!(progress.percent, Some(45.0));
        assert_eq!(progress.received_bytes, Some(120 * 1024 * 1024));
        assert_eq!(progress.total_bytes, Some(260 * 1024 * 1024));
        assert!(!progress.installing);
    }

    #[test]
    fn recognises_extract_phase_as_installing() {
        let progress = parse_pull_progress("Extracting model weights…");
        assert!(progress.installing);
        assert_eq!(progress.percent, None);
    }

    #[test]
    fn parses_binary_byte_units() {
        assert_eq!(parse_byte_size("2", "GiB"), Some(2 * 1024 * 1024 * 1024));
        assert_eq!(parse_byte_size("512", "B"), Some(512));
        assert_eq!(
            parse_byte_size("1.5", "MB"),
            Some((1.5 * 1024.0 * 1024.0) as u64)
        );
        assert_eq!(parse_byte_size("3", "furlongs"), None);
    }

    #[test]
    fn validates_model_ids() {
        assert!(validate_model_id("image-krea2-raw").is_ok());
        assert!(validate_model_id("video-ltx-av").is_ok());
        assert!(validate_model_id("Image-Bad").is_err());
        assert!(validate_model_id("has space").is_err());
        assert!(validate_model_id("").is_err());
    }
}
