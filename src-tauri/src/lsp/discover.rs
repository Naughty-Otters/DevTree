use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::{json, Value};

use super::status::enrich_path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LanguageKind {
    TypeScript,
    Rust,
    Python,
    Go,
    Java,
}

impl LanguageKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::TypeScript => "typescript",
            Self::Rust => "rust",
            Self::Python => "python",
            Self::Go => "go",
            Self::Java => "java",
        }
    }

    pub fn language_id(self) -> &'static str {
        match self {
            Self::TypeScript => "typescript",
            Self::Rust => "rust",
            Self::Python => "python",
            Self::Go => "go",
            Self::Java => "java",
        }
    }

    pub fn init_options_with_settings(
        self,
        cfg: Option<&serde_json::Map<String, serde_json::Value>>,
    ) -> Value {
        use super::status::cfg_bool;
        match self {
            Self::TypeScript => json!({}),
            Self::Rust => json!({
                "cargo": {
                    "allTargets": cfg_bool(cfg, "cargo_all_targets", false)
                },
                // Keep analysis lighter / more stable for short-lived DevTree LSP sessions.
                "checkOnSave": false,
                "diagnostics": {
                    "enable": true
                },
                "cachePriming": {
                    "enable": false
                }
            }),
            Self::Python => {
                if cfg_bool(cfg, "type_checking", true) {
                    json!({
                        "python": {
                            "analysis": {
                                "typeCheckingMode": "basic"
                            }
                        }
                    })
                } else {
                    json!({
                        "python": {
                            "analysis": {
                                "typeCheckingMode": "off"
                            }
                        }
                    })
                }
            }
            Self::Go => json!({
                "ui": {
                    "diagnostic": {
                        "staticcheck": cfg_bool(cfg, "staticcheck", true)
                    }
                }
            }),
            Self::Java => json!({}),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ServerSpec {
    pub language: LanguageKind,
    pub command: String,
    pub args: Vec<String>,
    pub root: PathBuf,
}

pub fn file_language(rel_path: &str) -> Option<LanguageKind> {
    let ext = Path::new(rel_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    match ext {
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" => Some(LanguageKind::TypeScript),
        "rs" => Some(LanguageKind::Rust),
        "py" => Some(LanguageKind::Python),
        "go" => Some(LanguageKind::Go),
        "java" => Some(LanguageKind::Java),
        _ => None,
    }
}

pub fn discover_servers(project_root: &Path, files: &[(String, u32)]) -> Vec<ServerSpec> {
    enrich_path();
    let mut langs = HashSet::new();
    for (path, _) in files {
        if let Some(lang) = file_language(path) {
            langs.insert(lang);
        }
    }

    let mut specs = Vec::new();
    for lang in langs {
        if let Some(spec) = resolve_server(project_root, lang, files) {
            eprintln!(
                "[devtree lsp] resolved {} → {} {:?}",
                lang.label(),
                spec.command,
                spec.args
            );
            specs.push(spec);
        } else {
            eprintln!(
                "[devtree lsp] no language server found for {} — using heuristics ({})",
                lang.label(),
                probe_failure_hint(lang)
            );
        }
    }
    specs
}

fn resolve_server(
    project_root: &Path,
    lang: LanguageKind,
    files: &[(String, u32)],
) -> Option<ServerSpec> {
    let root = language_root(project_root, lang, files);
    let (command, args) = probe_language_server(lang)?;
    Some(ServerSpec {
        language: lang,
        command,
        args,
        root,
    })
}

/// Resolve the preferred language-server binary for a language (no project root).
pub fn probe_language_server(lang: LanguageKind) -> Option<(String, Vec<String>)> {
    enrich_path();
    match lang {
        LanguageKind::TypeScript => find_typescript_server(),
        LanguageKind::Rust => find_rust_analyzer(),
        LanguageKind::Python => find_python_server(),
        LanguageKind::Go => find_native_server(&["gopls"], &[]),
        LanguageKind::Java => find_java_server(),
    }
}

fn probe_failure_hint(lang: LanguageKind) -> &'static str {
    match lang {
        LanguageKind::TypeScript => {
            "install Node + typescript-language-server, or ensure /opt/homebrew/bin is on PATH"
        }
        LanguageKind::Rust => "run `rustup component add rust-analyzer`",
        LanguageKind::Python => "install basedpyright or pyright (npm -g basedpyright)",
        LanguageKind::Go => "install gopls (go install golang.org/x/tools/gopls@latest)",
        LanguageKind::Java => "install jdtls (brew install jdtls) — requires Java 17+",
    }
}

const MIN_NODE_MAJOR: u32 = 18;

fn parse_semver_prefix(s: &str) -> Option<(u32, u32, u32)> {
    let s = s.trim().trim_start_matches('v');
    let mut parts = s.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().ok()?;
    let patch = parts.next().unwrap_or("0").parse().ok()?;
    Some((major, minor, patch))
}

fn node_version_from_path(path: &Path) -> Option<(u32, u32, u32)> {
    for component in path.components() {
        let s = component.as_os_str().to_str()?;
        if s.starts_with('v') && s.contains('.') {
            if let Some(ver) = parse_semver_prefix(s) {
                return Some(ver);
            }
        }
    }
    None
}

fn node_semver_at(path: &Path) -> Option<(u32, u32, u32)> {
    if let Some(ver) = node_version_from_path(path) {
        return Some(ver);
    }
    let output = Command::new(path)
        .arg("--version")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let token = text.split_whitespace().last()?;
    parse_semver_prefix(token)
}

fn collect_node_candidate_paths() -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    let mut seen = HashSet::new();

    let mut push = |path: PathBuf| {
        if path.is_file() {
            let key = path.to_string_lossy().into_owned();
            if seen.insert(key) {
                candidates.push(path);
            }
        }
    };

    for abs in ["/opt/homebrew/bin/node", "/usr/local/bin/node"] {
        push(PathBuf::from(abs));
    }

    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        for rel in [
            ".volta/bin/node",
            ".fnm/current/bin/node",
            ".local/share/fnm/current/bin/node",
        ] {
            push(home.join(rel));
        }

        let nvm_versions = home.join(".nvm/versions/node");
        if nvm_versions.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&nvm_versions) {
                let mut versions: Vec<PathBuf> = entries
                    .filter_map(|e| e.ok().map(|e| e.path()))
                    .filter(|p| p.is_dir())
                    .collect();
                versions.sort_by(|a, b| {
                    let va = a
                        .file_name()
                        .and_then(|n| n.to_str())
                        .and_then(parse_semver_prefix);
                    let vb = b
                        .file_name()
                        .and_then(|n| n.to_str())
                        .and_then(parse_semver_prefix);
                    va.cmp(&vb)
                });
                for ver_dir in versions {
                    push(ver_dir.join("bin/node"));
                }
            }
        }
    }

    if let Some(path) = resolve_which("node") {
        push(PathBuf::from(path));
    }

    candidates
}

