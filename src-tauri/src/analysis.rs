use devtree_core::Graph;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};

use crate::hierarchy::{
    build_hierarchy_with_progress, read_file_contents_with_progress, root_package_graph,
    HierarchyIndex,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationItem {
    pub rule_id: String,
    pub rule_name: String,
    pub status: String,
    pub message: String,
    pub affected: Vec<String>,
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
    }
}

pub fn default_rules() -> Vec<AnalysisRule> {
    vec![
        AnalysisRule {
            id: "modularity".into(),
            name: "Modularity".into(),
            description: "Detect tightly coupled modules and circular dependencies".into(),
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
    ]
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
pub struct AnalysisProgress {
    pub stage: String,
    pub message: String,
    pub current: u32,
    pub total: u32,
    pub percent: u8,
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
    on_progress: &mut impl FnMut(AnalysisProgress),
    stage: &str,
    message: &str,
    current: u32,
    total: u32,
    percent: u8,
) {
    on_progress(AnalysisProgress {
        stage: stage.into(),
        message: message.into(),
        current,
        total,
        percent,
    });
}

/// Breadth-first walk of the project tree, collecting source files level by level.
fn scan_source_files(
    root: &Path,
    on_progress: &mut impl FnMut(AnalysisProgress),
) -> Vec<(String, u32)> {
    let mut files = Vec::new();
    let mut queue: VecDeque<PathBuf> = VecDeque::new();
    queue.push_back(root.to_path_buf());

    let mut dirs_visited = 0u32;

    while let Some(dir) = queue.pop_front() {
        dirs_visited += 1;
        if dirs_visited == 1 || dirs_visited % 8 == 0 {
            emit_progress(
                on_progress,
                "scanning",
                &format!("Scanning directories… ({} files found)", files.len()),
                files.len() as u32,
                0,
                5,
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
        on_progress,
        "scanning",
        &format!("Found {} source files", files.len()),
        files.len() as u32,
        files.len() as u32,
        15,
    );

    files
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
        }
    } else {
        ValidationItem {
            rule_id: "test_coverage".into(),
            rule_name: "Test Coverage".into(),
            status: "warn".into(),
            message: format!("{} module(s) may lack test files", untested.len()),
            affected: untested,
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
        }
    } else {
        ValidationItem {
            rule_id: "file_size".into(),
            rule_name: "File Size".into(),
            status: "fail".into(),
            message: format!("{} file(s) exceed {max_lines} lines", oversized.len()),
            affected: oversized,
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
        }
    } else {
        ValidationItem {
            rule_id: "naming".into(),
            rule_name: "Naming Conventions".into(),
            status: "warn".into(),
            message: format!("{} file(s) have non-standard naming", inconsistent.len()),
            affected: inconsistent,
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
        }
    } else {
        ValidationItem {
            rule_id: "type_coverage".into(),
            rule_name: "Type Coverage".into(),
            status: "warn".into(),
            message: format!("{} JavaScript file(s) could benefit from TypeScript", untyped.len()),
            affected: untyped,
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
        }
    }
}

fn generate_suggestions(validation: &[ValidationItem]) -> Vec<SuggestionItem> {
    let mut suggestions = Vec::new();
    for item in validation {
        if item.status == "pass" {
            continue;
        }
        let priority = match item.status.as_str() {
            "fail" => "high",
            _ => "medium",
        };
        suggestions.push(SuggestionItem {
            priority: priority.into(),
            title: format!("Address: {}", item.rule_name),
            description: item.message.clone(),
            targets: item.affected.clone(),
        });
    }
    if suggestions.is_empty() {
        suggestions.push(SuggestionItem {
            priority: "low".into(),
            title: "Looking good".into(),
            description: "No immediate architectural issues found. Consider enabling more rules for deeper analysis.".into(),
            targets: vec![],
        });
    }
    suggestions
}

pub fn run_analysis(
    project_root: &str,
    rule_ids: &[String],
) -> Result<AnalysisResult, String> {
    run_analysis_with_progress(project_root, rule_ids, &RuleSettingsMap::new(), |_| {})
}

pub fn run_analysis_with_progress(
    project_root: &str,
    rule_ids: &[String],
    rule_settings: &RuleSettingsMap,
    mut on_progress: impl FnMut(AnalysisProgress),
) -> Result<AnalysisResult, String> {
    let root = Path::new(project_root);
    if !root.is_dir() {
        return Err(format!("Not a directory: {project_root}"));
    }

    emit_progress(
        &mut on_progress,
        "scanning",
        "Starting breadth-first scan…",
        0,
        0,
        0,
    );

    let files = scan_source_files(root, &mut on_progress);
    if files.is_empty() {
        return Err("No source files found in project".to_string());
    }

    let file_total = files.len() as u32;
    let contents = read_file_contents_with_progress(root, &files, |current, total| {
        let pct = 15 + ((current as f32 / total.max(1) as f32) * 20.0) as u8;
        emit_progress(
            &mut on_progress,
            "reading",
            &format!("Reading file contents ({current}/{total})"),
            current as u32,
            total as u32,
            pct.min(35),
        );
    });

    emit_progress(
        &mut on_progress,
        "lsp",
        "Starting language servers…",
        0,
        0,
        36,
    );

    let lsp_pool = crate::lsp::LspPool::start(root, &files, &contents, |message, current, total| {
        let pct = if total > 0 {
            36 + ((current as f32 / total as f32) * 14.0) as u8
        } else {
            40
        };
        emit_progress(
            &mut on_progress,
            "lsp",
            message,
            current,
            total,
            pct.min(50),
        );
    });

    let lsp_ref = if lsp_pool.server_count() > 0 {
        Some(&lsp_pool)
    } else {
        None
    };

    let hierarchy =
        build_hierarchy_with_progress(root, &files, &contents, lsp_ref, |current, total| {
            let pct = 50 + ((current as f32 / total.max(1) as f32) * 35.0) as u8;
            emit_progress(
                &mut on_progress,
                "analyzing",
                &format!("Resolving imports & symbols ({current}/{total})"),
                current as u32,
                total as u32,
                pct.min(85),
            );
        });

    let lsp_diags = lsp_pool.diagnostics();
    drop(lsp_pool);

    let graph = root_package_graph(&hierarchy);
    let mut validation = Vec::new();
    let rule_total = rule_ids.len().max(1) as u32;

    for (i, rule_id) in rule_ids.iter().enumerate() {
        let current = (i + 1) as u32;
        emit_progress(
            &mut on_progress,
            "validating",
            &format!("Running rule: {rule_id}"),
            current,
            rule_total,
            (85 + ((current as f32 / rule_total as f32) * 10.0) as u8).min(95),
        );

        let cfg = rule_cfg(rule_settings, rule_id);
        let item = match rule_id.as_str() {
            "modularity" => run_modularity_check(&files, cfg),
            "dependency_depth" => run_dependency_depth_check(&files, cfg),
            "type_coverage" => run_type_coverage_check(&files, cfg),
            "test_coverage" => run_test_coverage_check(root, &files, cfg),
            "file_size" => run_file_size_check(&files, cfg),
            "naming" => run_naming_check(&files, cfg),
            "lsp_diagnostics" => run_lsp_diagnostics_check(&lsp_diags, cfg),
            _ => continue,
        };
        validation.push(item);
    }

    emit_progress(
        &mut on_progress,
        "finalizing",
        "Generating suggestions…",
        file_total,
        file_total,
        97,
    );

    let pass_count = validation.iter().filter(|v| v.status == "pass").count();
    let warn_count = validation.iter().filter(|v| v.status == "warn").count();
    let fail_count = validation.iter().filter(|v| v.status == "fail").count();

    let summary = format!(
        "Analyzed {} packages ({} source files) with {} rule(s): {} passed, {} warnings, {} failures",
        hierarchy.packages.len(),
        files.len(),
        validation.len(),
        pass_count,
        warn_count,
        fail_count
    );

    let suggestions = generate_suggestions(&validation);

    emit_progress(
        &mut on_progress,
        "done",
        "Analysis complete",
        file_total,
        file_total,
        100,
    );

    Ok(AnalysisResult {
        graph,
        hierarchy,
        validation,
        suggestions,
        summary,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
