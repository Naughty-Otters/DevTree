use std::collections::HashMap;
use std::env;
use std::process::Command;

use serde::{Deserialize, Serialize};

use super::discover::{
    default_linter_id, linters_for, probe_linter, LanguageKind, LinterDef,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinterLevelDef {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinterOption {
    pub id: String,
    pub label: String,
    /// "installed" | "missing"
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    pub install_hint: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageLinterGroup {
    pub id: String,
    pub language: String,
    pub label: String,
    pub linters: Vec<LinterOption>,
    pub levels: Vec<LinterLevelDef>,
    pub default_linter_id: String,
    pub default_level: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinterInstallResult {
    pub ok: bool,
    pub message: String,
    pub linter: LinterOption,
    pub language_id: String,
}

pub type LinterSettingsMap =
    HashMap<String, serde_json::Map<String, serde_json::Value>>;

const LEVELS: &[(&str, &str)] = &[
    ("error", "Errors only"),
    ("warning", "Warnings and errors"),
    ("info", "Info, warnings, and errors"),
];

pub fn enrich_path() {
    let joined = crate::lsp::build_enriched_path();
    // SAFETY: single-threaded at command entry; PATH update is intentional for LSP tooling.
    unsafe { env::set_var("PATH", &joined) };
}

pub fn default_linter_settings() -> LinterSettingsMap {
    let mut map = LinterSettingsMap::new();
    for lang in [
        LanguageKind::TypeScript,
        LanguageKind::Rust,
        LanguageKind::Python,
        LanguageKind::Go,
    ] {
        let mut cfg = serde_json::Map::new();
        cfg.insert("enabled".into(), serde_json::json!(true));
        cfg.insert(
            "linter_id".into(),
            serde_json::json!(default_linter_id(lang)),
        );
        cfg.insert("min_level".into(), serde_json::json!("warning"));
        cfg.insert("sample_limit".into(), serde_json::json!(20));
        map.insert(lang.id().into(), cfg);
    }
    map
}

pub fn merge_linter_settings(
    saved: &LinterSettingsMap,
) -> LinterSettingsMap {
    let defaults = default_linter_settings();
    let mut out = defaults;
    for (id, vals) in saved {
        let entry = out.entry(id.clone()).or_default();
        for (k, v) in vals {
            entry.insert(k.clone(), v.clone());
        }
    }
    out
}

pub fn list_language_linters() -> Vec<LanguageLinterGroup> {
    enrich_path();
    [
        LanguageKind::TypeScript,
        LanguageKind::Rust,
        LanguageKind::Python,
        LanguageKind::Go,
    ]
    .into_iter()
    .map(build_group)
    .collect()
}

fn build_group(lang: LanguageKind) -> LanguageLinterGroup {
    let linters: Vec<LinterOption> = linters_for(lang)
        .iter()
        .map(|def| probe_linter_def(def))
        .collect();
    LanguageLinterGroup {
        id: lang.id().into(),
        language: lang.id().into(),
        label: lang.label().into(),
        default_linter_id: default_linter_id(lang).into(),
        default_level: "warning".into(),
        levels: LEVELS
            .iter()
            .map(|(id, label)| LinterLevelDef {
                id: (*id).into(),
                label: (*label).into(),
            })
            .collect(),
        linters,
    }
}

fn probe_linter_def(def: &LinterDef) -> LinterOption {
    match probe_linter(def.id) {
        Some(command) => LinterOption {
            id: def.id.into(),
            label: def.label.into(),
            status: "installed".into(),
            command: Some(command),
            install_hint: def.install_hint.into(),
            is_default: def.is_default,
        },
        None => LinterOption {
            id: def.id.into(),
            label: def.label.into(),
            status: "missing".into(),
            command: None,
            install_hint: def.install_hint.into(),
            is_default: def.is_default,
        },
    }
}

pub fn linter_cfg<'a>(
    all: &'a LinterSettingsMap,
    language_id: &str,
) -> Option<&'a serde_json::Map<String, serde_json::Value>> {
    all.get(language_id)
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

pub fn cfg_str(
    cfg: Option<&serde_json::Map<String, serde_json::Value>>,
    key: &str,
    default: &str,
) -> String {
    cfg.and_then(|m| m.get(key))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| default.to_string())
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

pub fn install_linter(language_id: &str, linter_id: &str) -> Result<LinterInstallResult, String> {
    enrich_path();
    let lang = match language_id {
        "typescript" => LanguageKind::TypeScript,
        "rust" => LanguageKind::Rust,
        "python" => LanguageKind::Python,
        "go" => LanguageKind::Go,
        _ => return Err(format!("Unknown language id: {language_id}")),
    };

    let def = linters_for(lang)
        .iter()
        .find(|l| l.id == linter_id)
        .ok_or_else(|| format!("Unknown linter id: {linter_id}"))?;

    let (program, args, retry_force_npm) = match linter_id {
        "eslint" => (
            "npm",
            vec![
                "install".into(),
                "-g".into(),
                "eslint".into(),
            ],
            true,
        ),
        "biome" => (
            "npm",
            vec![
                "install".into(),
                "-g".into(),
                "@biomejs/biome".into(),
            ],
            true,
        ),
        "oxlint" => (
            "npm",
            vec!["install".into(), "-g".into(), "oxlint".into()],
            true,
        ),
        "clippy" => (
            "rustup",
            vec!["component".into(), "add".into(), "clippy".into()],
            false,
        ),
        "ruff" => {
            if command_on_path("pip3") {
                ("pip3", vec!["install".into(), "ruff".into()], false)
            } else if command_on_path("pip") {
                ("pip", vec!["install".into(), "ruff".into()], false)
            } else {
                return Err(
                    "pip not found. Install Python pip first, or run: brew install ruff".into(),
                );
            }
        }
        "pylint" => {
            if command_on_path("pip3") {
                ("pip3", vec!["install".into(), "pylint".into()], false)
            } else {
                return Err("pip3 not found. Install Python pip first.".into());
            }
        }
        "flake8" => {
            if command_on_path("pip3") {
                ("pip3", vec!["install".into(), "flake8".into()], false)
            } else {
                return Err("pip3 not found. Install Python pip first.".into());
            }
        }
        "golangci-lint" => {
            if !command_on_path("go") {
                return Err(
                    "Go toolchain not found. Install Go first (e.g. brew install go).".into(),
                );
            }
            (
                "go",
                vec![
                    "install".into(),
                    "github.com/golangci/golangci-lint/cmd/golangci-lint@latest".into(),
                ],
                false,
            )
        }
        "staticcheck" => {
            if !command_on_path("go") {
                return Err("Go toolchain not found. Install Go first.".into());
            }
            (
                "go",
                vec![
                    "install".into(),
                    "honnef.co/go/tools/cmd/staticcheck@latest".into(),
                ],
                false,
            )
        }
        _ => return Err(format!("No installer configured for {linter_id}")),
    };

    if !command_on_path(program) {
        return Err(format!(
            "`{program}` not found on PATH.\nHint: {}",
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
    let linter = probe_linter_def(def);
    let message = if ok {
        if linter.status == "installed" {
            format!("Installed successfully.\n{output}")
        } else {
            format!(
                "Install finished but linter still not on PATH. Restart DevTree and try again.\n{output}"
            )
        }
    } else {
        format!("Install failed.\n{output}")
    };

    Ok(LinterInstallResult {
        ok: ok && linter.status == "installed",
        message: message.trim().to_string(),
        linter,
        language_id: language_id.into(),
    })
}

fn command_on_path(name: &str) -> bool {
    super::discover::resolve_which(name).is_some()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_language_linters() {
        assert!(!list_language_linters().is_empty());
        assert!(!default_linter_settings().is_empty());
    }
}
