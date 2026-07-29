use std::env;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;

use serde::{Deserialize, Serialize};

use super::discover::{resolve_which, LanguageKind};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspSettingDef {
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
pub struct LspServerStatus {
    pub id: String,
    pub language: String,
    pub label: String,
    /// "installed" | "missing"
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    pub install_hint: String,
    #[serde(default)]
    pub settings: Vec<LspSettingDef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspInstallResult {
    pub ok: bool,
    pub message: String,
    pub server: LspServerStatus,
}

pub type LspSettingsMap =
    std::collections::HashMap<String, serde_json::Map<String, serde_json::Value>>;

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

fn num_setting(key: &str, label: &str, default: u32, min: u32, max: u32) -> LspSettingDef {
    LspSettingDef {
        key: key.into(),
        label: label.into(),
        kind: "number".into(),
        default: serde_json::json!(default),
        min: Some(min as f64),
        max: Some(max as f64),
    }
}

fn bool_setting(key: &str, label: &str, default: bool) -> LspSettingDef {
    LspSettingDef {
        key: key.into(),
        label: label.into(),
        kind: "boolean".into(),
        default: serde_json::json!(default),
        min: None,
        max: None,
    }
}

fn settings_for(kind: LanguageKind) -> Vec<LspSettingDef> {
    let mut settings = vec![
        bool_setting("enabled", "Use during analysis", true),
        num_setting(
            "max_open_files",
            "Max files to open in the server",
            200,
            10,
            2000,
        ),
        num_setting(
            "max_refs_per_symbol",
            "Max references per symbol",
            24,
            1,
            200,
        ),
        num_setting(
            "diagnostic_wait_ms",
            "Wait for diagnostics (ms)",
            800,
            0,
            10000,
        ),
        bool_setting("collect_symbols", "Collect document symbols", true),
        bool_setting("collect_references", "Collect symbol references", true),
        bool_setting("collect_diagnostics", "Collect diagnostics", true),
    ];

    match kind {
        LanguageKind::TypeScript => {
            settings.push(bool_setting(
                "include_javascript",
                "Include .js / .jsx files",
                true,
            ));
        }
        LanguageKind::Rust => {
            settings.push(bool_setting(
                "cargo_all_targets",
                "Analyze all Cargo targets",
                false,
            ));
        }
        LanguageKind::Python => {
            settings.push(bool_setting(
                "type_checking",
                "Enable type checking diagnostics",
                true,
            ));
        }
        LanguageKind::Go => {
            settings.push(bool_setting(
                "staticcheck",
                "Enable staticcheck diagnostics",
                true,
            ));
        }
    }

    settings
}

/// Build a PATH string that includes common toolchain locations (for GUI apps).
pub fn build_enriched_path() -> String {
    let current = env::var("PATH").unwrap_or_default();
    let mut parts: Vec<String> = Vec::new();

    for p in [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
    ] {
        parts.push(p.to_string());
    }

    if let Some(home) = env::var_os("HOME").map(PathBuf::from) {
        parts.push(home.join(".cargo/bin").to_string_lossy().into());
        parts.push(home.join("go/bin").to_string_lossy().into());
        parts.push(home.join(".local/bin").to_string_lossy().into());
        parts.push(home.join(".volta/bin").to_string_lossy().into());

        if let Some(nvm_node) = super::discover::newest_nvm_node_bin(&home) {
            if let Some(parent) = PathBuf::from(&nvm_node).parent() {
                parts.push(parent.to_string_lossy().into_owned());
            }
        }
    }

    for p in ["/usr/bin", "/bin"] {
        parts.push(p.to_string());
    }

    for segment in current.split(':') {
        if !segment.is_empty() && !parts.iter().any(|p| p == segment) {
            parts.push(segment.to_string());
        }
    }

    parts.join(":")
}

/// Prepend common toolchain dirs so GUI-launched apps still find LSPs / package managers.
pub fn enrich_path() {
    let joined = build_enriched_path();
    // SAFETY: single-threaded at command entry; PATH update is intentional for LSP tooling.
    unsafe { env::set_var("PATH", &joined) };
}

pub fn list_lsp_servers() -> Vec<LspServerStatus> {
    enrich_path();
    SERVERS.iter().map(probe_def).collect()
}

pub fn lsp_cfg<'a>(
    all: &'a LspSettingsMap,
    id: &str,
) -> Option<&'a serde_json::Map<String, serde_json::Value>> {
    all.get(id)
}

pub fn cfg_u32(
    cfg: Option<&serde_json::Map<String, serde_json::Value>>,
    key: &str,
    default: u32,
) -> u32 {
    cfg.and_then(|m| m.get(key))
        .and_then(|v| v.as_u64().or_else(|| v.as_f64().map(|f| f as u64)))
        .map(|n| n as u32)
        .unwrap_or(default)
}

pub fn cfg_bool(
    cfg: Option<&serde_json::Map<String, serde_json::Value>>,
    key: &str,
    default: bool,
) -> bool {
    cfg.and_then(|m| m.get(key))
        .and_then(|v| v.as_bool())
        .unwrap_or(default)
}

fn probe_def(def: &ServerDef) -> LspServerStatus {
    let id = def.kind.label().to_string();
    let settings = settings_for(def.kind);
    match super::discover::probe_language_server(def.kind) {
        Some((command, args)) => LspServerStatus {
            id,
            language: def.kind.label().into(),
            label: def.label.into(),
            status: "installed".into(),
            command: Some(format_server_command(def.kind, &command, &args)),
            install_hint: def.install_hint.into(),
            settings,
        },
        None => LspServerStatus {
            id,
            language: def.kind.label().into(),
            label: def.label.into(),
            status: "missing".into(),
            command: None,
            install_hint: def.install_hint.into(),
            settings,
        },
    }
}

fn format_server_command(
    lang: LanguageKind,
    command: &str,
    args: &[String],
) -> String {
    if command.ends_with("node") || command.contains("/node") {
        if let Some(script) = args.first() {
            let name = Path::new(script)
                .parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.file_name())
                .and_then(|n| n.to_str())
                .unwrap_or("language-server");
            return format!("{command} ({name})");
        }
        return match lang {
            LanguageKind::TypeScript => "node (typescript-language-server)".into(),
            LanguageKind::Python => "node (pyright/basedpyright)".into(),
            _ => command.to_string(),
        };
    }
    resolve_which(command).unwrap_or_else(|| command.to_string())
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
