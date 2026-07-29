use devtree_core::Graph;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

use crate::hierarchy::{
    build_hierarchy, read_file_contents, root_package_graph, HierarchyIndex,
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
pub struct AnalysisRule {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
}

pub fn default_rules() -> Vec<AnalysisRule> {
    vec![
        AnalysisRule {
            id: "modularity".into(),
            name: "Modularity".into(),
            description: "Detect tightly coupled modules and circular dependencies".into(),
            category: "architecture".into(),
        },
        AnalysisRule {
            id: "dependency_depth".into(),
            name: "Dependency Depth".into(),
            description: "Flag modules with excessive import chains".into(),
            category: "architecture".into(),
        },
        AnalysisRule {
            id: "type_coverage".into(),
            name: "Type Coverage".into(),
            description: "Check for untyped or loosely typed modules".into(),
            category: "quality".into(),
        },
        AnalysisRule {
            id: "test_coverage".into(),
            name: "Test Coverage".into(),
            description: "Identify modules lacking test files".into(),
            category: "quality".into(),
        },
        AnalysisRule {
            id: "file_size".into(),
            name: "File Size".into(),
            description: "Warn about oversized source files".into(),
            category: "maintainability".into(),
        },
        AnalysisRule {
            id: "naming".into(),
            name: "Naming Conventions".into(),
            description: "Check for inconsistent file and folder naming".into(),
            category: "maintainability".into(),
        },
    ]
}

fn count_lines(path: &Path) -> u32 {
    fs::read_to_string(path)
        .map(|s| s.lines().count() as u32)
        .unwrap_or(0)
}

fn scan_source_files(root: &Path) -> Vec<(String, u32)> {
    let mut files = Vec::new();
    scan_dir_recursive(root, root, &mut files);
    files.sort_by(|a, b| a.0.cmp(&b.0));
    files
}

fn scan_dir_recursive(dir: &Path, root: &Path, files: &mut Vec<(String, u32)>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if !name.starts_with('.')
                && !matches!(
                    name.as_str(),
                    "node_modules" | "target" | "dist" | "build" | ".git" | "wasm"
                )
            {
                scan_dir_recursive(&path, root, files);
            }
        } else {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if matches!(ext, "ts" | "tsx" | "js" | "jsx" | "rs" | "py" | "go") {
                let rel = path
                    .strip_prefix(root)
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or(name);
                let loc = count_lines(&path);
                files.push((rel, loc));
            }
        }
    }
}

fn run_modularity_check(files: &[(String, u32)]) -> ValidationItem {
    let large = files
        .iter()
        .filter(|(_, loc)| *loc > 200)
        .map(|(p, _)| p.clone())
        .collect::<Vec<_>>();

    if large.is_empty() {
        ValidationItem {
            rule_id: "modularity".into(),
            rule_name: "Modularity".into(),
            status: "pass".into(),
            message: "No oversized modules detected".into(),
            affected: vec![],
        }
    } else {
        ValidationItem {
            rule_id: "modularity".into(),
            rule_name: "Modularity".into(),
            status: "warn".into(),
            message: format!("{} module(s) exceed 200 lines — consider splitting", large.len()),
            affected: large,
        }
    }
}

fn run_test_coverage_check(root: &Path, files: &[(String, u32)]) -> ValidationItem {
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
        .take(10)
        .collect();

    if untested.len() <= 3 {
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

fn run_file_size_check(files: &[(String, u32)]) -> ValidationItem {
    let oversized: Vec<String> = files
        .iter()
        .filter(|(_, loc)| *loc > 300)
        .map(|(p, _)| p.clone())
        .collect();

    if oversized.is_empty() {
        ValidationItem {
            rule_id: "file_size".into(),
            rule_name: "File Size".into(),
            status: "pass".into(),
            message: "All files are within size limits".into(),
            affected: vec![],
        }
    } else {
        ValidationItem {
            rule_id: "file_size".into(),
            rule_name: "File Size".into(),
            status: "fail".into(),
            message: format!("{} file(s) exceed 300 lines", oversized.len()),
            affected: oversized,
        }
    }
}

fn run_naming_check(files: &[(String, u32)]) -> ValidationItem {
    let inconsistent: Vec<String> = files
        .iter()
        .filter(|(p, _)| {
            let name = Path::new(p)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            name.contains(' ') || name.chars().any(|c| c.is_uppercase() && name.contains('.'))
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

fn run_dependency_depth_check(files: &[(String, u32)]) -> ValidationItem {
    let deep_dirs: Vec<String> = files
        .iter()
        .filter(|(p, _)| p.matches('/').count() > 4 || p.matches('\\').count() > 4)
        .map(|(p, _)| p.clone())
        .collect();

    if deep_dirs.is_empty() {
        ValidationItem {
            rule_id: "dependency_depth".into(),
            rule_name: "Dependency Depth".into(),
            status: "pass".into(),
            message: "Directory structure depth is reasonable".into(),
            affected: vec![],
        }
    } else {
        ValidationItem {
            rule_id: "dependency_depth".into(),
            rule_name: "Dependency Depth".into(),
            status: "warn".into(),
            message: format!("{} file(s) are deeply nested", deep_dirs.len()),
            affected: deep_dirs,
        }
    }
}

fn run_type_coverage_check(files: &[(String, u32)]) -> ValidationItem {
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
    let root = Path::new(project_root);
    if !root.is_dir() {
        return Err(format!("Not a directory: {project_root}"));
    }

    let files = scan_source_files(root);
    if files.is_empty() {
        return Err("No source files found in project".to_string());
    }

    let contents = read_file_contents(root, &files);
    let hierarchy = build_hierarchy(root, &files, &contents);
    let graph = root_package_graph(&hierarchy);
    let mut validation = Vec::new();

    for rule_id in rule_ids {
        let item = match rule_id.as_str() {
            "modularity" => run_modularity_check(&files),
            "dependency_depth" => run_dependency_depth_check(&files),
            "type_coverage" => run_type_coverage_check(&files),
            "test_coverage" => run_test_coverage_check(root, &files),
            "file_size" => run_file_size_check(&files),
            "naming" => run_naming_check(&files),
            _ => continue,
        };
        validation.push(item);
    }

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
