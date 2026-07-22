use std::sync::Arc;

use serde_json::Value;
use tauri::State;
use tauri::ipc::Response;

use crate::error::StudioResult;
use crate::model::{ConfigureRequest, DesktopStatus};
use crate::service::StudioService;

async fn blocking<T: Send + 'static>(
    operation: impl FnOnce() -> StudioResult<T> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|reason| reason.to_string())?
        .map_err(|reason| reason.to_string())
}

#[tauri::command]
pub async fn studio_status(
    service: State<'_, Arc<StudioService>>,
) -> Result<DesktopStatus, String> {
    let service = Arc::clone(service.inner());
    blocking(move || Ok(service.status())).await
}

#[tauri::command]
pub async fn studio_configure(
    service: State<'_, Arc<StudioService>>,
    request: ConfigureRequest,
) -> Result<DesktopStatus, String> {
    let service = Arc::clone(service.inner());
    blocking(move || service.configure(request)).await
}

macro_rules! value_command {
    ($name:ident, $method:ident) => {
        #[tauri::command]
        pub async fn $name(service: State<'_, Arc<StudioService>>) -> Result<Value, String> {
            let service = Arc::clone(service.inner());
            blocking(move || service.$method()).await
        }
    };
    ($name:ident, $method:ident, value) => {
        #[tauri::command]
        pub async fn $name(
            service: State<'_, Arc<StudioService>>,
            request: Value,
        ) -> Result<Value, String> {
            let service = Arc::clone(service.inner());
            blocking(move || service.$method(request)).await
        }
    };
    ($name:ident, $method:ident, text) => {
        #[tauri::command]
        pub async fn $name(
            service: State<'_, Arc<StudioService>>,
            value: String,
        ) -> Result<Value, String> {
            let service = Arc::clone(service.inner());
            blocking(move || service.$method(&value)).await
        }
    };
}

value_command!(studio_catalog, catalog);
value_command!(studio_executors, executors);
value_command!(studio_projects, projects);
value_command!(studio_load_project, load_project, text);
value_command!(studio_save_project, save_project, value);
value_command!(studio_export_project, export_project, value);
value_command!(studio_import_project, import_project, value);
value_command!(studio_import_assets, import_assets, value);
value_command!(studio_check, check, value);
value_command!(studio_compare_preflight, compare_preflight, value);
value_command!(studio_compile_program, compile_program, value);
value_command!(studio_templates, templates);
value_command!(studio_load_template, load_template, text);
value_command!(studio_publish_template, publish_template, value);
value_command!(studio_inspect_comfy, inspect_comfy, value);
value_command!(studio_import_comfy, import_comfy, value);
value_command!(studio_list_runs, list_runs);
value_command!(studio_inspect_run, inspect_run, text);
value_command!(studio_cancel_run, cancel_run, text);
value_command!(studio_fetch_run, fetch_run, value);
value_command!(studio_retry_run, retry_run, text);
value_command!(studio_model_preflight, model_preflight, value);
value_command!(studio_inspect_model_pull, inspect_model_pull, text);

#[tauri::command]
pub async fn studio_model_pull(
    service: State<'_, Arc<StudioService>>,
    request: Value,
) -> Result<Value, String> {
    let service = Arc::clone(service.inner());
    blocking(move || service.start_model_pull(request)).await
}

#[tauri::command]
pub async fn studio_start_run(
    service: State<'_, Arc<StudioService>>,
    request: Value,
) -> Result<Value, String> {
    let service = Arc::clone(service.inner());
    blocking(move || service.start_run(request)).await
}

#[tauri::command]
pub async fn studio_resume_run(
    service: State<'_, Arc<StudioService>>,
    value: String,
) -> Result<Value, String> {
    let service = Arc::clone(service.inner());
    blocking(move || service.resume_run(&value)).await
}

#[tauri::command]
pub fn studio_artifact(
    service: State<'_, Arc<StudioService>>,
    id: String,
    path: String,
) -> Result<Response, String> {
    service
        .artifact_bytes(&id, &path)
        .map(Response::new)
        .map_err(|reason| reason.to_string())
}

#[tauri::command]
pub fn studio_input_asset(
    service: State<'_, Arc<StudioService>>,
    path: String,
) -> Result<Response, String> {
    service
        .input_asset_bytes(&path)
        .map(Response::new)
        .map_err(|reason| reason.to_string())
}
