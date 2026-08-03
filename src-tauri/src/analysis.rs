use devtree_core::Graph;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::fs;
use std::path::{Path, PathBuf};

    use crate::analysis_session::check_cancelled;
use crate::design_rules::{check_design_rules, DesignRule};
use crate::dsm::{compute_dsm, DsmOptions, DsmResult};
use crate::hierarchy::{
    adjacency_from_edges, build_hierarchy_with_progress, cyclic_components_sampled,
    extract_cycle_path, format_dependency_cycle, read_file_contents_with_progress,
    root_package_graph, HierarchyIndex,
};

const MAX_CYCLE_NODES_STORED: usize = 16;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CycleGroup {
    pub kind: String,
    pub nodes: Vec<String>,
    pub path: Vec<String>,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_count: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationItem {
    pub rule_id: String,
    pub rule_name: String,
    pub status: String,
    pub message: String,
    pub affected: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cycle_groups: Option<Vec<CycleGroup>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuggestionItem {
    pub priority: String,
    pub title: String,
    pub description: String,
    pub targets: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisResult {
    pub graph: Graph,
    pub hierarchy: HierarchyIndex,
    pub validation: Vec<ValidationItem>,
    pub suggestions: Vec<SuggestionItem>,
    pub summary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dsm: Option<DsmResult>,
    /// Precomputed file/package quality metrics for O(1) UI lookups.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quality: Option<devtree_core::QualityIndex>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleSettingDef {
    pub key: String,
    pub label: String,
    /// "number" | "boolean"
    pub kind: String,
    pub default: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<RuleSettingOption>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleSettingOption {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisRule {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    #[serde(default)]
    pub settings: Vec<RuleSettingDef>,
}

fn num_setting(key: &str, label: &str, default: u32, min: u32, max: u32) -> RuleSettingDef {
    RuleSettingDef {
        key: key.into(),
        label: label.into(),
        kind: "number".into(),
        default: serde_json::json!(default),
        min: Some(min as f64),
        max: Some(max as f64),
        options: None,
    }
}

fn bool_setting(key: &str, label: &str, default: bool) -> RuleSettingDef {
    RuleSettingDef {
        key: key.into(),
        label: label.into(),
        kind: "boolean".into(),
        default: serde_json::json!(default),
        min: None,
        max: None,
        options: None,
    }
}

pub fn default_rules() -> Vec<AnalysisRule> {
    let mut rules = vec![
        AnalysisRule {
            id: "modularity".into(),
            name: "Modularity".into(),
            description: "Detect tightly coupled modules and oversized files".into(),
            category: "architecture".into(),
            settings: vec![num_setting(
                "max_lines",
                "Warn when a module exceeds (lines)",
                200,
                50,
                2000,
            )],
        },
        AnalysisRule {
            id: "dependency_depth".into(),
            name: "Dependency Depth".into(),
            description: "Flag modules with excessive import chains".into(),
            category: "architecture".into(),
            settings: vec![num_setting(
                "max_depth",
                "Warn when path depth exceeds",
                4,
                1,
                20,
            )],
        },
        AnalysisRule {
            id: "circular_dependencies".into(),
            name: "Circular Dependencies".into(),
            description:
                "Detect import cycles between files and packages (uses resolved imports; optionally symbol reference edges from LSP when available)."
                    .into(),
            category: "architecture".into(),
            settings: vec![
                bool_setting("check_file_imports", "Check file import cycles", true),
                bool_setting("check_package_imports", "Check package import cycles", true),
                bool_setting(
                    "check_symbol_references",
                    "Check symbol reference cycles (requires LSP symbol references)",
                    true,
                ),
                num_setting(
                    "sample_limit",
                    "Max cycles to list",
                    10,
                    1,
                    50,
                ),
            ],
        },
        AnalysisRule {
            id: "type_coverage".into(),
            name: "Type Coverage".into(),
            description: "Check for untyped or loosely typed modules".into(),
            category: "quality".into(),
            settings: vec![bool_setting(
                "flag_javascript",
                "Flag plain .js / .jsx files",
                true,
            )],
        },
        AnalysisRule {
            id: "test_coverage".into(),
            name: "Test Coverage".into(),
            description: "Identify modules lacking test files".into(),
            category: "quality".into(),
            settings: vec![
                num_setting(
                    "warn_untested",
                    "Warn when untested modules exceed",
                    3,
                    0,
                    100,
                ),
                num_setting(
                    "sample_limit",
                    "Max affected files to list",
                    10,
                    1,
                    50,
                ),
            ],
        },
        AnalysisRule {
            id: "file_size".into(),
            name: "File Size".into(),
            description: "Warn about oversized source files".into(),
            category: "maintainability".into(),
            settings: vec![num_setting(
                "max_lines",
                "Fail when a file exceeds (lines)",
                300,
                50,
                5000,
            )],
        },
        AnalysisRule {
            id: "naming".into(),
            name: "Naming Conventions".into(),
            description: "Check for inconsistent file and folder naming".into(),
            category: "maintainability".into(),
            settings: vec![
                bool_setting("flag_spaces", "Flag names containing spaces", true),
                bool_setting(
                    "flag_mixed_case",
                    "Flag mixed-case filenames with extensions",
                    true,
                ),
            ],
        },
        AnalysisRule {
            id: "language_linters".into(),
            name: "Language Linters".into(),
            description:
                "Run configured linters (eslint, clippy, ruff, golangci-lint) and report issues in Validation."
                    .into(),
            category: "quality".into(),
            settings: vec![bool_setting(
                "enabled",
                "Run linters during validation",
                true,
            )],
        },
        AnalysisRule {
            id: "lsp_diagnostics".into(),
            name: "Language Diagnostics".into(),
            description: "Surface errors and warnings from language servers (rust-analyzer, tsserver, gopls, pyright)".into(),
            category: "quality".into(),
            settings: vec![
                bool_setting("include_warnings", "Include warnings", true),
                bool_setting("include_errors", "Include errors", true),
                num_setting(
                    "sample_limit",
                    "Max diagnostics to list",
                    20,
                    1,
                    100,
                ),
            ],
        },
        AnalysisRule {
            id: "gitleaks".into(),
            name: "Secret Scan (gitleaks)".into(),
            description: "Scan the repository for hardcoded secrets and credentials using gitleaks".into(),
            category: "security".into(),
            settings: vec![
                bool_setting("enabled", "Run gitleaks during validation", true),
                num_setting(
                    "sample_limit",
                    "Max findings to list",
                    20,
                    1,
                    100,
                ),
            ],
        },
        AnalysisRule {
            id: "trufflehog".into(),
            name: "Secret Scan (TruffleHog)".into(),
            description: "Scan the repository for secrets and credentials using TruffleHog".into(),
            category: "security".into(),
            settings: vec![
                bool_setting("enabled", "Run TruffleHog during validation", true),
                bool_setting(
                    "verify",
                    "Verify findings against live APIs (slower)",
                    false,
                ),
                bool_setting(
                    "only_verified",
                    "Only report verified findings",
                    false,
                ),
                num_setting(
                    "sample_limit",
                    "Max findings to list",
                    20,
                    1,
                    100,
                ),
            ],
        },
    ];
    rules.extend(crate::agent::ai_validation::rule_definitions());
    rules
}

pub type RuleSettingsMap = std::collections::HashMap<String, serde_json::Map<String, serde_json::Value>>;

fn rule_cfg<'a>(
    all: &'a RuleSettingsMap,
    rule_id: &str,
) -> Option<&'a serde_json::Map<String, serde_json::Value>> {
    all.get(rule_id)
}

fn cfg_u32(cfg: Option<&serde_json::Map<String, serde_json::Value>>, key: &str, default: u32) -> u32 {
    cfg.and_then(|m| m.get(key))
        .and_then(|v| v.as_u64().or_else(|| v.as_f64().map(|f| f as u64)))
        .map(|n| n as u32)
        .unwrap_or(default)
}

fn cfg_bool(cfg: Option<&serde_json::Map<String, serde_json::Value>>, key: &str, default: bool) -> bool {
    cfg.and_then(|m| m.get(key))
        .and_then(|v| v.as_bool())
        .unwrap_or(default)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleTaskProgress {
    pub rule_id: String,
    pub rule_name: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiValidationStream {
    pub rule_id: String,
    pub rule_name: String,
    pub thinking: String,
    pub text: String,
    pub activity: Option<String>,
    /// Live tool stdout/stderr and other tool result previews.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub tool_log: String,
    /// Token budget / usage line (e.g. `Tokens 12.4k / 50k`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub budget: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisProgress {
    pub analysis_id: String,
    pub stage: String,
    pub message: String,
    pub current: u32,
    pub total: u32,
    pub percent: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule_tasks: Option<Vec<RuleTaskProgress>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai_stream: Option<AiValidationStream>,
}

const SKIP_DIRS: &[&str] = &[
    "node_modules", "target", "dist", "build", ".git", ".next", ".nuxt",
    ".cache", "coverage", "__pycache__", ".venv", "venv", ".idea", ".vscode", "pkg", "wasm",
];

const SOURCE_EXTENSIONS: &[&str] = &["ts", "tsx", "js", "jsx", "rs", "py", "go"];

fn should_skip_dir(name: &str) -> bool {
    SKIP_DIRS.contains(&name) || name.starts_with('.')
}

fn is_source_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| SOURCE_EXTENSIONS.contains(&ext))
        .unwrap_or(false)
}

fn count_lines(path: &Path) -> u32 {
    fs::read_to_string(path)
        .map(|s| s.lines().count() as u32)
        .unwrap_or(0)
}

fn emit_progress(
    emit: &Arc<dyn Fn(AnalysisProgress) + Send + Sync>,
    analysis_id: &str,
    stage: &str,
    message: &str,
    current: u32,
    total: u32,
    percent: u8,
    rule_tasks: Option<Vec<RuleTaskProgress>>,
) {
    emit_progress_with_ai(
        emit,
        analysis_id,
        stage,
        message,
        current,
        total,
        percent,
        rule_tasks,
        None,
    );
}

fn emit_progress_with_ai(
    emit: &Arc<dyn Fn(AnalysisProgress) + Send + Sync>,
    analysis_id: &str,
    stage: &str,
    message: &str,
    current: u32,
    total: u32,
    percent: u8,
    rule_tasks: Option<Vec<RuleTaskProgress>>,
    ai_stream: Option<AiValidationStream>,
) {
    emit(AnalysisProgress {
        analysis_id: analysis_id.into(),
        stage: stage.into(),
        message: message.into(),
        current,
        total,
        percent,
        rule_tasks,
        ai_stream,
    });
}

fn rule_display_name(rule_id: &str) -> String {
    default_rules()
        .into_iter()
        .find(|rule| rule.id == rule_id)
        .map(|rule| rule.name)
        .unwrap_or_else(|| rule_id.to_string())
}

fn set_rule_task_status(
    tasks: &Mutex<Vec<RuleTaskProgress>>,
    rule_id: &str,
    status: &str,
    message: Option<String>,
) {
    if let Ok(mut tasks) = tasks.lock() {
        if let Some(task) = tasks.iter_mut().find(|task| task.rule_id == rule_id) {
            task.status = status.into();
            task.message = message;
        }
    }
}

fn emit_rule_tasks_progress(
    emit: &Arc<dyn Fn(AnalysisProgress) + Send + Sync>,
    analysis_id: &str,
    rule_tasks: &Arc<Mutex<Vec<RuleTaskProgress>>>,
    headline: &str,
) {
    let tasks = rule_tasks.lock().unwrap().clone();
    let total = tasks.len().max(1);
    let done = tasks
        .iter()
        .filter(|task| task.status == "done" || task.status == "failed")
        .count();
    let running = tasks.iter().filter(|task| task.status == "running").count();
    let message = if running > 0 {
        format!("{headline} ({running} running · {done}/{total} done)")
    } else {
        headline.to_string()
    };
    emit(AnalysisProgress {
        analysis_id: analysis_id.into(),
        stage: "validating".into(),
        message,
        current: done as u32,
        total: total as u32,
        percent: (85 + ((done as f32 / total as f32) * 10.0) as u8).min(95),
        rule_tasks: Some(tasks),
        ai_stream: None,
    });
}

fn run_single_validation_rule(
    rule_id: &str,
    root: &Path,
    files: &[(String, u32)],
    hierarchy: &HierarchyIndex,
    cfg: Option<&serde_json::Map<String, serde_json::Value>>,
    lsp_diags: &[crate::lsp::LspDiagnostic],
) -> ValidationItem {
    match rule_id {
        "modularity" => run_modularity_check(files, cfg),
        "dependency_depth" => run_dependency_depth_check(files, cfg),
        "circular_dependencies" => run_circular_dependency_check(hierarchy, cfg),
        "type_coverage" => run_type_coverage_check(files, cfg),
        "test_coverage" => run_test_coverage_check(root, files, cfg),
        "file_size" => run_file_size_check(files, cfg),
        "naming" => run_naming_check(files, cfg),
        "lsp_diagnostics" => run_lsp_diagnostics_check(lsp_diags, cfg),
        "gitleaks" => crate::gitleaks::run_gitleaks_check(root, cfg),
        "trufflehog" => crate::trufflehog::run_trufflehog_check(root, cfg),
        _ => ValidationItem {
            rule_id: rule_id.into(),
            rule_name: rule_display_name(rule_id),
            status: "pass".into(),
            message: "Unknown rule".into(),
            affected: vec![],
            cycle_groups: None,
        },
    }
}

fn run_validation_rules_parallel(
    rule_ids: &[String],
    run_language_linters: bool,
    linter_languages: Vec<crate::linter::LanguageKind>,
    root: &Path,
    files: &[(String, u32)],
    hierarchy: &HierarchyIndex,
    rule_settings: &RuleSettingsMap,
    linter_settings: &crate::linter::LinterSettingsMap,
    lsp_diags: &[crate::lsp::LspDiagnostic],
    cancel: &AtomicBool,
    analysis_id: &str,
    emit: Arc<dyn Fn(AnalysisProgress) + Send + Sync>,
) -> Result<Vec<ValidationItem>, String> {
    let mut initial_tasks = Vec::new();
    for rule_id in rule_ids {
        if rule_id == "language_linters" || crate::agent::ai_validation::is_ai_validation_rule(rule_id) {
            continue;
        }
        initial_tasks.push(RuleTaskProgress {
            rule_id: rule_id.clone(),
            rule_name: rule_display_name(rule_id),
            status: "pending".into(),
            message: None,
        });
    }
    if run_language_linters {
        for lang in &linter_languages {
            initial_tasks.push(RuleTaskProgress {
                rule_id: format!("language_linters:{}", lang.id()),
                rule_name: format!("Language Linters · {}", lang.label()),
                status: "pending".into(),
                message: None,
            });
        }
    }

    if initial_tasks.is_empty() {
        return Ok(Vec::new());
    }

    let rule_tasks = Arc::new(Mutex::new(initial_tasks));
    {
        let mut tasks = rule_tasks.lock().unwrap();
        for task in tasks.iter_mut() {
            task.status = "running".into();
        }
    }
    emit_rule_tasks_progress(
        &emit,
        analysis_id,
        &rule_tasks,
        "Running validation rules in parallel…",
    );

    let validation_results = Arc::new(Mutex::new(Vec::new()));
    let root_buf = root.to_path_buf();
    let files_vec = files.to_vec();
    let lsp_diags_vec = lsp_diags.to_vec();
    let hierarchy = hierarchy.clone();
    let rule_settings = rule_settings.clone();
    let linter_settings = linter_settings.clone();
    let rule_ids_vec: Vec<String> = rule_ids
        .iter()
        .filter(|id| *id != "language_linters" && !crate::agent::ai_validation::is_ai_validation_rule(id))
        .cloned()
        .collect();

    std::thread::scope(|scope| {
        for rule_id in rule_ids_vec {
            let emit = emit.clone();
            let rule_tasks = rule_tasks.clone();
            let validation_results = validation_results.clone();
            let root_buf = root_buf.clone();
            let files_vec = files_vec.clone();
            let lsp_diags_vec = lsp_diags_vec.clone();
            let hierarchy = hierarchy.clone();
            let rule_settings = rule_settings.clone();
            let analysis_id = analysis_id.to_string();

            scope.spawn(move || {
                if check_cancelled(cancel).is_err() {
                    set_rule_task_status(&rule_tasks, &rule_id, "failed", Some("Cancelled".into()));
                    emit_rule_tasks_progress(&emit, &analysis_id, &rule_tasks, "Validation cancelled");
                    return;
                }

                let cfg = rule_cfg(&rule_settings, &rule_id);
                let item = run_single_validation_rule(
                    &rule_id,
                    &root_buf,
                    &files_vec,
                    &hierarchy,
                    cfg,
                    &lsp_diags_vec,
                );

                set_rule_task_status(&rule_tasks, &rule_id, "done", Some(item.message.clone()));
                validation_results.lock().unwrap().push(item);
                emit_rule_tasks_progress(
                    &emit,
                    &analysis_id,
                    &rule_tasks,
                    &format!("Finished {}", rule_display_name(&rule_id)),
                );
            });
        }

        if run_language_linters {
            let emit = emit.clone();
            let rule_tasks = rule_tasks.clone();
            let validation_results = validation_results.clone();
            let root_buf = root_buf.clone();
            let files_vec = files_vec.clone();
            let linter_settings = linter_settings.clone();
            let analysis_id = analysis_id.to_string();

            for lang in linter_languages {
                let task_id = format!("language_linters:{}", lang.id());
                let emit = emit.clone();
                let rule_tasks = rule_tasks.clone();
                let validation_results = validation_results.clone();
                let root_buf = root_buf.clone();
                let files_vec = files_vec.clone();
                let linter_settings = linter_settings.clone();
                let analysis_id = analysis_id.clone();

                scope.spawn(move || {
                    if check_cancelled(cancel).is_err() {
                        set_rule_task_status(
                            &rule_tasks,
                            &task_id,
                            "failed",
                            Some("Cancelled".into()),
                        );
                        emit_rule_tasks_progress(
                            &emit,
                            &analysis_id,
                            &rule_tasks,
                            "Validation cancelled",
                        );
                        return;
                    }

                    let item = match crate::linter::run_language_linter_for_lang(
                        &root_buf,
                        &files_vec,
                        &linter_settings,
                        lang,
                    ) {
                        Ok(item) => item,
                        Err(err) => ValidationItem {
                            rule_id: format!("linter:{}", lang.id()),
                            rule_name: format!("{} (linter)", lang.label()),
                            status: "warn".into(),
                            message: err,
                            affected: vec![],
                            cycle_groups: None,
                        },
                    };

                    set_rule_task_status(&rule_tasks, &task_id, "done", Some(item.message.clone()));
                    validation_results.lock().unwrap().push(item);
                    emit_rule_tasks_progress(
                        &emit,
                        &analysis_id,
                        &rule_tasks,
                        &format!("Finished {} linters", lang.label()),
                    );
                });
            }
        }
    });

    check_cancelled(cancel)?;
    let results = validation_results.lock().unwrap().clone();
    Ok(results)
}

/// Breadth-first walk of the project tree, collecting source files level by level.
fn scan_source_files(
    root: &Path,
    cancel: &AtomicBool,
    analysis_id: &str,
    emit: &Arc<dyn Fn(AnalysisProgress) + Send + Sync>,
) -> Result<Vec<(String, u32)>, String> {
    let mut files = Vec::new();
    let mut queue: VecDeque<PathBuf> = VecDeque::new();
    queue.push_back(root.to_path_buf());

    let mut dirs_visited = 0u32;

    while let Some(dir) = queue.pop_front() {
        check_cancelled(cancel)?;
        dirs_visited += 1;
        if dirs_visited == 1 || dirs_visited % 8 == 0 {
            emit_progress(
                emit,
                analysis_id,
                "scanning",
                &format!("Scanning directories… ({} files found)", files.len()),
                files.len() as u32,
                0,
                5,
                None,
            );
        }

        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };

        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by_key(|e| e.file_name());

        for entry in entries {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            if path.is_dir() {
                if !should_skip_dir(&name) {
                    queue.push_back(path);
                }
                continue;
            }

            if !is_source_file(&path) {
                continue;
            }

            let rel = path
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| name);
            let loc = count_lines(&path);
            files.push((rel, loc));
        }
    }

    emit_progress(
        emit,
        analysis_id,
        "scanning",
        &format!("Found {} source files", files.len()),
        files.len() as u32,
        files.len() as u32,
        15,
        None,
    );

    Ok(files)
}

fn run_modularity_check(
    files: &[(String, u32)],
    cfg: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ValidationItem {
    let max_lines = cfg_u32(cfg, "max_lines", 200);
    let large = files
        .iter()
        .filter(|(_, loc)| *loc > max_lines)
        .map(|(p, _)| p.clone())
        .collect::<Vec<_>>();

    if large.is_empty() {
        ValidationItem {
            rule_id: "modularity".into(),
            rule_name: "Modularity".into(),
            status: "pass".into(),
            message: format!("No modules exceed {max_lines} lines"),
            affected: vec![],
            cycle_groups: None,
        }
    } else {
        ValidationItem {
            rule_id: "modularity".into(),
            rule_name: "Modularity".into(),
            status: "warn".into(),
            message: format!(
                "{} module(s) exceed {max_lines} lines — consider splitting",
                large.len()
            ),
            affected: large,
            cycle_groups: None,
        }
    }
}

fn run_test_coverage_check(
    root: &Path,
    files: &[(String, u32)],
    cfg: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ValidationItem {
    let warn_untested = cfg_u32(cfg, "warn_untested", 3) as usize;
    let sample_limit = cfg_u32(cfg, "sample_limit", 10) as usize;
    let untested: Vec<String> = files
        .iter()
        .filter(|(p, _)| {
            let name = Path::new(p)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            !name.contains("test") && !name.contains("spec")
        })
        .filter(|(p, _)| {
            let stem = Path::new(p)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let parent = Path::new(p).parent().unwrap_or(Path::new("."));
            let has_test = ["test", "tests", "__tests__"]
                .iter()
                .any(|dir| parent.join(dir).join(format!("{stem}.test.ts")).exists())
                || parent
                    .join(format!("{stem}.test.ts"))
                    .exists()
                || parent
                    .join(format!("{stem}.spec.ts"))
                    .exists()
                || root
                    .join("tests")
                    .join(format!("{stem}.rs"))
                    .exists();
            !has_test
        })
        .map(|(p, _)| p.clone())
        .take(sample_limit)
        .collect();

    if untested.len() <= warn_untested {
        ValidationItem {
            rule_id: "test_coverage".into(),
            rule_name: "Test Coverage".into(),
            status: "pass".into(),
            message: "Most modules appear to have corresponding tests".into(),
            affected: vec![],
            cycle_groups: None,
        }
    } else {
        ValidationItem {
            rule_id: "test_coverage".into(),
            rule_name: "Test Coverage".into(),
            status: "warn".into(),
            message: format!("{} module(s) may lack test files", untested.len()),
            affected: untested,
            cycle_groups: None,
        }
    }
}

fn run_file_size_check(
    files: &[(String, u32)],
    cfg: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ValidationItem {
    let max_lines = cfg_u32(cfg, "max_lines", 300);
    let oversized: Vec<String> = files
        .iter()
        .filter(|(_, loc)| *loc > max_lines)
        .map(|(p, _)| p.clone())
        .collect();

    if oversized.is_empty() {
        ValidationItem {
            rule_id: "file_size".into(),
            rule_name: "File Size".into(),
            status: "pass".into(),
            message: format!("All files are within {max_lines} lines"),
            affected: vec![],
            cycle_groups: None,
        }
    } else {
        ValidationItem {
            rule_id: "file_size".into(),
            rule_name: "File Size".into(),
            status: "fail".into(),
            message: format!("{} file(s) exceed {max_lines} lines", oversized.len()),
            affected: oversized,
            cycle_groups: None,
        }
    }
}

fn run_naming_check(
    files: &[(String, u32)],
    cfg: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ValidationItem {
    let flag_spaces = cfg_bool(cfg, "flag_spaces", true);
    let flag_mixed = cfg_bool(cfg, "flag_mixed_case", true);
    let inconsistent: Vec<String> = files
        .iter()
        .filter(|(p, _)| {
            let name = Path::new(p)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let space = flag_spaces && name.contains(' ');
            let mixed =
                flag_mixed && name.chars().any(|c| c.is_uppercase() && name.contains('.'));
            space || mixed
        })
        .map(|(p, _)| p.clone())
        .collect();

    if inconsistent.is_empty() {
        ValidationItem {
            rule_id: "naming".into(),
            rule_name: "Naming Conventions".into(),
            status: "pass".into(),
            message: "File naming looks consistent".into(),
            affected: vec![],
            cycle_groups: None,
        }
    } else {
        ValidationItem {
            rule_id: "naming".into(),
            rule_name: "Naming Conventions".into(),
            status: "warn".into(),
            message: format!("{} file(s) have non-standard naming", inconsistent.len()),
            affected: inconsistent,
            cycle_groups: None,
        }
    }
}

fn run_dependency_depth_check(
    files: &[(String, u32)],
    cfg: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ValidationItem {
    let max_depth = cfg_u32(cfg, "max_depth", 4) as usize;
    let deep_dirs: Vec<String> = files
        .iter()
        .filter(|(p, _)| {
            p.matches('/').count() > max_depth || p.matches('\\').count() > max_depth
        })
        .map(|(p, _)| p.clone())
        .collect();

    if deep_dirs.is_empty() {
        ValidationItem {
            rule_id: "dependency_depth".into(),
            rule_name: "Dependency Depth".into(),
            status: "pass".into(),
            message: format!("No files deeper than {max_depth} path segments"),
            affected: vec![],
            cycle_groups: None,
        }
    } else {
        ValidationItem {
            rule_id: "dependency_depth".into(),
            rule_name: "Dependency Depth".into(),
            status: "warn".into(),
            message: format!(
                "{} file(s) are nested deeper than {max_depth} segments",
                deep_dirs.len()
            ),
            affected: deep_dirs,
            cycle_groups: None,
        }
    }
}

fn cap_cycle_nodes(nodes: Vec<String>) -> (Vec<String>, Option<usize>) {
    let total = nodes.len();
    if total <= MAX_CYCLE_NODES_STORED {
        return (nodes, None);
    }
    (nodes.into_iter().take(MAX_CYCLE_NODES_STORED).collect(), Some(total))
}

fn collect_formatted_cycles(
    adj: &HashMap<String, Vec<String>>,
    kind: &str,
    label: &str,
    sample_limit: usize,
) -> (usize, Vec<String>, Vec<CycleGroup>) {
    let (total, components) = cyclic_components_sampled(adj, sample_limit);
    let mut formatted = Vec::new();
    let mut groups = Vec::new();
    for component in components {
        let path = extract_cycle_path(&component, adj);
        let line = format_dependency_cycle(&component, adj, label);
        if line.is_empty() {
            continue;
        }
        let (nodes, node_count) = cap_cycle_nodes(component);
        let capped_path = if path.len() > MAX_CYCLE_NODES_STORED {
            path.into_iter().take(MAX_CYCLE_NODES_STORED).collect()
        } else {
            path
        };
        formatted.push(line.clone());
        groups.push(CycleGroup {
            kind: kind.into(),
            nodes,
            path: capped_path,
            label: line,
            node_count,
        });
    }
    (total, formatted, groups)
}

fn run_circular_dependency_check(
    hierarchy: &HierarchyIndex,
    cfg: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ValidationItem {
    let check_files = cfg_bool(cfg, "check_file_imports", true);
    let check_packages = cfg_bool(cfg, "check_package_imports", true);
    let check_symbols = cfg_bool(cfg, "check_symbol_references", true);
    let sample_limit = cfg_u32(cfg, "sample_limit", 10) as usize;

    let mut cycles = Vec::new();
    let mut cycle_groups = Vec::new();
    let mut total_groups = 0usize;

    if check_files {
        let adj = adjacency_from_edges(
            hierarchy
                .file_imports
                .iter()
                .flat_map(|(source, targets)| {
                    targets
                        .iter()
                        .map(move |target| (source.as_str(), target.as_str()))
                }),
        );
        let (total, mut formatted, mut groups) =
            collect_formatted_cycles(&adj, "file_imports", "file imports", sample_limit);
        total_groups += total;
        cycles.append(&mut formatted);
        cycle_groups.append(&mut groups);
    }

    if check_packages {
        let adj = adjacency_from_edges(
            hierarchy
                .package_edges
                .iter()
                .map(|edge| (edge.source.as_str(), edge.target.as_str())),
        );
        let (total, mut formatted, mut groups) =
            collect_formatted_cycles(&adj, "package_imports", "package imports", sample_limit);
        total_groups += total;
        cycles.append(&mut formatted);
        cycle_groups.append(&mut groups);
    }

    if check_symbols && !hierarchy.symbol_edges.is_empty() {
        let adj = adjacency_from_edges(
            hierarchy
                .symbol_edges
                .iter()
                .map(|edge| (edge.source.as_str(), edge.target.as_str())),
        );
        let (total, mut formatted, mut groups) = collect_formatted_cycles(
            &adj,
            "symbol_references",
            "symbol references",
            sample_limit,
        );
        total_groups += total;
        cycles.append(&mut formatted);
        cycle_groups.append(&mut groups);
    }

    cycles.sort();
    cycles.dedup();
    if cycles.len() > sample_limit {
        cycles.truncate(sample_limit);
    }
    if cycle_groups.len() > sample_limit {
        cycle_groups.truncate(sample_limit);
    }

    if total_groups == 0 {
        let source = if hierarchy.symbol_edges.is_empty() {
            "import graph"
        } else {
            "import graph and LSP symbol references"
        };
        ValidationItem {
            rule_id: "circular_dependencies".into(),
            rule_name: "Circular Dependencies".into(),
            status: "pass".into(),
            message: format!("No circular dependencies detected in {source}"),
            affected: vec![],
            cycle_groups: None,
        }
    } else {
        let has_file_cycles = cycle_groups
            .iter()
            .any(|group| group.kind == "file_imports");
        let status = if has_file_cycles { "fail" } else { "warn" };
        ValidationItem {
            rule_id: "circular_dependencies".into(),
            rule_name: "Circular Dependencies".into(),
            status: status.into(),
            message: format!(
                "{total_groups} circular dependency group(s) found{}",
                if total_groups > cycles.len() {
                    " (list truncated)"
                } else {
                    ""
                }
            ),
            affected: cycles,
            cycle_groups: Some(cycle_groups),
        }
    }
}

fn run_type_coverage_check(
    files: &[(String, u32)],
    cfg: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ValidationItem {
    if !cfg_bool(cfg, "flag_javascript", true) {
        return ValidationItem {
            rule_id: "type_coverage".into(),
            rule_name: "Type Coverage".into(),
            status: "pass".into(),
            message: "JavaScript file checks disabled".into(),
            affected: vec![],
            cycle_groups: None,
        };
    }
    let untyped: Vec<String> = files
        .iter()
        .filter(|(p, _)| {
            let ext = Path::new(p).extension().and_then(|e| e.to_str()).unwrap_or("");
            matches!(ext, "js" | "jsx")
        })
        .map(|(p, _)| p.clone())
        .collect();

    if untyped.is_empty() {
        ValidationItem {
            rule_id: "type_coverage".into(),
            rule_name: "Type Coverage".into(),
            status: "pass".into(),
            message: "No plain JavaScript files detected".into(),
            affected: vec![],
            cycle_groups: None,
        }
    } else {
        ValidationItem {
            rule_id: "type_coverage".into(),
            rule_name: "Type Coverage".into(),
            status: "warn".into(),
            message: format!("{} JavaScript file(s) could benefit from TypeScript", untyped.len()),
            affected: untyped,
            cycle_groups: None,
        }
    }
}

fn run_lsp_diagnostics_check(
    diags: &[crate::lsp::LspDiagnostic],
    cfg: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ValidationItem {
    let include_errors = cfg_bool(cfg, "include_errors", true);
    let include_warnings = cfg_bool(cfg, "include_warnings", true);
    let sample_limit = cfg_u32(cfg, "sample_limit", 20) as usize;

    let errors: Vec<&crate::lsp::LspDiagnostic> = if include_errors {
        diags.iter().filter(|d| d.severity == "error").collect()
    } else {
        vec![]
    };
    let warnings: Vec<&crate::lsp::LspDiagnostic> = if include_warnings {
        diags.iter().filter(|d| d.severity == "warning").collect()
    } else {
        vec![]
    };

    if errors.is_empty() && warnings.is_empty() {
        return ValidationItem {
            rule_id: "lsp_diagnostics".into(),
            rule_name: "Language Diagnostics".into(),
            status: "pass".into(),
            message: if diags.is_empty() {
                "No language-server diagnostics (servers missing or still indexing)".into()
            } else {
                "No errors or warnings from language servers".into()
            },
            affected: vec![],
            cycle_groups: None,
        };
    }

    let mut affected: Vec<String> = errors
        .iter()
        .chain(warnings.iter())
        .map(|d| format!("{}:{} — {}", d.path, d.line, d.message))
        .collect();
    affected.sort();
    affected.dedup();
    let sample: Vec<String> = affected.into_iter().take(sample_limit).collect();

    if !errors.is_empty() {
        ValidationItem {
            rule_id: "lsp_diagnostics".into(),
            rule_name: "Language Diagnostics".into(),
            status: "fail".into(),
            message: format!(
                "{} error(s), {} warning(s) from language servers",
                errors.len(),
                warnings.len()
            ),
            affected: sample,
            cycle_groups: None,
        }
    } else {
        ValidationItem {
            rule_id: "lsp_diagnostics".into(),
            rule_name: "Language Diagnostics".into(),
            status: "warn".into(),
            message: format!(
                "{} warning(s) from language servers ({})",
                warnings.len(),
                warnings
                    .first()
                    .map(|d| d.source.as_str())
                    .unwrap_or("lsp")
            ),
            affected: sample,
            cycle_groups: None,
        }
    }
}

fn trim_analysis_result_for_transport(
    hierarchy: &mut HierarchyIndex,
    validation: &mut [ValidationItem],
) {
    // Scope graphs are rebuilt on the frontend from file_imports; omitting them
    // dramatically reduces IPC + persistence payload size on large projects.
    hierarchy.scope_graphs.clear();
    for item in validation.iter_mut() {
        if item.rule_id == "circular_dependencies" {
            item.affected.clear();
        }
    }
}

fn normalize_project_root(root: &str) -> String {
    let trimmed = root.trim().replace('\\', "/");
    if trimmed.len() <= 1 {
        return trimmed;
    }
    trimmed.trim_end_matches('/').to_string()
}

fn empty_hierarchy_for_ipc() -> HierarchyIndex {
    HierarchyIndex {
        version: crate::hierarchy::HIERARCHY_VERSION,
        files: vec![],
        packages: vec![],
        file_imports: std::collections::HashMap::new(),
        package_edges: vec![],
        symbols: std::collections::HashMap::new(),
        symbol_edges: vec![],
        scope_graphs: std::collections::HashMap::new(),
    }
}

/// Hierarchy safe to persist/load for graph drill — never includes symbols.
fn hierarchy_lite(mut hierarchy: HierarchyIndex) -> HierarchyIndex {
    hierarchy.symbols.clear();
    hierarchy.symbol_edges.clear();
    hierarchy.scope_graphs.clear();
    hierarchy
}

fn cap_validation_affected(mut validation: Vec<ValidationItem>, max: usize) -> Vec<ValidationItem> {
    for item in validation.iter_mut() {
        if item.affected.len() > max {
            item.affected.truncate(max);
        }
    }
    validation
}

/// Persist analysis for the UI:
/// - SQLite: slim meta + package-level quality only (never multi-hundred-MB JSON)
/// - Files: hierarchy-lite (~files+imports) and quality.files under ~/.devtree/cache/
pub fn persist_analysis_result(
    project_root: &str,
    result: &AnalysisResult,
) -> Result<(), String> {
    let root = normalize_project_root(project_root);
    let cache_dir = crate::analysis_cache::cache_dir_for_project(&root)?;

    let lite = hierarchy_lite(result.hierarchy.clone());
    let hierarchy_path = cache_dir.join("hierarchy-lite.json");
    crate::analysis_cache::write_json_file(&hierarchy_path, &lite)?;

    let mut quality_files_path: Option<String> = None;
    if let Some(quality) = &result.quality {
        if !quality.files.is_empty() {
            let path = cache_dir.join("quality-files.json");
            crate::analysis_cache::write_json_file(&path, &quality.files)?;
            quality_files_path = Some(path.to_string_lossy().to_string());
        }
    }

    let validation = cap_validation_affected(result.validation.clone(), 80);
    let meta = serde_json::json!({
        "graph": result.graph,
        "validation": validation,
        "suggestions": result.suggestions,
        "summary": result.summary,
        "dsm": result.dsm,
        "projectRoot": root,
        "cache": {
            "hierarchyLite": hierarchy_path.to_string_lossy(),
            "qualityFiles": quality_files_path,
        },
    });

    // Package rollups only in SQLite (~hundreds of KB, not 14MB+).
    let quality_packages = match &result.quality {
        Some(q) => serde_json::json!({
            "files": {},
            "packages": q.packages,
        }),
        None => serde_json::Value::Null,
    };

    // File cache is the source of truth for large blobs. SQLite pointers are best-effort
    // (tests / locked home dirs must not fail the analysis run).
    let _ = crate::db::put_kv(
        "analysis-project",
        &serde_json::to_string(&root).map_err(|e| e.to_string())?,
    );
    let _ = crate::db::put_kv(&format!("analysis-meta::{root}"), &meta.to_string());
    let _ = crate::db::put_kv(
        &format!("analysis-hierarchy::{root}"),
        &serde_json::json!({
            "v": 2,
            "path": hierarchy_path.to_string_lossy(),
        })
        .to_string(),
    );
    let _ = crate::db::put_kv(
        &format!("analysis-quality::{root}"),
        &quality_packages.to_string(),
    );
    Ok(())
}

/// IPC payload: report + package graph + package quality. Hierarchy loads on drill.
pub fn slim_analysis_for_ipc(mut result: AnalysisResult) -> AnalysisResult {
    let packages = result
        .quality
        .as_ref()
        .map(|q| q.packages.clone())
        .unwrap_or_default();
    result.hierarchy = empty_hierarchy_for_ipc();
    result.quality = Some(devtree_core::QualityIndex {
        files: std::collections::HashMap::new(),
        packages,
    });
    result.validation = cap_validation_affected(result.validation, 80);
    result
}

/// Load hierarchy-lite from the analysis cache (no symbols).
pub fn load_cached_hierarchy_lite(project_root: &str) -> Result<HierarchyIndex, String> {
    let root = normalize_project_root(project_root);
    let cache_dir = crate::analysis_cache::cache_dir_for_project(&root)?;
    let path = cache_dir.join("hierarchy-lite.json");
    if path.is_file() {
        return crate::analysis_cache::read_json_file(&path);
    }
    // Legacy: pointer JSON in SQLite.
    // Handled on the frontend via loadRaw; Rust path is the primary.
    Err(format!(
        "No cached hierarchy for {root}. Re-run analysis."
    ))
}

/// Load per-file quality metrics from cache (optional, for module details / file lists).
pub fn load_cached_quality_files(
    project_root: &str,
) -> Result<std::collections::HashMap<String, devtree_core::FileQualityMetrics>, String> {
    let root = normalize_project_root(project_root);
    let cache_dir = crate::analysis_cache::cache_dir_for_project(&root)?;
    let path = cache_dir.join("quality-files.json");
    if !path.is_file() {
        return Ok(std::collections::HashMap::new());
    }
    crate::analysis_cache::read_json_file(&path)
}

#[cfg(test)]
pub fn run_analysis(
    project_root: &str,
    rule_ids: &[String],
) -> Result<AnalysisResult, String> {
    let cancel = AtomicBool::new(false);
    run_analysis_with_progress(
        project_root,
        rule_ids,
        &RuleSettingsMap::new(),
        &crate::lsp::LspSettingsMap::new(),
        &crate::linter::LinterSettingsMap::new(),
        &crate::agent::ai_validation::LlmConfigurations::new(),
        &crate::agent::ai_validation::AiValidationRuntimeSettings::default(),
        &[],
        &cancel,
        "test",
        |_| {},
    )
}

pub fn run_analysis_with_progress(
    project_root: &str,
    rule_ids: &[String],
    rule_settings: &RuleSettingsMap,
    lsp_settings: &crate::lsp::LspSettingsMap,
    linter_settings: &crate::linter::LinterSettingsMap,
    llm_configurations: &crate::agent::ai_validation::LlmConfigurations,
    ai_validation_runtime: &crate::agent::ai_validation::AiValidationRuntimeSettings,
    design_rules: &[DesignRule],
    cancel: &AtomicBool,
    analysis_id: &str,
    on_progress: impl FnMut(AnalysisProgress) + Send + 'static,
) -> Result<AnalysisResult, String> {
    let root = Path::new(project_root);
    if !root.is_dir() {
        return Err(format!("Not a directory: {project_root}"));
    }

    let on_progress = Arc::new(Mutex::new(on_progress));
    let emit: Arc<dyn Fn(AnalysisProgress) + Send + Sync> = Arc::new({
        let on_progress = on_progress.clone();
        move |progress| {
            if let Ok(mut callback) = on_progress.lock() {
                callback(progress);
            }
        }
    });

    emit_progress(
        &emit,
        analysis_id,
        "scanning",
        "Starting breadth-first scan…",
        0,
        0,
        0,
        None,
    );

    let files = scan_source_files(root, cancel, analysis_id, &emit)?;
    if files.is_empty() {
        return Err("No source files found in project".to_string());
    }

    let file_total = files.len() as u32;
    let emit_read = emit.clone();
    let analysis_id_read = analysis_id.to_string();
    let contents = read_file_contents_with_progress(root, &files, cancel, move |current, total| {
        let pct = 15 + ((current as f32 / total.max(1) as f32) * 20.0) as u8;
        emit_progress(
            &emit_read,
            &analysis_id_read,
            "reading",
            &format!("Reading file contents ({current}/{total})"),
            current as u32,
            total as u32,
            pct.min(35),
            None,
        );
    })?;

    check_cancelled(cancel)?;

    emit_progress(
        &emit,
        analysis_id,
        "lsp",
        "Starting language servers…",
        0,
        0,
        36,
        None,
    );

    let emit_lsp = emit.clone();
    let analysis_id_lsp = analysis_id.to_string();
    let lsp_pool = crate::lsp::LspPool::start(
        root,
        &files,
        &contents,
        lsp_settings,
        move |message, current, total| {
            let pct = if total > 0 {
                36 + ((current as f32 / total as f32) * 14.0) as u8
            } else {
                40
            };
            emit_progress(
                &emit_lsp,
                &analysis_id_lsp,
                "lsp",
                message,
                current,
                total,
                pct.min(50),
                None,
            );
        },
    );

    check_cancelled(cancel)?;

    let lsp_ref = if lsp_pool.server_count() > 0 {
        Some(&lsp_pool)
    } else {
        None
    };

    let emit_analyze = emit.clone();
    let analysis_id_analyze = analysis_id.to_string();
    let mut hierarchy = build_hierarchy_with_progress(
        root,
        &files,
        &contents,
        lsp_ref,
        cancel,
        move |current, total| {
            let pct = 50 + ((current as f32 / total.max(1) as f32) * 35.0) as u8;
            emit_progress(
                &emit_analyze,
                &analysis_id_analyze,
                "analyzing",
                &format!("Resolving imports & symbols ({current}/{total})"),
                current as u32,
                total as u32,
                pct.min(85),
                None,
            );
        },
    )?;

    let lsp_diags = lsp_pool.diagnostics();
    drop(lsp_pool);

    check_cancelled(cancel)?;

    let graph = root_package_graph(&hierarchy);
    let run_language_linters = rule_ids.iter().any(|id| id == "language_linters")
        && cfg_bool(rule_cfg(rule_settings, "language_linters"), "enabled", true);
    let linter_languages = if run_language_linters {
        crate::linter::languages_in_files(&files)
    } else {
        Vec::new()
    };

    let mut validation = run_validation_rules_parallel(
        rule_ids,
        run_language_linters,
        linter_languages,
        root,
        &files,
        &hierarchy,
        rule_settings,
        linter_settings,
        &lsp_diags,
        cancel,
        analysis_id,
        emit.clone(),
    )?;

    check_cancelled(cancel)?;

    let ai_rule_ids: Vec<String> = rule_ids
        .iter()
        .filter(|id| crate::agent::ai_validation::is_ai_validation_rule(id))
        .cloned()
        .collect();
    if !ai_rule_ids.is_empty() {
        emit_progress(
            &emit,
            analysis_id,
            "validating",
            "Running AI validation rules…",
            0,
            ai_rule_ids.len() as u32,
            92,
            None,
        );
        let ai_items = crate::agent::ai_validation::run_ai_validation_rules(
            &ai_rule_ids,
            root,
            &hierarchy,
            &validation,
            llm_configurations,
            ai_validation_runtime,
            rule_settings,
            cancel,
            analysis_id,
            emit.clone(),
        );
        validation.extend(ai_items);
    }

    check_cancelled(cancel)?;

    let mut dsm = Some(compute_dsm(
        &hierarchy,
        &DsmOptions {
            level: "package".into(),
            scope: None,
            ordering: "partitioned".into(),
        },
    ));

    let design_violations = check_design_rules(&hierarchy, design_rules);
    if let Some(ref mut d) = dsm {
        d.violations = design_violations.clone();
    }
    if !design_rules.is_empty() {
        let status = if design_violations.is_empty() {
            "pass"
        } else if design_violations.len() > 5 {
            "fail"
        } else {
            "warn"
        };
        let message = if design_violations.is_empty() {
            "No design-rule violations".to_string()
        } else {
            format!("{} design-rule violation(s)", design_violations.len())
        };
        let affected: Vec<String> = design_violations
            .iter()
            .take(40)
            .map(|v| format!("{} → {}", v.from, v.to))
            .collect();
        validation.push(ValidationItem {
            rule_id: "architecture_conformance".into(),
            rule_name: "Architecture Conformance (LDM)".into(),
            status: status.into(),
            message,
            affected,
            cycle_groups: None,
        });
    }

    let pass_count = validation.iter().filter(|v| v.status == "pass").count();
    let warn_count = validation.iter().filter(|v| v.status == "warn").count();
    let fail_count = validation.iter().filter(|v| v.status == "fail").count();

    let health = dsm
        .as_ref()
        .map(|d| d.metrics.health_score.round() as i32)
        .unwrap_or(100);

    let summary = format!(
        "Analyzed {} packages ({} source files) with {} rule(s): {} passed, {} warnings, {} failures · modularity health {}",
        hierarchy.packages.len(),
        files.len(),
        validation.len(),
        pass_count,
        warn_count,
        fail_count,
        health
    );

    let emit_quality = emit.clone();
    let analysis_id_quality = analysis_id.to_string();
    let quality = crate::quality::build_quality_index(
        &hierarchy,
        &contents,
        &validation,
        cancel,
        move |current, total| {
            let pct = if total == 0 {
                96
            } else {
                90 + ((current as f32 / total as f32) * 9.0) as u8
            };
            emit_progress(
                &emit_quality,
                &analysis_id_quality,
                "quality",
                &format!("Precomputing quality metrics ({current}/{total})"),
                current,
                total,
                pct.min(99),
                None,
            );
        },
    )?;
    // Quality is the last consumer of full file contents — free before transport trim.
    drop(contents);

    trim_analysis_result_for_transport(&mut hierarchy, &mut validation);

    let result = AnalysisResult {
        graph,
        hierarchy,
        validation,
        suggestions: vec![],
        summary,
        dsm,
        quality: Some(quality),
    };

    emit_progress(
        &emit,
        analysis_id,
        "done",
        "Analysis complete",
        file_total,
        file_total,
        100,
        None,
    );

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn slim_ipc_drops_hierarchy_and_caps_validation() {
        let mut symbols = HashMap::new();
        symbols.insert(
            "a.ts".into(),
            vec![crate::hierarchy::SymbolInfo {
                id: "a.ts::f".into(),
                label: "f".into(),
                kind: "fn".into(),
                file: "a.ts".into(),
                line: 1,
            }],
        );
        let quality: devtree_core::QualityIndex = serde_json::from_value(serde_json::json!({
            "files": { "a.ts": { "path": "a.ts", "loc": 10, "cyclomatic": 1, "structural": 1,
                "halsteadVolume": 1, "halsteadDifficulty": 1, "cognitive": 1, "maintainability": 90,
                "dit": 0, "cbo": 0, "coverage": 0, "issueDensity": 0, "securityDensity": 0,
                "aiDensity": 0, "duplicationHits": 0 } },
            "packages": { ".": { "path": ".", "fileCount": 1, "totalLoc": 10,
                "complexity": { "avg": 1, "percentiles": { "p50": 1, "p80": 1, "p90": 1 } },
                "halstead": { "avg": 1, "percentiles": { "p50": 1, "p80": 1, "p90": 1 } },
                "cognitive": { "avg": 1, "percentiles": { "p50": 1, "p80": 1, "p90": 1 } },
                "maintainability": { "avg": 1, "percentiles": { "p50": 1, "p80": 1, "p90": 1 } },
                "cbo": { "avg": 1, "percentiles": { "p50": 1, "p80": 1, "p90": 1 } },
                "coverage": { "avg": 1, "percentiles": { "p50": 1, "p80": 1, "p90": 1 } },
                "issues": { "avg": 0, "percentiles": { "p50": 0, "p80": 0, "p90": 0 } },
                "security": { "avg": 0, "percentiles": { "p50": 0, "p80": 0, "p90": 0 } },
                "aiQuality": { "avg": 0, "percentiles": { "p50": 0, "p80": 0, "p90": 0 } },
                "duplication": { "avg": 0, "percentiles": { "p50": 0, "p80": 0, "p90": 0 } },
                "size": { "avg": 10, "percentiles": { "p50": 10, "p80": 10, "p90": 10 } } } }
        }))
        .expect("quality json");
        let full = AnalysisResult {
            graph: Graph {
                nodes: vec![],
                edges: vec![],
            },
            hierarchy: HierarchyIndex {
                version: crate::hierarchy::HIERARCHY_VERSION,
                files: vec![crate::hierarchy::FileInfo {
                    path: "a.ts".into(),
                    label: "a.ts".into(),
                    loc: 10,
                    package: ".".into(),
                }],
                packages: vec![".".into()],
                file_imports: HashMap::new(),
                package_edges: vec![],
                symbols,
                symbol_edges: vec![crate::hierarchy::SymbolEdge {
                    source: "a".into(),
                    target: "b".into(),
                    kind: "ref".into(),
                }],
                scope_graphs: HashMap::new(),
            },
            validation: vec![ValidationItem {
                rule_id: "modularity".into(),
                rule_name: "Modularity".into(),
                status: "pass".into(),
                message: "ok".into(),
                affected: (0..200).map(|i| format!("f{i}.ts")).collect(),
                cycle_groups: None,
            }],
            suggestions: vec![],
            summary: "ok".into(),
            dsm: None,
            quality: Some(quality),
        };

        let slim = slim_analysis_for_ipc(full);
        assert!(slim.hierarchy.files.is_empty());
        assert!(slim.hierarchy.symbol_edges.is_empty());
        assert!(slim.quality.as_ref().unwrap().files.is_empty());
        assert_eq!(slim.quality.as_ref().unwrap().packages.len(), 1);
        assert!(slim.validation[0].affected.len() <= 80);
    }

    #[test]
    fn persist_writes_hierarchy_lite_without_symbols() {
        let _guard = crate::analysis_cache::CACHE_ENV_LOCK.lock().unwrap();
        let tmp = std::env::temp_dir().join(format!(
            "devtree-cache-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&tmp).unwrap();
        // SAFETY: exclusive via CACHE_ENV_LOCK; restored before unlock.
        unsafe {
            std::env::set_var("DEVTREE_CACHE_DIR", &tmp);
        }

        let project = tmp.join("proj");
        std::fs::create_dir_all(&project).unwrap();
        let root = project.to_str().unwrap();

        let result = AnalysisResult {
            graph: Graph {
                nodes: vec![],
                edges: vec![],
            },
            hierarchy: HierarchyIndex {
                version: crate::hierarchy::HIERARCHY_VERSION,
                files: vec![crate::hierarchy::FileInfo {
                    path: "a.ts".into(),
                    label: "a.ts".into(),
                    loc: 3,
                    package: ".".into(),
                }],
                packages: vec![".".into()],
                file_imports: HashMap::new(),
                package_edges: vec![],
                symbols: HashMap::from([(
                    "a.ts".into(),
                    vec![crate::hierarchy::SymbolInfo {
                        id: "a.ts::f".into(),
                        label: "f".into(),
                        kind: "fn".into(),
                        file: "a.ts".into(),
                        line: 1,
                    }],
                )]),
                symbol_edges: vec![crate::hierarchy::SymbolEdge {
                    source: "a".into(),
                    target: "b".into(),
                    kind: "ref".into(),
                }],
                scope_graphs: HashMap::new(),
            },
            validation: vec![],
            suggestions: vec![],
            summary: "ok".into(),
            dsm: None,
            quality: None,
        };

        persist_analysis_result(root, &result).expect("persist");
        let lite = load_cached_hierarchy_lite(root).expect("load lite");
        assert_eq!(lite.files.len(), 1);
        assert!(lite.symbols.is_empty());
        assert!(lite.symbol_edges.is_empty());

        let _ = std::fs::remove_dir_all(&tmp);
        unsafe {
            std::env::remove_var("DEVTREE_CACHE_DIR");
        }
    }

    #[test]
    fn devtree_resolves_file_imports() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("project root");
        let result = run_analysis(root.to_str().unwrap(), &[]).expect("analysis");
        let h = &result.hierarchy;
        let resolved: usize = h.file_imports.values().map(|v| v.len()).sum();
        eprintln!("packages: {:?}", h.packages);
        eprintln!("files: {}", h.files.len());
        eprintln!(
            "files with imports: {}",
            h.file_imports.iter().filter(|(_, v)| !v.is_empty()).count()
        );
        eprintln!("total resolved imports: {resolved}");
        eprintln!("package_edges: {}", h.package_edges.len());
        if let Some(targets) = h.file_imports.get("src/main.ts") {
            eprintln!("main.ts -> {:?}", targets);
        }
        assert!(
            resolved > 20,
            "expected many resolved imports, got {resolved}"
        );
    }
}
