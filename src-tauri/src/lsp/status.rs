use std::env;
use std::path::PathBuf;
use std::process::Command;

use serde::{Deserialize, Serialize};

use super::discover::{probe_language_server, LanguageKind};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspServerStatus {
    pub id: String,
    pub language: String,
    pub label: String,
    /// "installed" | "missing"
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    pub install_hint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspInstallResult {
    pub ok: bool,
    pub message: String,
    pub server: LspServerStatus,
}

struct ServerDef {
    kind: LanguageKind,
    label: &'static str,
    install_hint: &'static str,
}

const SERVERS: &[ServerDef] = &[
    ServerDef {
        kind: LanguageKind::TypeScript,
        label: "TypeScript / JavaScript",
        install_hint: "npm install -g typescript typescript-language-server",
    },
    ServerDef {
        kind: LanguageKind::Rust,
        label: "Rust",
        install_hint: "rustup component add rust-analyzer",
    },
    ServerDef {
        kind: LanguageKind::Python,
        label: "Python",
        install_hint: "npm install -g basedpyright",
    },
    ServerDef {
        kind: LanguageKind::Go,
        label: "Go",
        install_hint: "go install golang.org/x/tools/gopls@latest",
    },
];

/// Prepend common toolchain dirs so GUI-launched apps still find LSPs / package managers.
pub fn enrich_path() {
    let current = env::var("PATH").unwrap_or_default();
    let mut parts: Vec<String> = Vec::new();

    if let Some(home) = env::var_os("HOME").map(PathBuf::from) {
        parts.push(home.join(".cargo/bin").to_string_lossy().into());
        parts.push(home.join("go/bin").to_string_lossy().into());
        parts.push(home.join(".local/bin").to_string_lossy().into());

        // Prefer active nvm node bin if present
        let nvm_versions = home.join(".nvm/versions/node");
        if nvm_versions.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&nvm_versions) {
                let mut versions: Vec<PathBuf> = entries
                    .filter_map(|e| e.ok())
                    .map(|e| e.path())
                    .filter(|p| p.is_dir())
                    .collect();
                versions.sort();
                if let Some(latest) = versions.last() {
                    parts.push(latest.join("bin").to_string_lossy().into());
                }
            }
        }
    }

    for p in [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
    ] {
        parts.push(p.to_string());
    }

    for segment in current.split(':') {
        if !segment.is_empty() && !parts.iter().any(|p| p == segment) {
            parts.push(segment.to_string());
        }
    }

    let joined = parts.join(":");
    // SAFETY: single-threaded at command entry; PATH update is intentional for LSP tooling.
    unsafe { env::set_var("PATH", &joined) };
}

pub fn list_lsp_servers() -> Vec<LspServerStatus> {
    enrich_path();
    SERVERS.iter().map(probe_def).collect()
}

fn probe_def(def: &ServerDef) -> LspServerStatus {
    let id = def.kind.label().to_string();
    match probe_language_server(def.kind) {
        Some((command, _)) => LspServerStatus {
            id,
            language: def.kind.label().into(),
            label: def.label.into(),
            status: "installed".into(),
            command: Some(resolve_which(&command).unwrap_or(command)),
            install_hint: def.install_hint.into(),
        },
        None => LspServerStatus {
            id,
            language: def.kind.label().into(),
            label: def.label.into(),
            status: "missing".into(),
            command: None,
            install_hint: def.install_hint.into(),
        },
    }
}

fn resolve_which(name: &str) -> Option<String> {
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

pub fn install_lsp_server(id: &str) -> Result<LspInstallResult, String> {
    enrich_path();
    let def = SERVERS
        .iter()
        .find(|s| s.kind.label() == id)
        .ok_or_else(|| format!("Unknown language server id: {id}"))?;

    let (program, args, retry_force_npm) = match def.kind {
        LanguageKind::Rust => (
            "rustup",
            vec!["component".into(), "add".into(), "rust-analyzer".into()],
            false,
        ),
        LanguageKind::TypeScript => (
            "npm",
            vec![
                "install".into(),
                "-g".into(),
                "typescript".into(),
                "typescript-language-server".into(),
            ],
            true,
        ),
        LanguageKind::Python => (
            "npm",
            vec!["install".into(), "-g".into(), "basedpyright".into()],
            false,
        ),
        LanguageKind::Go => {
            if !command_on_path("go") {
                return Err(
                    "Go toolchain not found. Install Go first (e.g. `brew install go`), then retry."
                        .into(),
                );
            }
            (
                "go",
                vec!["install".into(), "golang.org/x/tools/gopls@latest".into()],
                false,
            )
        }
    };

    if !command_on_path(program) {
        return Err(format!(
            "`{program}` not found on PATH. Install it first, then retry.\nHint: {}",
            def.install_hint
        ));
    }

    let mut result = run_install(program, &args);
    if !result.0 && retry_force_npm && result.1.contains("EEXIST") {
        let mut forced = args.clone();
        // npm install -g --force ...
        forced.insert(1, "--force".into());
        result = run_install(program, &forced);
    }

    let (ok, output) = result;
    let server = probe_def(def);
    let message = if ok {
        if server.status == "installed" {
            format!("Installed successfully.\n{output}")
        } else {
            format!(
                "Install finished but server still not on PATH. You may need to restart DevTree.\n{output}"
            )
        }
    } else {
        format!("Install failed.\n{output}")
    };

    Ok(LspInstallResult {
        ok: ok && server.status == "installed",
        message: message.trim().to_string(),
        server,
    })
}

fn command_on_path(name: &str) -> bool {
    resolve_which(name).is_some()
}

fn run_install(program: &str, args: &[String]) -> (bool, String) {
    let output = match Command::new(program).args(args).output() {
        Ok(o) => o,
        Err(e) => return (false, format!("Failed to spawn `{program}`: {e}")),
    };
    let mut text = String::new();
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stdout.trim().is_empty() {
        text.push_str(stdout.trim());
    }
    if !stderr.trim().is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(stderr.trim());
    }
    if text.is_empty() {
        text = if output.status.success() {
            "Done.".into()
        } else {
            format!("Exit code: {:?}", output.status.code())
        };
    }
    (output.status.success(), text)
}