fn find_node_binary() -> Option<String> {
    let mut best: Option<(PathBuf, (u32, u32, u32))> = None;
    for path in collect_node_candidate_paths() {
        let Some(ver) = node_semver_at(&path) else {
            continue;
        };
        if ver.0 < MIN_NODE_MAJOR {
            continue;
        }
        let replace = best
            .as_ref()
            .map(|(_, current)| ver > *current)
            .unwrap_or(true);
        if replace {
            best = Some((path, ver));
        }
    }
    best.map(|(path, _)| path.to_string_lossy().into_owned())
}

/// Newest NVM Node install by semver (not lexicographic — v24 > v8).
pub fn newest_nvm_node_bin(home: &Path) -> Option<String> {
    let nvm_versions = home.join(".nvm/versions/node");
    if !nvm_versions.is_dir() {
        return None;
    }
    let mut versions: Vec<PathBuf> = std::fs::read_dir(&nvm_versions)
        .ok()?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.is_dir())
        .collect();
    versions.sort_by(|a, b| {
        let va = a
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(parse_semver_prefix);
        let vb = b
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(parse_semver_prefix);
        va.cmp(&vb)
    });
    let node = versions.last()?.join("bin/node");
    if node.is_file() {
        Some(node.to_string_lossy().into_owned())
    } else {
        None
    }
}

