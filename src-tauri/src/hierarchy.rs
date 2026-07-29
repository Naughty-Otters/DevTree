use devtree_core::{Edge, Graph, Node};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use crate::analysis_session::check_cancelled;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolInfo {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub file: String,
    pub line: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolEdge {
    pub source: String,
    pub target: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub path: String,
    pub label: String,
    pub loc: u32,
    pub package: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageEdge {
    pub source: String,
    pub target: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScopeGraphNode {
    pub id: String,
    pub label: String,
    pub path: String,
    pub loc: u32,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScopeGraph {
    pub nodes: Vec<ScopeGraphNode>,
    pub edges: Vec<PackageEdge>,
}

pub const HIERARCHY_VERSION: u32 = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HierarchyIndex {
    pub version: u32,
    pub files: Vec<FileInfo>,
    pub packages: Vec<String>,
    pub file_imports: HashMap<String, Vec<String>>,
    pub package_edges: Vec<PackageEdge>,
    pub symbols: HashMap<String, Vec<SymbolInfo>>,
    pub symbol_edges: Vec<SymbolEdge>,
    pub scope_graphs: HashMap<String, ScopeGraph>,
}

fn parent_dir(path: &str) -> String {
    Path::new(path)
        .parent()
        .map(|p| {
            if p.as_os_str().is_empty() {
                ".".to_string()
            } else {
                p.to_string_lossy().to_string()
            }
        })
        .unwrap_or_else(|| ".".to_string())
}

#[derive(Debug, Clone)]
struct PackageRoot {
    path: String,
    crate_names: Vec<String>,
}

const SKIP_DIRS: &[&str] = &[
    "node_modules", "target", "dist", "build", ".git", ".next", ".nuxt",
    ".cache", "coverage", "__pycache__", ".venv", "venv", ".idea", ".vscode", "pkg", "wasm",
];

fn should_skip_dir(name: &str) -> bool {
    SKIP_DIRS.contains(&name) || name.starts_with('.')
}

fn rel_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(|p| {
            if p.as_os_str().is_empty() {
                ".".to_string()
            } else {
                p.to_string_lossy().replace('\\', "/")
            }
        })
        .unwrap_or_else(|_| path.to_string_lossy().replace('\\', "/"))
}

fn discover_package_roots(root: &Path, dir: &Path, out: &mut Vec<PackageRoot>) {
    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string());

    if dir != root && should_skip_dir(&name) {
        return;
    }

    let rel = rel_path(root, dir);
    let cargo_path = dir.join("Cargo.toml");
    let pkg_json_path = dir.join("package.json");

    if cargo_path.is_file() {
        if let Ok(content) = std::fs::read_to_string(&cargo_path) {
            if content.contains("[package]") {
                let pkg_name = parse_toml_package_name(&content).unwrap_or_else(|| name.clone());
                let lib_name = parse_toml_lib_name(&content);
                let mut crate_names = vec![
                    pkg_name.replace('-', "_"),
                    pkg_name.clone(),
                ];
                if let Some(lib) = lib_name {
                    crate_names.push(lib.replace('-', "_"));
                    crate_names.push(lib);
                }
                crate_names.sort();
                crate_names.dedup();
                out.push(PackageRoot {
                    path: rel.clone(),
                    crate_names,
                });
            }
        }
    }

    if pkg_json_path.is_file() {
        if std::fs::read_to_string(&pkg_json_path).is_ok() {
            out.push(PackageRoot {
                path: rel.clone(),
                crate_names: vec![],
            });
        }
    }

    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.path().is_dir() {
            discover_package_roots(root, &entry.path(), out);
        }
    }
}

fn parse_toml_package_name(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("name = ") {
            return extract_quoted(trimmed.trim_start_matches("name = ").trim());
        }
    }
    None
}

fn parse_toml_lib_name(content: &str) -> Option<String> {
    let mut in_lib = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "[lib]" {
            in_lib = true;
            continue;
        }
        if trimmed.starts_with('[') {
            in_lib = false;
        }
        if in_lib && trimmed.starts_with("name = ") {
            return extract_quoted(trimmed.trim_start_matches("name = ").trim());
        }
    }
    None
}

fn owning_package(file_path: &str, roots: &[PackageRoot]) -> String {
    let mut best = ".".to_string();
    let mut best_len = 0;
    for root in roots {
        if root.path == "." {
            continue;
        }
        if file_path == root.path || file_path.starts_with(&format!("{}/", root.path)) {
            if root.path.len() > best_len {
                best = root.path.clone();
                best_len = root.path.len();
            }
        }
    }
    best
}

fn package_roots_list(roots: &[PackageRoot]) -> Vec<String> {
    let mut paths: Vec<String> = roots.iter().map(|r| r.path.clone()).collect();
    paths.sort();
    paths.dedup();
    paths
}

fn find_package_by_crate<'a>(roots: &'a [PackageRoot], crate_name: &str) -> Option<&'a PackageRoot> {
    let normalized = crate_name.replace('-', "_");
    roots.iter().find(|r| {
        r.crate_names.iter().any(|n| n == crate_name || n.replace('-', "_") == normalized)
    })
}

