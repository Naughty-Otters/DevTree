use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::{json, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LanguageKind {
    TypeScript,
    Rust,
    Python,
    Go,
}

impl LanguageKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::TypeScript => "typescript",
            Self::Rust => "rust",
            Self::Python => "python",
            Self::Go => "go",
        }
    }

    pub fn language_id(self) -> &'static str {
        match self {
            Self::TypeScript => "typescript",
            Self::Rust => "rust",
            Self::Python => "python",
            Self::Go => "go",
        }
    }

    pub fn init_options(self) -> Value {
        match self {
            Self::TypeScript => json!({}),
            Self::Rust => json!({}),
            Self::Python => json!({}),
            Self::Go => json!({}),
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
        _ => None,
    }
}

pub fn discover_servers(project_root: &Path, files: &[(String, u32)]) -> Vec<ServerSpec> {
    let mut langs = HashSet::new();
    for (path, _) in files {
        if let Some(lang) = file_language(path) {
            langs.insert(lang);
        }
    }

    let mut specs = Vec::new();
    for lang in langs {
        if let Some(spec) = resolve_server(project_root, lang, files) {
            specs.push(spec);
        } else {
            eprintln!(
                "[devtree lsp] no language server found for {} — using heuristics",
                lang.label()
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
    match lang {
        LanguageKind::TypeScript => find_typescript_server(),
        LanguageKind::Rust => Some((find_on_path(&["rust-analyzer"])?, vec![])),
        LanguageKind::Python => find_python_server(),
        LanguageKind::Go => Some((find_on_path(&["gopls"])?, vec![])),
    }
}

fn language_root(project_root: &Path, lang: LanguageKind, files: &[(String, u32)]) -> PathBuf {
    let markers: &[&str] = match lang {
        LanguageKind::TypeScript => &["tsconfig.json", "jsconfig.json", "package.json"],
        LanguageKind::Rust => &["Cargo.toml"],
        LanguageKind::Python => &["pyproject.toml", "setup.cfg", "setup.py"],
        LanguageKind::Go => &["go.mod"],
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

fn find_typescript_server() -> Option<(String, Vec<String>)> {
    if let Some(bin) = find_on_path(&["typescript-language-server"]) {
        return Some((bin, vec!["--stdio".into()]));
    }
    if let Some(bin) = find_on_path(&["vtsls"]) {
        return Some((bin, vec!["--stdio".into()]));
    }
    None
}

fn find_python_server() -> Option<(String, Vec<String>)> {
    for name in ["basedpyright-langserver", "basedpyright", "pyright-langserver", "pyright"] {
        if let Some(bin) = find_on_path(&[name]) {
            let args = if name.contains("langserver") || name == "basedpyright" || name == "pyright"
            {
                // basedpyright/pyright CLIs: langserver uses --stdio
                vec!["--stdio".into()]
            } else {
                vec!["--stdio".into()]
            };
            return Some((bin, args));
        }
    }
    if let Some(bin) = find_on_path(&["pylsp"]) {
        return Some((bin, vec![]));
    }
    None
}

fn find_on_path(names: &[&str]) -> Option<String> {
    for name in names {
        if command_exists(name) {
            return Some((*name).to_string());
        }
    }
    None
}

fn command_exists(name: &str) -> bool {
    #[cfg(windows)]
    let mut cmd = Command::new("where");
    #[cfg(not(windows))]
    let mut cmd = Command::new("which");
    cmd.arg(name)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}