fn find_native_server(names: &[&str], args: &[&str]) -> Option<(String, Vec<String>)> {
    let path = resolve_which_any(names)?;
    if !Path::new(&path).is_file() {
        return None;
    }
    let args: Vec<String> = args.iter().map(|s| (*s).to_string()).collect();
    Some((path, args))
}

fn find_typescript_server() -> Option<(String, Vec<String>)> {
    for name in ["typescript-language-server", "vtsls"] {
        if let Some(inv) = resolve_node_cli(name, &["--stdio"]) {
            return Some(inv);
        }
    }
    None
}

fn find_rust_analyzer() -> Option<(String, Vec<String>)> {
    if let Some(path) = rustup_which_rust_analyzer() {
        if Path::new(&path).is_file() {
            return Some((path, vec![]));
        }
    }

    if let Some(home) = std::env::var_os("HOME") {
        let toolchains = PathBuf::from(home).join(".rustup/toolchains");
        if let Ok(entries) = std::fs::read_dir(toolchains) {
            let mut paths: Vec<PathBuf> = entries
                .filter_map(|e| e.ok().map(|e| e.path()))
                .filter(|p| p.is_dir())
                .collect();
            paths.sort();
            for tc in paths.into_iter().rev() {
                let ra = tc.join("bin/rust-analyzer");
                if ra.is_file() {
                    return Some((ra.to_string_lossy().into_owned(), vec![]));
                }
            }
        }
    }

    None
}

fn rustup_which_rust_analyzer() -> Option<String> {
    let output = Command::new("rustup")
        .args(["which", "rust-analyzer"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()?
        .trim()
        .to_string();
    if path.is_empty() || !Path::new(&path).is_file() {
        None
    } else {
        Some(path)
    }
}

/// Run npm/node CLIs through an explicit Node binary so GUI apps don't inherit a stale `env node`.
fn resolve_node_cli(name: &str, extra_args: &[&str]) -> Option<(String, Vec<String>)> {
    let wrapper = resolve_which(name)?;
    let node = find_node_binary()?;
    let script = std::fs::canonicalize(&wrapper)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or(wrapper);
    if !Path::new(&script).is_file() {
        return None;
    }
    let mut args = vec![script];
    args.extend(extra_args.iter().map(|s| (*s).to_string()));
    Some((node, args))
}

fn find_python_server() -> Option<(String, Vec<String>)> {
    for name in [
        "basedpyright-langserver",
        "basedpyright",
        "pyright-langserver",
        "pyright",
    ] {
        if let Some(inv) = resolve_node_cli(name, &["--stdio"]) {
            return Some(inv);
        }
        if let Some(inv) = find_native_server(&[name], &["--stdio"]) {
            return Some(inv);
        }
    }
    find_native_server(&["pylsp"], &[])
}

/// Eclipse JDT Language Server (`jdtls` wrapper from Homebrew / Mason / manual install).
fn find_java_server() -> Option<(String, Vec<String>)> {
    if let Some(inv) = find_native_server(&["jdtls"], &[]) {
        return Some(inv);
    }

    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        for rel in [
            ".local/share/nvim/mason/bin/jdtls",
            ".local/bin/jdtls",
            "bin/jdtls",
        ] {
            let path = home.join(rel);
            if path.is_file() {
                return Some((path.to_string_lossy().into_owned(), vec![]));
            }
        }
    }

    for abs in [
        "/opt/homebrew/bin/jdtls",
        "/usr/local/bin/jdtls",
        "/opt/homebrew/opt/jdtls/bin/jdtls",
        "/usr/local/opt/jdtls/bin/jdtls",
    ] {
        let path = PathBuf::from(abs);
        if path.is_file() {
            return Some((path.to_string_lossy().into_owned(), vec![]));
        }
    }

    None
}

fn resolve_which_any(names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| resolve_which(name))
}