fn find_entry_file(package_path: &str, all_files: &HashSet<String>) -> Option<String> {
    let candidates = if package_path == "." {
        vec![
            "src/index.ts".into(),
            "src/main.ts".into(),
            "index.ts".into(),
            "main.ts".into(),
        ]
    } else {
        vec![
            format!("{package_path}/src/lib.rs"),
            format!("{package_path}/src/main.rs"),
            format!("{package_path}/lib.rs"),
            format!("{package_path}/src/index.ts"),
            format!("{package_path}/src/main.ts"),
        ]
    };
    for cand in candidates {
        if all_files.contains(&cand) {
            return Some(cand);
        }
    }
    all_files
        .iter()
        .filter(|f| *f == package_path || f.starts_with(&format!("{package_path}/")))
        .min()
        .cloned()
}

fn parse_cargo_path_dependencies(cargo_path: &Path, project_root: &Path) -> Vec<(String, String)> {
    let Ok(content) = std::fs::read_to_string(cargo_path) else {
        return Vec::new();
    };
    let source_pkg = rel_path(project_root, cargo_path.parent().unwrap_or(cargo_path));
    let mut edges = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if !trimmed.contains("path") {
            continue;
        }
        let Some(eq_idx) = trimmed.find('=') else {
            continue;
        };
        let dep_name = trimmed[..eq_idx].trim();
        if dep_name.is_empty() || dep_name.starts_with('[') {
            continue;
        }
        if let Some(path_val) = extract_toml_path_value(trimmed) {
            let base = cargo_path.parent().unwrap_or(cargo_path);
            let joined = base.join(path_val);
            let target = normalize_path(&rel_path(project_root, &joined));
            edges.push((source_pkg.clone(), target));
        }
    }
    edges
}

fn extract_toml_path_value(line: &str) -> Option<String> {
    if let Some(idx) = line.find("path") {
        let rest = &line[idx..];
        if let Some(quoted) = extract_quoted(rest) {
            return Some(quoted);
        }
    }
    None
}

