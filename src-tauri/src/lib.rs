mod analysis;
mod analysis_session;
mod db;
mod hierarchy;
mod linter;
mod lsp;
mod project;

use analysis::{
    run_analysis_with_progress, AnalysisProgress, AnalysisResult, AnalysisRule, RuleSettingsMap,
};
use analysis_session::AnalysisSessionRegistry;
use db::{init_db, DbState};
use linter::{LinterInstallResult, LinterSettingsMap, LanguageLinterGroup};
use lsp::{LspInstallResult, LspServerStatus, LspSettingsMap};
use project::{scan_project, ProjectScan};
use tauri::ipc::Channel;

#[tauri::command]
fn get_analysis_rules() -> Vec<AnalysisRule> {
    analysis::default_rules()
}

#[tauri::command]
fn scan_project_dir(path: String) -> Result<ProjectScan, String> {
    scan_project(&path)
}

#[tauri::command]
async fn run_project_analysis(
    analysis_id: String,
    path: String,
    rules: Vec<String>,
    rule_settings: RuleSettingsMap,
    lsp_settings: LspSettingsMap,
    linter_settings: LinterSettingsMap,
    on_progress: Channel<AnalysisProgress>,
    registry: tauri::State<'_, AnalysisSessionRegistry>,
) -> Result<AnalysisResult, String> {
    let cancel = registry.register(analysis_id.clone());
    let progress_id = analysis_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_analysis_with_progress(
            &path,
            &rules,
            &rule_settings,
            &lsp_settings,
            &linter_settings,
            &cancel,
            &progress_id,
            move |progress| {
                let _ = on_progress.send(progress);
            },
        )
    })
    .await
    .map_err(|e| e.to_string())?;
    registry.unregister(&analysis_id);
    result
}

#[tauri::command]
fn cancel_project_analysis(
    analysis_id: String,
    registry: tauri::State<'_, AnalysisSessionRegistry>,
) -> bool {
    registry.cancel(&analysis_id)
}

#[tauri::command]
async fn list_language_linters() -> Vec<LanguageLinterGroup> {
    tauri::async_runtime::spawn_blocking(linter::list_language_linters)
        .await
        .unwrap_or_default()
}

#[tauri::command]
async fn install_linter(language_id: String, linter_id: String) -> Result<LinterInstallResult, String> {
    tauri::async_runtime::spawn_blocking(move || linter::install_linter(&language_id, &linter_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn read_project_file(project_root: String, relative_path: String) -> Result<String, String> {
    use std::path::PathBuf;
    let root = PathBuf::from(&project_root);
    let file = root.join(&relative_path);
    if !file.starts_with(&root) {
        return Err("Path escapes project root".into());
    }
    if !file.is_file() {
        return Err(format!("Not a file: {relative_path}"));
    }
    std::fs::read_to_string(&file).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_project_file(
    project_root: String,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    use std::path::PathBuf;
    let root = PathBuf::from(&project_root);
    let file = root.join(&relative_path);
    if !file.starts_with(&root) {
        return Err("Path escapes project root".into());
    }
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&file, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_lsp_servers() -> Vec<LspServerStatus> {
    tauri::async_runtime::spawn_blocking(lsp::list_lsp_servers)
        .await
        .unwrap_or_default()
}

#[tauri::command]
async fn install_lsp_server(id: String) -> Result<LspInstallResult, String> {
    tauri::async_runtime::spawn_blocking(move || lsp::install_lsp_server(&id))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = init_db().expect("failed to initialize database");
    tauri::Builder::default()
        .manage(DbState(std::sync::Mutex::new(conn)))
        .manage(AnalysisSessionRegistry::new())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_analysis_rules,
            scan_project_dir,
            run_project_analysis,
            cancel_project_analysis,
            read_project_file,
            write_project_file,
            list_lsp_servers,
            install_lsp_server,
            list_language_linters,
            install_linter,
            db::load_persisted_state,
            db::save_persisted_state,
            db::get_db_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