pub fn resolve_which(name: &str) -> Option<String> {
    #[cfg(windows)]
    let output = Command::new("where").arg(name).output().ok()?;
    #[cfg(not(windows))]
    let output = Command::new("which").arg(name).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let first = text.lines().next()?.trim();
    if first.is_empty() {
        None
    } else {
        Some(first.to_string())
    }
}

fn language_root(project_root: &Path, lang: LanguageKind, files: &[(String, u32)]) -> PathBuf {
    let markers: &[&str] = match lang {
        LanguageKind::TypeScript => &["tsconfig.json", "jsconfig.json", "package.json"],
        LanguageKind::Rust => &["Cargo.toml"],
        LanguageKind::Python => &["pyproject.toml", "setup.cfg", "setup.py"],
        LanguageKind::Go => &["go.mod"],
        LanguageKind::Java => &[
            "pom.xml",
            "build.gradle",
            "build.gradle.kts",
            "settings.gradle",
            "settings.gradle.kts",
        ],
    };

    // Prefer nearest marker above the first file of this language
    for (rel, _) in files {
        if file_language(rel) != Some(lang) {
            continue;
        }
        let mut dir = project_root.join(rel);
        dir.pop();
        let mut cur = dir;
        loop {
            for marker in markers {
                if cur.join(marker).is_file() {
                    return cur;
                }
            }
            if cur == *project_root || !cur.pop() {
                break;
            }
        }
        break;
    }

    // Walk from project root for a marker
    for marker in markers {
        if project_root.join(marker).is_file() {
            return project_root.to_path_buf();
        }
    }
    // Cargo workspace member
    if lang == LanguageKind::Rust {
        if project_root.join("src-tauri/Cargo.toml").is_file() {
            return project_root.join("src-tauri");
        }
    }
    project_root.to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lsp::status::enrich_path;

    #[test]
    fn typescript_server_runs_via_node() {
        enrich_path();
        let Some((cmd, args)) = probe_language_server(LanguageKind::TypeScript) else {
            return;
        };
        assert!(
            cmd.contains("node"),
            "expected node launcher, got {cmd}"
        );
        assert!(!args.is_empty(), "expected script path argument");
        assert!(
            args.iter().any(|a| a == "--stdio"),
            "expected --stdio in args"
        );
    }

    #[test]
    fn rust_analyzer_skips_missing_rustup_component() {
        enrich_path();
        let result = probe_language_server(LanguageKind::Rust);
        if let Some((cmd, _)) = result {
            assert!(
                !cmd.ends_with("rustup"),
                "rust-analyzer should resolve to a real binary, not rustup shim"
            );
        }
    }

    #[test]
    fn nvm_semver_sort_prefers_v24_over_v8() {
        let a = parse_semver_prefix("v8.16.0").unwrap();
        let b = parse_semver_prefix("v24.8.0").unwrap();
        assert!(b > a);
    }

    #[test]
    fn find_node_binary_meets_minimum_major() {
        enrich_path();
        let Some(node) = find_node_binary() else {
            return;
        };
        let ver = node_semver_at(Path::new(&node)).expect("node version");
        assert!(
            ver.0 >= MIN_NODE_MAJOR,
            "expected Node >={MIN_NODE_MAJOR}, got v{} at {node}",
            ver.0
        );
    }

    #[test]
    fn java_extension_maps_to_java_kind() {
        assert_eq!(file_language("src/Main.java"), Some(LanguageKind::Java));
        assert_eq!(
            file_language("com/example/App.java"),
            Some(LanguageKind::Java)
        );
        assert_eq!(file_language("Main.kt"), None);
    }
}
