mod commands;
mod error;
mod model;
mod service;
#[cfg(target_os = "macos")]
mod sparkle;

use std::sync::Arc;

use tauri::Manager;

use commands::*;
use service::StudioService;

/// Exercise the packaged host's normal local service in an isolated app-data directory.
pub fn verify_local_package(
    runtime: std::path::PathBuf,
    app_data: std::path::PathBuf,
) -> Result<serde_json::Value, String> {
    let service =
        Arc::new(StudioService::new(app_data.clone()).map_err(|reason| reason.to_string())?);
    let status = service
        .configure(model::ConfigureRequest {
            workspace: app_data.join("workspace").display().to_string(),
            mere_run_command: runtime.display().to_string(),
            workflow_tools_command: String::new(),
            onboarding_complete: true,
        })
        .map_err(|reason| reason.to_string())?;
    if !status.mere_run.available {
        return Err(status
            .mere_run
            .error
            .unwrap_or_else(|| "Runtime is unavailable".to_owned()));
    }
    service.verify_local().map_err(|reason| reason.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            sparkle::install(app)?;
            let app_data = app.path().app_data_dir()?;
            let service = StudioService::new(app_data)
                .map_err(|reason| Box::<dyn std::error::Error>::from(reason.to_string()))?;
            app.manage(Arc::new(service));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            studio_status,
            studio_configure,
            studio_catalog,
            studio_discover_tools,
            studio_open_runtime_downloads,
            studio_plugins,
            studio_setup_plugin,
            studio_verify_local,
            studio_executors,
            studio_models,
            studio_executor_probe,
            studio_projects,
            studio_load_project,
            studio_save_project,
            studio_export_project,
            studio_import_project,
            studio_import_assets,
            studio_import_run_artifact,
            studio_check,
            studio_compare_preflight,
            studio_compile_program,
            studio_templates,
            studio_load_template,
            studio_publish_template,
            studio_inspect_comfy,
            studio_import_comfy,
            studio_start_run,
            studio_list_runs,
            studio_inspect_run,
            studio_cancel_run,
            studio_fetch_run,
            studio_retry_run,
            studio_resume_run,
            studio_model_preflight,
            studio_model_pull,
            studio_inspect_model_pull,
            studio_artifact,
            studio_input_asset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Mere Graph Studio");
}
