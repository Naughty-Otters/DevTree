use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LanguageKind {
    TypeScript,
    Rust,
    Python,
    Go,
}

impl LanguageKind {
    pub fn id(self) -> &'static str {
        match self {
            Self::TypeScript => "typescript",
            Self::Rust => "rust",
            Self::Python => "python",
            Self::Go => "go",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::TypeScript => "TypeScript / JavaScript",
            Self::Rust => "Rust",
            Self::Python => "Python",
            Self::Go => "Go",
        }
    }
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

pub fn languages_in_files(files: &[(String, u32)]) -> Vec<LanguageKind> {
    let mut langs = std::collections::HashSet::new();
    for (path, _) in files {
        if let Some(lang) = file_language(path) {
            langs.insert(lang);
        }
    }
    let mut out: Vec<_> = langs.into_iter().collect();
    out.sort_by_key(|l| l.id());
    out
}

pub struct LinterDef {
    pub id: &'static str,
    pub label: &'static str,
    pub install_hint: &'static str,
    pub is_default: bool,
}

pub fn linters_for(lang: LanguageKind) -> &'static [LinterDef] {
    match lang {
        LanguageKind::TypeScript => &[
            LinterDef {
                id: "eslint",
                label: "ESLint",
                install_hint: "npm install -g eslint",
                is_default: true,
            },
            LinterDef {
                id: "biome",
                label: "Biome",
                install_hint: "npm install -g @biomejs/biome",
                is_default: false,
            },
            LinterDef {
                id: "oxlint",
                label: "Oxlint",
                install_hint: "npm install -g oxlint",
                is_default: false,
            },
        ],
        LanguageKind::Rust => &[LinterDef {
            id: "clippy",
            label: "Clippy (cargo clippy)",
            install_hint: "rustup component add clippy",
            is_default: true,
        }],
        LanguageKind::Python => &[
            LinterDef {
                id: "ruff",
                label: "Ruff",
                install_hint: "pip3 install ruff  (or: brew install ruff)",
                is_default: true,
            },
            LinterDef {
                id: "pylint",
                label: "Pylint",
                install_hint: "pip3 install pylint",
                is_default: false,
            },
            LinterDef {
                id: "flake8",
                label: "Flake8",
                install_hint: "pip3 install flake8",
                is_default: false,
            },
        ],
        LanguageKind::Go => &[
            LinterDef {
                id: "golangci-lint",
                label: "golangci-lint",
                install_hint: "go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest",
                is_default: true,
            },
            LinterDef {
                id: "staticcheck",
                label: "staticcheck",
                install_hint: "go install honnef.co/go/tools/cmd/staticcheck@latest",
                is_default: false,
            },
        ],
    }
}

pub fn default_linter_id(lang: LanguageKind) -> &'static str {
    linters_for(lang)
        .iter()
        .find(|l| l.is_default)
        .map(|l| l.id)
        .unwrap_or(linters_for(lang)[0].id)
}

pub fn probe_linter(linter_id: &str) -> Option<String> {
    match linter_id {
        "eslint" => resolve_which("eslint"),
        "biome" => resolve_which("biome"),
        "oxlint" => resolve_which("oxlint"),
        "clippy" => {
            if clippy_component_installed() {
                Some("cargo clippy".into())
            } else {
                None
            }
        }
        "ruff" => resolve_which("ruff"),
        "pylint" => resolve_which("pylint"),
        "flake8" => resolve_which("flake8"),
        "golangci-lint" => resolve_which("golangci-lint"),
        "staticcheck" => resolve_which("staticcheck"),
        _ => None,
    }
}

fn clippy_component_installed() -> bool {
    if resolve_which("cargo").is_none() {
        return false;
    }
    let output = Command::new("rustup")
        .args(["component", "list", "--installed"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output();
    if let Ok(out) = output {
        if out.status.success() {
            let text = String::from_utf8_lossy(&out.stdout);
            if text.lines().any(|line| line.contains("clippy")) {
                return true;
            }
        }
    }
    false
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_rust_files() {
        assert_eq!(file_language("src/main.rs"), Some(LanguageKind::Rust));
        assert!(linters_for(LanguageKind::Rust).len() > 0);
    }
}
