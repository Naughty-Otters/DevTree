mod analysis;
mod db;
mod hierarchy;
mod project;

use analysis::{run_analysis_with_progress, AnalysisProgress, AnalysisResult, AnalysisRule};
use db::{init_db, DbState};
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
    path: String,
    rules: Vec<String>,
    on_progress: Channel<AnalysisProgress>,
) -> Result<AnalysisResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_analysis_with_progress(&path, &rules, |progress| {
            let _ = on_progress.send(progress);
        })
    })
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = init_db().expect("failed to initialize database");
    tauri::Builder::default()
        .manage(DbState(std::sync::Mutex::new(conn)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_analysis_rules,
            scan_project_dir,
            run_project_analysis,
            read_project_file,
            db::load_persisted_state,
            db::save_persisted_state,
            db::get_db_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
