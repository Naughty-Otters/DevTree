mod agent;
mod analysis;
mod analysis_cache;
mod analysis_session;
mod db;
mod design_rules;
mod dsm;
mod git_metrics;
mod hierarchy;
mod quality;
mod linter;
mod lsp;
mod project;
mod schedule;
#[cfg(target_os = "macos")]
mod tray;

use agent::ai_validation::{AiValidationRuntimeSettings, LlmConfigurations};
use analysis::{
    load_cached_hierarchy_lite, load_cached_quality_files, run_analysis_with_progress,
    slim_analysis_for_ipc, AnalysisProgress, AnalysisResult, AnalysisRule, RuleSettingsMap,
};
use agent::{cancel_agent_run, list_agent_skills, list_llm_provider_models, list_llm_providers, run_agent_skill};
use agent::types::{AgentEvent, AgentRunRequest, AgentRunResult, AgentSkillInfo, LlmProvider, LlmProviderInfo};
use analysis_session::AnalysisSessionRegistry;
use db::{init_db, DbState};
use dsm::{compute_dsm, DsmOptions, DsmResult};
use design_rules::DesignRule;
use hierarchy::HierarchyIndex;
use linter::{LinterInstallResult, LinterSettingsMap, LanguageLinterGroup};
use lsp::{LspInstallResult, LspServerStatus, LspSettingsMap};
use project::{list_project_children, scan_project, ProjectScan, TreeEntry};
use schedule::AnalysisTriggerState;
use tauri::ipc::Channel;

#[tauri::command]
fn get_analysis_rules() -> Vec<AnalysisRule> {
    analysis::default_rules()
}

#[tauri::command]
async fn scan_project_dir(path: String) -> Result<ProjectScan, String> {
    tauri::async_runtime::spawn_blocking(move || scan_project(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_project_children_cmd(
    path: String,
    relative_path: String,
) -> Result<Vec<TreeEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || list_project_children(&path, &relative_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn run_project_analysis(
    analysis_id: String,
    path: String,
    rules: Vec<String>,
    rule_settings: RuleSettingsMap,
    lsp_settings: LspSettingsMap,
    linter_settings: LinterSettingsMap,
    llm_configurations: LlmConfigurations,
    ai_validation_runtime: AiValidationRuntimeSettings,
    design_rules: Option<Vec<DesignRule>>,
    on_progress: Channel<AnalysisProgress>,
    registry: tauri::State<'_, AnalysisSessionRegistry>,
) -> Result<AnalysisResult, String> {
    let cancel = registry.register(analysis_id.clone());
    let progress_id = analysis_id.clone();
    let design_rules = design_rules.unwrap_or_default();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let full = run_analysis_with_progress(
            &path,
            &rules,
            &rule_settings,
            &lsp_settings,
            &linter_settings,
            &llm_configurations,
            &ai_validation_runtime.normalized(),
            &design_rules,
            &cancel,
            &progress_id,
            move |progress| {
                let _ = on_progress.send(progress);
            },
        )?;
        // Persist slim cache/files before IPC; never fail the run if disk is read-only.
        if let Err(err) = analysis::persist_analysis_result(&path, &full) {
            eprintln!("[devtree] persist analysis cache failed: {err}");
        }
        // Hierarchy/quality on disk — do not push them through Tauri IPC.
        Ok(slim_analysis_for_ipc(full))
    })
    .await
    .map_err(|e| e.to_string())?;
    registry.unregister(&analysis_id);
    // Reclaim space from legacy multi-hundred-MB SQLite blobs (off the UI path).
    tauri::async_runtime::spawn_blocking(|| {
        if let Ok(path) = db::db_path() {
            if let Ok(meta) = std::fs::metadata(path) {
                if meta.len() > 32 * 1024 * 1024 {
                    let _ = db::vacuum_db();
                }
            }
        }
    });
    result
}

#[tauri::command]
async fn load_analysis_hierarchy_lite(path: String) -> Result<HierarchyIndex, String> {
    tauri::async_runtime::spawn_blocking(move || load_cached_hierarchy_lite(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn load_analysis_quality_files(
    path: String,
) -> Result<std::collections::HashMap<String, devtree_core::FileQualityMetrics>, String> {
    tauri::async_runtime::spawn_blocking(move || load_cached_quality_files(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_agent_skills() -> Vec<AgentSkillInfo> {
    list_agent_skills()
}

#[tauri::command]
fn get_llm_providers() -> Vec<LlmProviderInfo> {
    list_llm_providers()
}

#[tauri::command]
async fn list_llm_models(provider: LlmProvider, api_key: String) -> Result<Vec<String>, String> {
    list_llm_provider_models(provider, api_key).await
}

#[tauri::command]
async fn run_agent_skill_command(
    request: AgentRunRequest,
    on_event: Channel<AgentEvent>,
    registry: tauri::State<'_, AnalysisSessionRegistry>,
) -> Result<AgentRunResult, String> {
    run_agent_skill(request, on_event, registry).await
}

#[tauri::command]
fn cancel_agent_run_command(
    run_id: String,
    registry: tauri::State<'_, AnalysisSessionRegistry>,
) -> bool {
    cancel_agent_run(run_id, registry)
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
fn compute_project_dsm(hierarchy: HierarchyIndex, options: DsmOptions) -> DsmResult {
    compute_dsm(&hierarchy, &options)
}

#[tauri::command]
async fn git_code_churn(
    project_path: String,
    path: String,
    days: Option<u32>,
) -> git_metrics::GitChurnResult {
    let days = days.unwrap_or(90);
    tauri::async_runtime::spawn_blocking(move || {
        git_metrics::collect_git_churn(std::path::Path::new(&project_path), &path, days)
    })
    .await
    .unwrap_or_else(|e| git_metrics::GitChurnResult {
        available: false,
        days,
        files: vec![],
        message: Some(format!("git churn task failed: {e}")),
    })
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
    let builder = tauri::Builder::default()
        .manage(DbState(std::sync::Mutex::new(conn)))
        .manage(AnalysisSessionRegistry::new())
        .manage(AnalysisTriggerState::new())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_agent_skills,
            get_llm_providers,
            list_llm_models,
            run_agent_skill_command,
            cancel_agent_run_command,
            get_analysis_rules,
            scan_project_dir,
            list_project_children_cmd,
            run_project_analysis,
            load_analysis_hierarchy_lite,
            load_analysis_quality_files,
            cancel_project_analysis,
            read_project_file,
            write_project_file,
            compute_project_dsm,
            git_code_churn,
            list_lsp_servers,
            install_lsp_server,
            list_language_linters,
            install_linter,
            schedule::get_analysis_triggers,
            schedule::start_analysis_watch,
            schedule::stop_analysis_watch,
            schedule::start_analysis_schedule,
            schedule::stop_analysis_schedule,
            db::load_persisted_state,
            db::save_persisted_state,
            db::get_db_path,
        ]);

    #[cfg(target_os = "macos")]
    let builder = builder
        .setup(|app| {
            tray::setup_macos_tray(app).map_err(|e| e.to_string())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            tray::on_window_event(window, event);
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    #[cfg(target_os = "macos")]
    app.run(|app_handle, event| {
        if let tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } = event
        {
            tray::on_reopen(app_handle, has_visible_windows);
        }
    });

    #[cfg(not(target_os = "macos"))]
    app.run(|_app_handle, _event| {});
}

#[cfg(test)]
mod tests {
    #[test]
    fn library_entrypoint_is_available() {
        assert!(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).exists());
    }
}
