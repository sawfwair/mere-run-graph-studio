mod commands;
mod error;
mod model;
mod service;

use std::sync::Arc;

use tauri::Manager;

use commands::*;
use service::StudioService;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
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
            studio_executors,
            studio_projects,
            studio_load_project,
            studio_save_project,
            studio_export_project,
            studio_import_project,
            studio_import_assets,
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