fn collect_manifest_package_edges(root: &Path, package_roots: &[PackageRoot]) -> Vec<PackageEdge> {
    let mut edges = Vec::new();
    let mut seen = HashSet::new();

    for pkg in package_roots {
        if pkg.path == "." {
            let pkg_json = root.join("package.json");
            if pkg_json.is_file() {
                if let Ok(content) = std::fs::read_to_string(&pkg_json) {
                    for line in content.lines() {
                        let trimmed = line.trim();
                        if trimmed.contains("file:") {
                            if let Some(path_val) = extract_quoted(trimmed) {
                                let target = normalize_path(&path_val.trim_start_matches("file:"));
                                let key = (pkg.path.clone(), target.clone());
                                if seen.insert(key) {
                                    edges.push(PackageEdge {
                                        source: pkg.path.clone(),
                                        target,
                                        kind: "manifest".into(),
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
        let cargo = if pkg.path == "." {
            root.join("Cargo.toml")
        } else {
            root.join(&pkg.path).join("Cargo.toml")
        };
        if cargo.is_file() {
            for (_, target) in parse_cargo_path_dependencies(&cargo, root) {
                let key = (pkg.path.clone(), target.clone());
                if seen.insert(key) {
                    edges.push(PackageEdge {
                        source: pkg.path.clone(),
                        target,
                        kind: "manifest".into(),
                    });
                }
            }
        }
    }
    edges
}

fn collect_import_package_edges(
    file_infos: &[FileInfo],
    file_imports: &HashMap<String, Vec<String>>,
) -> Vec<PackageEdge> {
    let mut edges = Vec::new();
    let mut seen = HashSet::new();
    let pkg_by_file: HashMap<&str, &str> = file_infos
        .iter()
        .map(|f| (f.path.as_str(), f.package.as_str()))
        .collect();

    for (source_file, targets) in file_imports {
        let Some(source_pkg) = pkg_by_file.get(source_file.as_str()) else {
            continue;
        };
        for target in targets {
            let Some(target_pkg) = pkg_by_file.get(target.as_str()) else {
                continue;
            };
            if source_pkg == target_pkg {
                continue;
            }
            let key = (source_pkg.to_string(), target_pkg.to_string());
            if seen.insert(key) {
                edges.push(PackageEdge {
                    source: source_pkg.to_string(),
                    target: target_pkg.to_string(),
                    kind: "import".into(),
                });
            }
        }
    }
    edges
}

fn package_label(package: &str) -> String {
    if package == "." {
        "(root)".to_string()
    } else {
        Path::new(package)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| package.to_string())
    }
}

fn file_label(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

fn extract_quoted(s: &str) -> Option<String> {
    let trimmed = s.trim_start();
    for quote in ['\'', '"'] {
        if !trimmed.starts_with(quote) {
            continue;
        }
        if let Some(end) = trimmed[1..].find(quote) {
            return Some(trimmed[1..1 + end].to_string());
        }
    }
    None
}

fn extract_ts_imports(content: &str) -> Vec<String> {
    let mut imports = Vec::new();

    for (idx, _) in content.match_indices(" from ") {
        let rest = &content[idx + 6..];
        let line_end = rest.find('\n').unwrap_or(rest.len());
        let line = &rest[..line_end];
        if let Some(path) = extract_quoted(line.trim_start()) {
            imports.push(path);
        }
    }

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("import ") && !trimmed.contains(" from ") {
            let rest = trimmed
                .trim_start_matches("import ")
                .trim_start_matches("type ")
                .trim();
            if let Some(path) = extract_quoted(rest) {
                imports.push(path);
            }
        }
        if trimmed.contains("import(") {
            if let Some(idx) = trimmed.find("import(") {
                let rest = &trimmed[idx + 7..];
                if let Some(path) = extract_quoted(rest.trim_start()) {
                    imports.push(path);
                }
            }
        }
    }

    imports.sort();
    imports.dedup();
    imports
}

fn extract_rs_imports(content: &str) -> Vec<String> {
    let mut imports = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("use ") {
            let rest = trimmed
                .trim_start_matches("use ")
                .trim_end_matches(';')
                .split('{')
                .next()
                .unwrap_or("")
                .split(" as ")
                .next()
                .unwrap_or("")
                .trim();
            if !rest.is_empty() {
                imports.push(rest.to_string());
            }
        } else if trimmed.starts_with("mod ") {
            let name = trimmed
                .trim_start_matches("mod ")
                .trim_end_matches(';')
                .split_whitespace()
                .next()
                .unwrap_or("");
            if !name.is_empty() {
                imports.push(name.to_string());
            }
        }
    }
    imports
}

fn extract_py_imports(content: &str) -> Vec<String> {
    let mut imports = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("import ") {
            let rest = trimmed.trim_start_matches("import ").split(',').next().unwrap_or("");
            let module = rest.split_whitespace().next().unwrap_or("").trim();
            if !module.is_empty() {
                imports.push(module.replace('.', "/"));
            }
        } else if trimmed.starts_with("from ") {
            let rest = trimmed.trim_start_matches("from ").trim_end_matches(" import");
            let module = rest.split_whitespace().next().unwrap_or("").trim();
            if !module.is_empty() && module != "." {
                imports.push(module.replace('.', "/"));
            }
        }
    }
    imports
}

fn resolve_import(
    from_file: &str,
    import_path: &str,
    all_files: &HashSet<String>,
    package_roots: &[PackageRoot],
) -> Option<String> {
    if import_path.starts_with('.') {
        let from_dir = parent_dir(from_file);
        let base = PathBuf::from(&from_dir).join(import_path);
        let normalized = normalize_path(&base.to_string_lossy());
        for cand in build_file_candidates(&normalized) {
            if all_files.contains(&cand) {
                return Some(cand);
            }
        }
    }

    if import_path.starts_with("self::") {
        let from_dir = parent_dir(from_file);
        let module = import_path.strip_prefix("self::").unwrap_or("").replace("::", "/");
        let base = if module.is_empty() {
            from_dir.clone()
        } else if from_dir == "." {
            format!("src/{module}")
        } else {
            format!("{from_dir}/{module}")
        };
        for cand in build_file_candidates(&base) {
            if all_files.contains(&cand) {
                return Some(cand);
            }
        }
    }

    if import_path == "crate" || import_path.starts_with("crate::") {
        let from_pkg = owning_package(from_file, package_roots);
        let module = import_path
            .strip_prefix("crate::")
            .unwrap_or("")
            .replace("::", "/");
        let base = if from_pkg == "." {
            format!("src/{module}")
        } else {
            format!("{from_pkg}/src/{module}")
        };
        for cand in build_file_candidates(&base) {
            if all_files.contains(&cand) {
                return Some(cand);
            }
        }
    }

    if import_path == "super" || import_path.starts_with("super::") {
        let from_dir = parent_dir(from_file);
        let parent = parent_dir(&from_dir);
        let module = import_path
            .strip_prefix("super::")
            .unwrap_or("")
            .replace("::", "/");
        let base = if parent == "." {
            if module.is_empty() {
                from_dir.clone()
            } else {
                format!("src/{module}")
            }
        } else if module.is_empty() {
            parent.clone()
        } else {
            format!("{parent}/{module}")
        };
        for cand in build_file_candidates(&base) {
            if all_files.contains(&cand) {
                return Some(cand);
            }
        }
    }

    let crate_head = import_path.split("::").next().unwrap_or(import_path);
    if let Some(pkg) = find_package_by_crate(package_roots, crate_head) {
        if let Some(entry) = find_entry_file(&pkg.path, all_files) {
            return Some(entry);
        }
    }

    let mut cands = Vec::new();
    for prefix in ["", "src/", "lib/"] {
        let joined = format!("{prefix}{}", import_path.replace('\\', "/"));
        cands.extend(build_file_candidates(&joined));
    }
    for cand in cands {
        if all_files.contains(&cand) {
            return Some(cand);
        }
    }
    None
}

fn normalize_path(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "." | "" => {}
            ".." => {
                parts.pop();
            }
            p => parts.push(p),
        }
    }
    if parts.is_empty() {
        ".".to_string()
    } else {
        parts.join("/")
    }
}

fn build_file_candidates(base: &str) -> Vec<String> {
    let clean = base.trim_end_matches('/');
    vec![
        clean.to_string(),
        format!("{clean}.ts"),
        format!("{clean}.tsx"),
        format!("{clean}.js"),
        format!("{clean}.jsx"),
        format!("{clean}.rs"),
        format!("{clean}.py"),
        format!("{clean}.go"),
        format!("{clean}/mod.rs"),
        format!("{clean}/index.ts"),
        format!("{clean}/index.tsx"),
        format!("{clean}/index.js"),
    ]
}

fn extract_symbols(file_path: &str, content: &str) -> (Vec<SymbolInfo>, Vec<SymbolEdge>) {
    let ext = Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    let mut symbols = Vec::new();
    let mut names: Vec<(String, String, u32)> = Vec::new();

    for (i, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        let line_no = (i + 1) as u32;

        let parsed = match ext {
            "rs" => parse_rs_symbol(trimmed),
            "py" => parse_py_symbol(trimmed),
            _ => parse_ts_symbol(trimmed),
        };

        if let Some((kind, name)) = parsed {
            names.push((name.clone(), kind.clone(), line_no));
            symbols.push(SymbolInfo {
                id: format!("{file_path}::{name}"),
                label: name,
                kind,
                file: file_path.to_string(),
                line: line_no,
            });
        }
    }

    let mut edges = Vec::new();
    for (i, sym) in symbols.iter().enumerate() {
        let start = sym.line as usize;
        let end = symbols
            .get(i + 1)
            .map(|s| s.line as usize - 1)
            .unwrap_or(content.lines().count());
        let body: String = content
            .lines()
            .skip(start.saturating_sub(1))
            .take(end.saturating_sub(start.saturating_sub(1)).max(1))
            .collect::<Vec<_>>()
            .join("\n");

        for other in &symbols {
            if other.id == sym.id {
                continue;
            }
            if body.contains(&other.label) {
                edges.push(SymbolEdge {
                    source: sym.id.clone(),
                    target: other.id.clone(),
                    kind: "reference".into(),
                });
            }
        }
    }

    (symbols, edges)
}

fn parse_ts_symbol(line: &str) -> Option<(String, String)> {
    const PREFIXES: &[(&str, &str)] = &[
        ("export async function ", "function"),
        ("export function ", "function"),
        ("async function ", "function"),
        ("function ", "function"),
        ("export class ", "class"),
        ("class ", "class"),
        ("export interface ", "interface"),
        ("interface ", "interface"),
        ("export type ", "type"),
        ("type ", "type"),
        ("export const ", "const"),
        ("export let ", "variable"),
        ("export var ", "variable"),
        ("const ", "const"),
        ("let ", "variable"),
    ];

    for (prefix, kind) in PREFIXES {
        if let Some(rest) = line.strip_prefix(prefix) {
            let name = rest
                .split(|c: char| !c.is_alphanumeric() && c != '_')
                .next()
                .unwrap_or("")
                .to_string();
            if !name.is_empty() {
                return Some((kind.to_string(), name));
            }
        }
    }
    None
}

fn parse_rs_symbol(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim();
    let kinds = [
        ("pub async fn ", "function"),
        ("pub fn ", "function"),
        ("async fn ", "function"),
        ("fn ", "function"),
        ("pub struct ", "struct"),
        ("struct ", "struct"),
        ("pub enum ", "enum"),
        ("enum ", "enum"),
        ("pub trait ", "trait"),
        ("trait ", "trait"),
        ("pub type ", "type"),
        ("type ", "type"),
        ("pub const ", "const"),
        ("const ", "const"),
    ];
    for (prefix, kind) in kinds {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            let name = rest
                .split(|c: char| !c.is_alphanumeric() && c != '_')
                .next()
                .unwrap_or("")
                .to_string();
            if !name.is_empty() {
                return Some((kind.to_string(), name));
            }
        }
    }
    None
}

fn parse_py_symbol(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim();
    if let Some(rest) = trimmed.strip_prefix("class ") {
        let name = rest
            .split(|c: char| !c.is_alphanumeric() && c != '_')
            .next()
            .unwrap_or("")
            .to_string();
        if !name.is_empty() {
            return Some(("class".into(), name));
        }
    }
    if let Some(rest) = trimmed.strip_prefix("def ") {
        let name = rest
            .split(|c: char| !c.is_alphanumeric() && c != '_')
            .next()
            .unwrap_or("")
            .to_string();
        if !name.is_empty() {
            return Some(("function".into(), name));
        }
    }
    None
}

fn collect_heuristic_package_edges(
    file_infos: &[FileInfo],
    contents: &HashMap<String, String>,
    package_roots: &[PackageRoot],
) -> Vec<PackageEdge> {
    let Some(core_pkg) = package_roots
        .iter()
        .find(|p| p.path.contains("devtree-core"))
        .map(|p| p.path.clone())
    else {
        return Vec::new();
    };

    let mut edges = Vec::new();
    let mut seen = HashSet::new();

    for file in file_infos {
        let content = contents.get(&file.path).map(|s| s.as_str()).unwrap_or("");
        if content.contains("devtree_core") || content.contains("devtree-core") {
            let key = (file.package.clone(), core_pkg.clone());
            if seen.insert(key) {
                edges.push(PackageEdge {
                    source: file.package.clone(),
                    target: core_pkg.clone(),
                    kind: "wasm".into(),
                });
            }
        }
    }
    edges
}

fn files_in_scope_slice<'a>(
    file_infos: &'a [FileInfo],
    packages: &[String],
    package_path: &str,
) -> Vec<&'a FileInfo> {
    if packages.iter().any(|p| p == package_path) {
        file_infos
            .iter()
            .filter(|f| f.package == package_path)
            .collect()
    } else if package_path == "." {
        file_infos.iter().filter(|f| f.package == ".").collect()
    } else {
        let prefix = format!("{}/", package_path);
        file_infos
            .iter()
            .filter(|f| f.path == package_path || f.path.starts_with(&prefix))
            .collect()
    }
}

fn immediate_child_path_scope(package_path: &str, file_path: &str) -> Option<String> {
    if package_path == "." {
        if let Some(slash) = file_path.find('/') {
            return Some(file_path[..slash].to_string());
        }
        return Some(file_path.to_string());
    }
    let prefix = format!("{}/", package_path);
    if !file_path.starts_with(&prefix) {
        return None;
    }
    let rest = &file_path[prefix.len()..];
    if let Some(slash) = rest.find('/') {
        Some(format!("{}/{}", package_path, &rest[..slash]))
    } else {
        Some(file_path.to_string())
    }
}

fn external_peer_folder(scope: &str, target: &str) -> Option<String> {
    if target.starts_with(&format!("{}/", scope)) || target == scope {
        return None;
    }
    if scope == "." {
        return immediate_child_path_scope(".", target);
    }
    let scope_parent = parent_dir(scope);
    if target.starts_with(&format!("{}/", scope_parent)) {
        immediate_child_path_scope(&scope_parent, target)
    } else {
        immediate_child_path_scope(".", target)
    }
}

fn scope_package_content_children(
    file_infos: &[FileInfo],
    packages: &[String],
    package_path: &str,
) -> Vec<ScopeGraphNode> {
    let scoped = files_in_scope_slice(file_infos, packages, package_path);
    let mut nodes: HashMap<String, ScopeGraphNode> = HashMap::new();

    for file in &scoped {
        let dir = parent_dir(&file.path);
        if dir == package_path {
            nodes.insert(
                file.path.clone(),
                ScopeGraphNode {
                    id: file.path.clone(),
                    label: file.label.clone(),
                    path: file.path.clone(),
                    loc: file.loc,
                    kind: "file".into(),
                },
            );
            continue;
        }

        let Some(sub_path) = immediate_child_path_scope(package_path, &file.path) else {
            continue;
        };
        if sub_path == file.path {
            continue;
        }

        nodes
            .entry(sub_path.clone())
            .or_insert_with(|| {
                let prefix = format!("{}/", sub_path);
                let loc: u32 = scoped
                    .iter()
                    .filter(|f| f.path == sub_path || f.path.starts_with(&prefix))
                    .map(|f| f.loc)
                    .sum();
                ScopeGraphNode {
                    id: sub_path.clone(),
                    label: package_label(&sub_path),
                    path: sub_path.clone(),
                    loc,
                    kind: "package".into(),
                }
            });
    }

    let mut out: Vec<_> = nodes.into_values().collect();
    out.sort_by(|a, b| a.label.cmp(&b.label));
    out
}

fn map_file_to_scope_node(file_path: &str, child_ids: &HashSet<String>) -> Option<String> {
    if child_ids.contains(file_path) {
        return Some(file_path.to_string());
    }
    let mut best: Option<&String> = None;
    for id in child_ids {
        if file_path.starts_with(&format!("{}/", id)) {
            match best {
                None => best = Some(id),
                Some(b) if id.len() > b.len() => best = Some(id),
                _ => {}
            }
        }
    }
    best.cloned()
}

fn scope_package_content_edges(
    file_infos: &[FileInfo],
    file_imports: &HashMap<String, Vec<String>>,
    packages: &[String],
    package_path: &str,
    children: &[ScopeGraphNode],
) -> (Vec<PackageEdge>, Vec<ScopeGraphNode>) {
    let child_ids: HashSet<String> = children.iter().map(|n| n.id.clone()).collect();
    let scoped_paths: HashSet<String> = files_in_scope_slice(file_infos, packages, package_path)
        .into_iter()
        .map(|f| f.path.clone())
        .collect();
    let file_by_path: HashMap<&str, &FileInfo> =
        file_infos.iter().map(|f| (f.path.as_str(), f)).collect();

    let mut edges = Vec::new();
    let mut seen = HashSet::new();
    let mut external: HashMap<String, ScopeGraphNode> = HashMap::new();

    for (source_file, targets) in file_imports {
        if !scoped_paths.contains(source_file) {
            continue;
        }
        let Some(source_node) = map_file_to_scope_node(source_file, &child_ids) else {
            continue;
        };

        for target in targets {
            let target_node = if scoped_paths.contains(target) {
                map_file_to_scope_node(target, &child_ids)
            } else if let Some(peer) = external_peer_folder(package_path, target) {
                if peer != package_path {
                    external
                        .entry(peer.clone())
                        .or_insert_with(|| ScopeGraphNode {
                            id: peer.clone(),
                            label: package_label(&peer),
                            path: peer.clone(),
                            loc: 0,
                            kind: "package".into(),
                        });
                    Some(peer)
                } else {
                    None
                }
            } else if let Some(target_file) = file_by_path.get(target.as_str()) {
                let ext_pkg = &target_file.package;
                if ext_pkg != package_path && !child_ids.contains(ext_pkg) {
                    external
                        .entry(ext_pkg.clone())
                        .or_insert_with(|| ScopeGraphNode {
                            id: ext_pkg.clone(),
                            label: package_label(ext_pkg),
                            path: ext_pkg.clone(),
                            loc: 0,
                            kind: "package".into(),
                        });
                    Some(ext_pkg.clone())
                } else {
                    None
                }
            } else {
                None
            };

            let Some(target_node) = target_node else {
                continue;
            };
            if source_node == target_node {
                continue;
            }
            let key = (source_node.clone(), target_node.clone());
            if seen.insert(key) {
                edges.push(PackageEdge {
                    source: source_node.clone(),
                    target: target_node,
                    kind: "import".into(),
                });
            }
        }
    }

    (edges, external.into_values().collect())
}

fn build_scope_graph(
    file_infos: &[FileInfo],
    file_imports: &HashMap<String, Vec<String>>,
    packages: &[String],
    package_path: &str,
) -> ScopeGraph {
    let mut children = scope_package_content_children(file_infos, packages, package_path);
    let (edges, mut external) = scope_package_content_edges(
        file_infos,
        file_imports,
        packages,
        package_path,
        &children,
    );
    children.append(&mut external);
    children.sort_by(|a, b| a.label.cmp(&b.label));
    ScopeGraph {
        nodes: children,
        edges,
    }
}

fn collect_scope_paths(file_infos: &[FileInfo], packages: &[String]) -> HashSet<String> {
    let mut scopes = HashSet::new();
    for pkg in packages {
        scopes.insert(pkg.clone());
        for file in file_infos.iter().filter(|f| f.package == *pkg) {
            let mut current = parent_dir(&file.path);
            while current != *pkg && current != "." {
                scopes.insert(current.clone());
                let next = parent_dir(&current);
                if next == current {
                    break;
                }
                current = next;
            }
        }
    }
    scopes
}

fn build_all_scope_graphs(
    file_infos: &[FileInfo],
    file_imports: &HashMap<String, Vec<String>>,
    packages: &[String],
) -> HashMap<String, ScopeGraph> {
    collect_scope_paths(file_infos, packages)
        .into_iter()
        .map(|path| {
            let graph = build_scope_graph(file_infos, file_imports, packages, &path);
            (path, graph)
        })
        .collect()
}

pub fn build_hierarchy_with_progress(
    root: &Path,
    files: &[(String, u32)],
    contents: &HashMap<String, String>,
    lsp: Option<&crate::lsp::LspPool>,
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(usize, usize),
) -> Result<HierarchyIndex, String> {
    let all_files: HashSet<String> = files.iter().map(|(p, _)| p.clone()).collect();
    let mut file_imports: HashMap<String, Vec<String>> = HashMap::new();
    let mut symbols: HashMap<String, Vec<SymbolInfo>> = HashMap::new();
    let mut symbol_edges = Vec::new();

    let mut package_roots = Vec::new();
    discover_package_roots(root, root, &mut package_roots);
    if package_roots.is_empty() {
        package_roots.push(PackageRoot {
            path: ".".into(),
            crate_names: vec![],
        });
    }

    let packages = package_roots_list(&package_roots);

    let file_infos: Vec<FileInfo> = files
        .iter()
        .map(|(path, loc)| FileInfo {
            path: path.clone(),
            label: file_label(path),
            loc: *loc,
            package: owning_package(path, &package_roots),
        })
        .collect();

    let total = files.len();
    for (i, (path, _)) in files.iter().enumerate() {
        check_cancelled(cancel)?;
        if i == 0 || (i + 1) % 4 == 0 || i + 1 == total {
            on_progress(i + 1, total);
        }

        let content = contents.get(path).cloned().unwrap_or_default();
        let ext = Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("");

        let raw_imports = match ext {
            "rs" => extract_rs_imports(&content),
            "py" => extract_py_imports(&content),
            _ => extract_ts_imports(&content),
        };

        let mut resolved = Vec::new();
        for imp in raw_imports {
            if imp == "self" {
                continue;
            }
            if let Some(target) = resolve_import(path, &imp, &all_files, &package_roots) {
                resolved.push(target);
            }
        }
        resolved.sort();
        resolved.dedup();
        file_imports.insert(path.clone(), resolved);

        let (syms, edges) = if let Some(pool) = lsp {
            if let Some(lsp_syms) = pool.document_symbols(path) {
                let lsp_edges = pool.symbol_edges_for_file(path, &lsp_syms);
                if lsp_edges.is_empty() && !lsp_syms.is_empty() {
                    // Fall back to heuristic edges when references return nothing
                    let (_hs, heuristic_edges) = extract_symbols(path, &content);
                    let ids: HashSet<String> = lsp_syms.iter().map(|s| s.id.clone()).collect();
                    let filtered: Vec<SymbolEdge> = heuristic_edges
                        .into_iter()
                        .filter(|e| ids.contains(&e.source) && ids.contains(&e.target))
                        .collect();
                    (lsp_syms, filtered)
                } else {
                    (lsp_syms, lsp_edges)
                }
            } else {
                extract_symbols(path, &content)
            }
        } else {
            extract_symbols(path, &content)
        };

        if !syms.is_empty() {
            symbols.insert(path.clone(), syms);
        }
        symbol_edges.extend(edges);
    }

    let mut package_edges = collect_manifest_package_edges(root, &package_roots);
    package_edges.extend(collect_import_package_edges(&file_infos, &file_imports));
    package_edges.extend(collect_heuristic_package_edges(
        &file_infos,
        contents,
        &package_roots,
    ));
    package_edges.sort_by(|a, b| a.source.cmp(&b.source).then(a.target.cmp(&b.target)));
    package_edges.dedup_by(|a, b| a.source == b.source && a.target == b.target);

    let scope_graphs = build_all_scope_graphs(&file_infos, &file_imports, &packages);

    Ok(HierarchyIndex {
        version: HIERARCHY_VERSION,
        files: file_infos,
        packages,
        file_imports,
        package_edges,
        symbols,
        symbol_edges,
        scope_graphs,
    })
}

pub fn root_package_graph(hierarchy: &HierarchyIndex) -> Graph {
    let mut locs: HashMap<String, u32> = HashMap::new();
    for file in &hierarchy.files {
        *locs.entry(file.package.clone()).or_insert(0) += file.loc;
    }

    let nodes: Vec<Node> = hierarchy
        .packages
        .iter()
        .map(|pkg| Node {
            id: pkg.clone(),
            label: package_label(pkg),
            path: pkg.clone(),
            loc: locs.get(pkg).copied().unwrap_or(0),
            kind: "package".into(),
            line: 0,
        })
        .collect();

    let mut edges = Vec::new();
    let mut seen = HashSet::new();

    for edge in &hierarchy.package_edges {
        let key = (edge.source.clone(), edge.target.clone());
        if seen.insert(key) {
            edges.push(Edge {
                source: edge.source.clone(),
                target: edge.target.clone(),
                kind: edge.kind.clone(),
            });
        }
    }

    Graph { nodes, edges }
}

pub fn read_file_contents_with_progress(
    root: &Path,
    files: &[(String, u32)],
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(usize, usize),
) -> Result<HashMap<String, String>, String> {
    let mut map = HashMap::new();
    let total = files.len();
    for (i, (rel, _)) in files.iter().enumerate() {
        check_cancelled(cancel)?;
        if i == 0 || (i + 1) % 8 == 0 || i + 1 == total {
            on_progress(i + 1, total);
        }
        let path = root.join(rel);
        if let Ok(content) = std::fs::read_to_string(&path) {
            map.insert(rel.clone(), content);
        }
    }
    Ok(map)
}

/// Build a directed adjacency list from source→target pairs.
pub fn adjacency_from_edges<'a, I>(edges: I) -> HashMap<String, Vec<String>>
where
    I: IntoIterator<Item = (&'a str, &'a str)>,
{
    let mut adj: HashMap<String, Vec<String>> = HashMap::new();
    for (source, target) in edges {
        adj.entry(source.to_string()).or_default().push(target.to_string());
        adj.entry(target.to_string()).or_default();
    }
    for neighbors in adj.values_mut() {
        neighbors.sort();
        neighbors.dedup();
    }
    adj
}

/// Count cyclic SCCs and collect up to `sample_limit` without materializing every component.
pub fn cyclic_components_sampled(
    adj: &HashMap<String, Vec<String>>,
    sample_limit: usize,
) -> (usize, Vec<Vec<String>>) {
    let mut index = 0usize;
    let mut stack: Vec<String> = Vec::new();
    let mut on_stack: HashSet<String> = HashSet::new();
    let mut indices: HashMap<String, usize> = HashMap::new();
    let mut lowlink: HashMap<String, usize> = HashMap::new();
    let mut total_cyclic = 0usize;
    let mut samples: Vec<Vec<String>> = Vec::new();

    fn strongconnect(
        v: &str,
        adj: &HashMap<String, Vec<String>>,
        index: &mut usize,
        stack: &mut Vec<String>,
        on_stack: &mut HashSet<String>,
        indices: &mut HashMap<String, usize>,
        lowlink: &mut HashMap<String, usize>,
        total_cyclic: &mut usize,
        samples: &mut Vec<Vec<String>>,
        sample_limit: usize,
    ) {
        indices.insert(v.to_string(), *index);
        lowlink.insert(v.to_string(), *index);
        *index += 1;
        stack.push(v.to_string());
        on_stack.insert(v.to_string());

        for w in adj.get(v).into_iter().flatten() {
            if !indices.contains_key(w) {
                strongconnect(
                    w, adj, index, stack, on_stack, indices, lowlink, total_cyclic, samples,
                    sample_limit,
                );
                let v_low = *lowlink.get(v).unwrap();
                let w_low = *lowlink.get(w).unwrap();
                lowlink.insert(v.to_string(), v_low.min(w_low));
            } else if on_stack.contains(w) {
                let v_low = *lowlink.get(v).unwrap();
                let w_idx = *indices.get(w).unwrap();
                lowlink.insert(v.to_string(), v_low.min(w_idx));
            }
        }

        if lowlink.get(v) == indices.get(v) {
            let mut component = Vec::new();
            loop {
                let w = stack.pop().expect("tarjan stack");
                on_stack.remove(&w);
                let done = w == v;
                component.push(w);
                if done {
                    break;
                }
            }

            let is_cyclic = if component.len() > 1 {
                true
            } else if let Some(node) = component.first() {
                adj.get(node)
                    .map(|neighbors| neighbors.iter().any(|n| n == node))
                    .unwrap_or(false)
            } else {
                false
            };

            if is_cyclic {
                *total_cyclic += 1;
                if samples.len() < sample_limit {
                    component.sort();
                    samples.push(component);
                }
            }
        }
    }

    for node in adj.keys() {
        if !indices.contains_key(node) {
            strongconnect(
                node,
                adj,
                &mut index,
                &mut stack,
                &mut on_stack,
                &mut indices,
                &mut lowlink,
                &mut total_cyclic,
                &mut samples,
                sample_limit,
            );
        }
    }

    (total_cyclic, samples)
}

pub fn extract_cycle_path(component: &[String], adj: &HashMap<String, Vec<String>>) -> Vec<String> {
    if component.is_empty() {
        return Vec::new();
    }
    const MAX_PATH: usize = 16;
    if component.len() > MAX_PATH {
        return component.iter().take(MAX_PATH).cloned().collect();
    }
    if component.len() == 1 {
        let node = component[0].clone();
        return vec![node.clone(), node];
    }

    let members: HashSet<String> = component.iter().cloned().collect();
    let start = component.first().cloned().unwrap_or_default();
    let mut path = vec![start.clone()];
    let mut visited: HashSet<String> = HashSet::from([start.clone()]);
    let mut current = start;

    for _ in 0..component.len() {
        let Some(next) = adj.get(&current).and_then(|neighbors| {
            neighbors
                .iter()
                .find(|n| members.contains(*n) && !visited.contains(*n))
                .cloned()
        }) else {
            break;
        };
        path.push(next.clone());
        visited.insert(next.clone());
        current = next;
    }

    if path.len() > 1 {
        let first = path.first().cloned().unwrap_or_default();
        if adj
            .get(&current)
            .map(|neighbors| neighbors.iter().any(|n| *n == first))
            .unwrap_or(false)
        {
            path.push(first);
        }
    }

    if path.len() < 2 {
        return component.to_vec();
    }

    path
}

pub fn format_dependency_cycle(component: &[String], adj: &HashMap<String, Vec<String>>, label: &str) -> String {
    if component.is_empty() {
        return String::new();
    }
    if component.len() == 1 {
        let node = &component[0];
        return format!("[{label}] {node} → {node}");
    }

    const LARGE_SCC: usize = 12;
    if component.len() > LARGE_SCC {
        let preview: Vec<&str> = component.iter().take(5).map(String::as_str).collect();
        return format!(
            "[{label}] strongly connected group ({} files): {} …",
            component.len(),
            preview.join(", ")
        );
    }

    let path = extract_cycle_path(component, adj);
    if path.len() < 2 {
        return format!(
            "[{label}] strongly connected group ({} files): {}",
            component.len(),
            component.join(", ")
        );
    }

    format!("[{label}] {}", path.join(" → "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_file_import_cycle() {
        let mut imports: HashMap<String, Vec<String>> = HashMap::new();
        imports.insert("src/a.ts".into(), vec!["src/b.ts".into()]);
        imports.insert("src/b.ts".into(), vec!["src/c.ts".into()]);
        imports.insert("src/c.ts".into(), vec!["src/a.ts".into()]);
        let adj = adjacency_from_edges(
            imports
                .iter()
                .flat_map(|(s, ts)| ts.iter().map(move |t| (s.as_str(), t.as_str()))),
        );
        let (count, cycles) = cyclic_components_sampled(&adj, usize::MAX);
        assert_eq!(count, 1);
        assert_eq!(cycles.len(), 1);
        assert_eq!(cycles[0].len(), 3);
    }

    #[test]
    fn ts_import_extraction_main() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let content = std::fs::read_to_string(root.join("src/main.ts")).unwrap();
        let from_count = content.match_indices(" from ").count();
        eprintln!("' from ' occurrences: {from_count}");
        let imports = extract_ts_imports(&content);
        eprintln!("main.ts raw imports ({}) {:?}", imports.len(), imports);
        assert!(imports.len() >= 20, "got {}", imports.len());
    }

    #[test]
    #[ignore = "used by scripts/verify-navigation.ts"]
    fn dump_hierarchy_json() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let result = crate::analysis::run_analysis(root.to_str().unwrap(), &[]).expect("analysis");
        println!(
            "HIERARCHY_JSON:{}",
            serde_json::to_string(&result.hierarchy).expect("json")
        );
    }

    #[test]
    fn src_scope_graph_has_subpackages_and_edges() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let result = crate::analysis::run_analysis(root.to_str().unwrap(), &[]).expect("analysis");
        let hierarchy = &result.hierarchy;

        let src_graph = hierarchy
            .scope_graphs
            .get("src")
            .expect("src scope graph should exist");
        eprintln!(
            "src scope: {} nodes, {} edges",
            src_graph.nodes.len(),
            src_graph.edges.len()
        );

        assert!(
            src_graph
                .nodes
                .iter()
                .any(|n| n.kind == "package" && n.id == "src/canvas"),
            "expected src/canvas sub-package node"
        );
        assert!(
            src_graph
                .nodes
                .iter()
                .any(|n| n.kind == "file" && n.id == "src/main.ts"),
            "expected src/main.ts file node"
        );
        assert!(
            src_graph.edges.len() >= 5,
            "expected multiple dependency edges at src scope, got {}",
            src_graph.edges.len()
        );
        assert!(
            src_graph.edges.iter().any(|e| {
                e.source == "src/main.ts" && e.target == "src/canvas"
            }),
            "expected main.ts -> src/canvas edge"
        );
        assert!(
            src_graph
                .edges
                .iter()
                .any(|e| e.source == "src/ui" && e.target == "src/graph"),
            "expected ui -> graph cross-subfolder edge"
        );
    }

    #[test]
    fn resolve_relative_ts_imports() {
        let files: HashSet<String> = [
            "src/main.ts",
            "src/wasm-bridge.ts",
            "src/canvas/renderer.ts",
            "src/graph/navigation.ts",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let roots = vec![PackageRoot {
            path: ".".into(),
            crate_names: vec![],
        }];
        assert_eq!(
            resolve_import("src/main.ts", "./wasm-bridge", &files, &roots),
            Some("src/wasm-bridge.ts".into())
        );
        assert_eq!(
            resolve_import("src/main.ts", "./canvas/renderer", &files, &roots),
            Some("src/canvas/renderer.ts".into())
        );
    }
}
