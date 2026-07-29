use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use serde_json::Value;

use crate::analysis::ValidationItem;

use super::discover::{
    default_linter_id, file_language, probe_linter, LanguageKind,
};
use super::status::{cfg_bool, cfg_str, cfg_u32, linter_cfg, LinterSettingsMap};

const DEFAULT_LINTER_TIMEOUT: Duration = Duration::from_secs(90);
const CLIPPY_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Debug, Clone)]
struct LintFinding {
    path: String,
    line: u32,
    severity: String,
    message: String,
}

/// Run a subprocess with stdout/stderr captured. Kills the child on timeout.
fn command_output_with_timeout(mut cmd: Command, timeout: Duration) -> Result<Output, String> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let child = cmd
        .spawn()
        .map_err(|e| format!("failed to start process: {e}"))?;
    let pid = child.id();

    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(e)) => Err(format!("wait failed: {e}")),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            kill_process(pid);
            Err(format!("timed out after {}s", timeout.as_secs()))
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => Err("linter process disconnected".into()),
    }
}

#[cfg(unix)]
fn kill_process(pid: u32) {
    let _ = Command::new("kill")
        .arg(pid.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(windows)]
fn kill_process(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

pub fn run_language_linter_for_lang(
    root: &Path,
    files: &[(String, u32)],
    settings: &LinterSettingsMap,
    lang: LanguageKind,
) -> Result<ValidationItem, String> {
    let settings = super::status::merge_linter_settings(settings);
    let cfg = linter_cfg(&settings, lang.id());
    if !cfg_bool(cfg, "enabled", true) {
        return Ok(ValidationItem {
            rule_id: format!("linter:{}", lang.id()),
            rule_name: format!("{} (linter)", lang.label()),
            status: "pass".into(),
            message: format!("{} linter disabled in settings", lang.label()),
            affected: vec![],
            cycle_groups: None,
        });
    }
    let linter_id = cfg_str(cfg, "linter_id", default_linter_id(lang));
    let min_level = cfg_str(cfg, "min_level", "warning");
    let sample_limit = cfg_u32(cfg, "sample_limit", 20) as usize;

    if probe_linter(&linter_id).is_none() {
        return Ok(ValidationItem {
            rule_id: format!("linter:{}", lang.id()),
            rule_name: format!("{} ({linter_id})", lang.label()),
            status: "warn".into(),
            message: format!(
                "{linter_id} is not installed. Install it from Settings → Language Linters."
            ),
            affected: vec![],
            cycle_groups: None,
        });
    }

    let findings = match run_linter(root, lang, &linter_id, files) {
        Ok(findings) => findings,
        Err(err) => {
            return Ok(ValidationItem {
                rule_id: format!("linter:{}", lang.id()),
                rule_name: format!("{} ({linter_id})", lang.label()),
                status: "warn".into(),
                message: err,
                affected: vec![],
                cycle_groups: None,
            });
        }
    };
    Ok(build_validation_item(
        lang,
        &linter_id,
        &min_level,
        sample_limit,
        &findings,
    ))
}

fn build_validation_item(
    lang: LanguageKind,
    linter_id: &str,
    min_level: &str,
    sample_limit: usize,
    findings: &[LintFinding],
) -> ValidationItem {
    let filtered: Vec<&LintFinding> = findings
        .iter()
        .filter(|f| severity_meets_min(&f.severity, min_level))
        .collect();

    let errors = filtered.iter().filter(|f| f.severity == "error").count();
    let warnings = filtered.iter().filter(|f| f.severity == "warning").count();
    let infos = filtered.iter().filter(|f| f.severity == "info").count();

    if filtered.is_empty() {
        return ValidationItem {
            rule_id: format!("linter:{}", lang.id()),
            rule_name: format!("{} ({linter_id})", lang.label()),
            status: "pass".into(),
            message: if findings.is_empty() {
                format!("No issues reported by {linter_id}")
            } else {
                format!("No issues at or above {min_level} level")
            },
            affected: vec![],
            cycle_groups: None,
        };
    }

    let mut affected: Vec<String> = filtered
        .iter()
        .map(|f| format!("{}:{} — [{}] {}", f.path, f.line, f.severity, f.message))
        .collect();
    affected.sort();
    affected.dedup();
    let sample: Vec<String> = affected.into_iter().take(sample_limit).collect();

    let status = if errors > 0 { "fail" } else { "warn" };

    ValidationItem {
        rule_id: format!("linter:{}", lang.id()),
        rule_name: format!("{} ({linter_id})", lang.label()),
        status: status.into(),
        message: format!(
            "{errors} error(s), {warnings} warning(s), {infos} info — level ≥ {min_level}"
        ),
        affected: sample,
        cycle_groups: None,
    }
}

fn severity_meets_min(severity: &str, min_level: &str) -> bool {
    let rank = |s: &str| match s {
        "error" => 3,
        "warning" => 2,
        "info" | "hint" => 1,
        _ => 2,
    };
    rank(severity) >= rank(min_level)
}

fn run_linter(
    root: &Path,
    lang: LanguageKind,
    linter_id: &str,
    files: &[(String, u32)],
) -> Result<Vec<LintFinding>, String> {
    match linter_id {
        "eslint" => run_eslint(root, files),
        "biome" => run_biome(root),
        "oxlint" => run_oxlint(root, files),
        "clippy" => run_clippy(root),
        "ruff" => run_ruff(root),
        "pylint" => run_pylint(root, files),
        "flake8" => run_flake8(root, files),
        "golangci-lint" => run_golangci_lint(root),
        "staticcheck" => run_staticcheck(root, files),
        _ => Err(format!("Unknown linter: {linter_id}")),
    }
    .map_err(|e| {
        if e.contains("not found") || e.contains("not installed") {
            format!(
                "{linter_id} is not installed for {}. Install it from Settings → Language Linters.",
                lang.label()
            )
        } else if e.contains("timed out") {
            format!(
                "{linter_id} for {} exceeded the time limit ({e}). Try running it manually in the project, or disable this language in Settings → Language Linters.",
                lang.label()
            )
        } else {
            e
        }
    })
}

fn resolve_eslint(root: &Path) -> Option<String> {
    let local = root.join("node_modules/.bin/eslint");
    if local.is_file() {
        return Some(local.to_string_lossy().into_owned());
    }
    super::discover::resolve_which("eslint")
}

fn run_eslint(root: &Path, files: &[(String, u32)]) -> Result<Vec<LintFinding>, String> {
    let eslint = resolve_eslint(root).ok_or_else(|| "eslint not found".to_string())?;
    let paths: Vec<String> = files
        .iter()
        .filter(|(p, _)| file_language(p) == Some(LanguageKind::TypeScript))
        .map(|(p, _)| p.clone())
        .take(80)
        .collect();
    if paths.is_empty() {
        return Ok(vec![]);
    }

    let mut cmd = Command::new(&eslint);
    cmd.arg("--format")
        .arg("json")
        .arg("--no-error-on-unmatched-pattern")
        .args(&paths)
        .current_dir(root);
    let output = command_output_with_timeout(cmd, DEFAULT_LINTER_TIMEOUT)
        .map_err(|e| format!("eslint: {e}"))?;

    parse_eslint_json(&output.stdout)
}

fn parse_eslint_json(stdout: &[u8]) -> Result<Vec<LintFinding>, String> {
    let text = String::from_utf8_lossy(stdout);
    if text.trim().is_empty() {
        return Ok(vec![]);
    }
    let value: Value = serde_json::from_str(&text).map_err(|e| format!("eslint JSON: {e}"))?;
    let files = value
        .as_array()
        .ok_or_else(|| "eslint: expected array".to_string())?;
    let mut out = Vec::new();
    for file in files {
        let path = file
            .get("filePath")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let rel = strip_root_prefix(&path);
        let Some(messages) = file.get("messages").and_then(|v| v.as_array()) else {
            continue;
        };
        for msg in messages {
            let severity = match msg.get("severity").and_then(|v| v.as_u64()) {
                Some(2) => "error",
                Some(1) => "warning",
                _ => "info",
            };
            out.push(LintFinding {
                path: rel.clone(),
                line: msg.get("line").and_then(|v| v.as_u64()).unwrap_or(1) as u32,
                severity: severity.into(),
                message: msg
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("lint issue")
                    .to_string(),
            });
        }
    }
    Ok(out)
}

fn run_biome(root: &Path) -> Result<Vec<LintFinding>, String> {
    let biome = super::discover::resolve_which("biome")
        .ok_or_else(|| "biome not found".to_string())?;
    let mut cmd = Command::new(&biome);
    cmd.args(["check", "--reporter", "json"]).current_dir(root);
    let output = command_output_with_timeout(cmd, DEFAULT_LINTER_TIMEOUT)
        .map_err(|e| format!("biome: {e}"))?;

    parse_biome_json(&output.stdout)
}

fn parse_biome_json(stdout: &[u8]) -> Result<Vec<LintFinding>, String> {
    let text = String::from_utf8_lossy(stdout);
    if text.trim().is_empty() {
        return Ok(vec![]);
    }
    let value: Value = serde_json::from_str(&text).map_err(|e| format!("biome JSON: {e}"))?;
    let mut out = Vec::new();
    if let Some(diagnostics) = value.get("diagnostics").and_then(|v| v.as_array()) {
        for diag in diagnostics {
            let (path, line) = extract_location(diag);
            out.push(LintFinding {
                path,
                line,
                severity: diag
                    .get("severity")
                    .and_then(|v| v.as_str())
                    .map(normalize_severity)
                    .unwrap_or_else(|| "warning".into()),
                message: diag
                    .get("description")
                    .or_else(|| diag.get("message"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("lint issue")
                    .to_string(),
            });
        }
    }
    Ok(out)
}

fn run_oxlint(root: &Path, files: &[(String, u32)]) -> Result<Vec<LintFinding>, String> {
    let oxlint = super::discover::resolve_which("oxlint")
        .ok_or_else(|| "oxlint not found".to_string())?;
    let paths: Vec<String> = files
        .iter()
        .filter(|(p, _)| file_language(p) == Some(LanguageKind::TypeScript))
        .map(|(p, _)| p.clone())
        .take(200)
        .collect();
    if paths.is_empty() {
        return Ok(vec![]);
    }

    let mut cmd = Command::new(&oxlint);
    cmd.arg("--format")
        .arg("json")
        .args(&paths)
        .current_dir(root);
    let output = command_output_with_timeout(cmd, DEFAULT_LINTER_TIMEOUT)
        .map_err(|e| format!("oxlint: {e}"))?;

    parse_oxlint_json(&output.stdout)
}

fn parse_oxlint_json(stdout: &[u8]) -> Result<Vec<LintFinding>, String> {
    let text = String::from_utf8_lossy(stdout);
    if text.trim().is_empty() {
        return Ok(vec![]);
    }
    let value: Value = serde_json::from_str(&text).map_err(|e| format!("oxlint JSON: {e}"))?;
    let mut out = Vec::new();
    let diags = value
        .get("diagnostics")
        .and_then(|v| v.as_array())
        .or_else(|| value.as_array());
    let Some(diags) = diags else {
        return Ok(out);
    };
    for diag in diags {
        let (path, line) = extract_location(diag);
        out.push(LintFinding {
            path,
            line,
            severity: diag
                .get("severity")
                .and_then(|v| v.as_str())
                .map(normalize_severity)
                .unwrap_or_else(|| "warning".into()),
            message: diag
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("lint issue")
                .to_string(),
        });
    }
    Ok(out)
}

fn run_clippy(root: &Path) -> Result<Vec<LintFinding>, String> {
    if root.join("Cargo.toml").is_file() {
        return run_cargo_clippy_in(root);
    }
    if root.join("src-tauri/Cargo.toml").is_file() {
        return run_cargo_clippy_in(&root.join("src-tauri"));
    }
    Err("No Cargo.toml found for clippy".into())
}

fn run_cargo_clippy_in(dir: &Path) -> Result<Vec<LintFinding>, String> {
    let mut cmd = Command::new("cargo");
    cmd.args([
            "clippy",
            "--message-format=json",
            "--quiet",
            "--no-deps",
            "--",
            "-W",
            "clippy::all",
        ])
        .current_dir(dir)
        .env("CARGO_TERM_COLOR", "never");
    let output = command_output_with_timeout(cmd, CLIPPY_TIMEOUT)
        .map_err(|e| format!("cargo clippy: {e}"))?;

    parse_cargo_json_lines(&output.stdout, &output.stderr)
}

fn parse_cargo_json_lines(stdout: &[u8], stderr: &[u8]) -> Result<Vec<LintFinding>, String> {
    let mut out = Vec::new();
    for chunk in [stdout, stderr] {
        for line in String::from_utf8_lossy(chunk).lines() {
            let line = line.trim();
            if !line.starts_with('{') {
                continue;
            }
            let Ok(value) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            if value.get("reason").and_then(|v| v.as_str()) != Some("compiler-message") {
                continue;
            }
            let Some(message) = value.get("message") else {
                continue;
            };
            let level = message
                .get("level")
                .and_then(|v| v.as_str())
                .map(normalize_severity)
                .unwrap_or_else(|| "warning".into());
            if level == "info" && message.get("code").is_none() {
                continue;
            }
            let text = message
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("clippy issue")
                .to_string();
            let (path, line_no) = message
                .get("spans")
                .and_then(|v| v.as_array())
                .and_then(|a| a.first())
                .map(|span| {
                    (
                        span.get("file_name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        span.get("line_start")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(1) as u32,
                    )
                })
                .unwrap_or_else(|| (".".into(), 1));
            out.push(LintFinding {
                path: strip_root_prefix(&path),
                line: line_no,
                severity: level,
                message: text,
            });
        }
    }
    Ok(out)
}

fn run_ruff(root: &Path) -> Result<Vec<LintFinding>, String> {
    let ruff =
        super::discover::resolve_which("ruff").ok_or_else(|| "ruff not found".to_string())?;
    let mut cmd = Command::new(&ruff);
    cmd.args(["check", "--output-format", "json", "."])
        .current_dir(root);
    let output = command_output_with_timeout(cmd, DEFAULT_LINTER_TIMEOUT)
        .map_err(|e| format!("ruff: {e}"))?;

    parse_ruff_json(&output.stdout)
}

fn parse_ruff_json(stdout: &[u8]) -> Result<Vec<LintFinding>, String> {
    let text = String::from_utf8_lossy(stdout);
    if text.trim().is_empty() {
        return Ok(vec![]);
    }
    let items: Vec<Value> = serde_json::from_str(&text).map_err(|e| format!("ruff JSON: {e}"))?;
    let mut out = Vec::new();
    for item in items {
        out.push(LintFinding {
            path: item
                .get("filename")
                .and_then(|v| v.as_str())
                .map(strip_root_prefix)
                .unwrap_or_default(),
            line: item
                .get("location")
                .and_then(|l| l.get("row"))
                .and_then(|v| v.as_u64())
                .unwrap_or(1) as u32,
            severity: "warning".into(),
            message: item
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("ruff issue")
                .to_string(),
        });
    }
    Ok(out)
}

fn run_pylint(root: &Path, files: &[(String, u32)]) -> Result<Vec<LintFinding>, String> {
    let pylint = super::discover::resolve_which("pylint")
        .ok_or_else(|| "pylint not found".to_string())?;
    let paths: Vec<String> = files
        .iter()
        .filter(|(p, _)| file_language(p) == Some(LanguageKind::Python))
        .map(|(p, _)| p.clone())
        .take(100)
        .collect();
    if paths.is_empty() {
        return Ok(vec![]);
    }

    let mut cmd = Command::new(&pylint);
    cmd.arg("--output-format=json")
        .args(&paths)
        .current_dir(root);
    let output = command_output_with_timeout(cmd, DEFAULT_LINTER_TIMEOUT)
        .map_err(|e| format!("pylint: {e}"))?;

    parse_pylint_json(&output.stdout)
}

fn parse_pylint_json(stdout: &[u8]) -> Result<Vec<LintFinding>, String> {
    let text = String::from_utf8_lossy(stdout);
    if text.trim().is_empty() {
        return Ok(vec![]);
    }
    let items: Vec<Value> = serde_json::from_str(&text).map_err(|e| format!("pylint JSON: {e}"))?;
    let mut out = Vec::new();
    for item in items {
        let severity = match item.get("type").and_then(|v| v.as_str()) {
            Some("error" | "fatal") => "error",
            Some("warning" | "convention") => "warning",
            _ => "info",
        };
        out.push(LintFinding {
            path: item
                .get("path")
                .and_then(|v| v.as_str())
                .map(strip_root_prefix)
                .unwrap_or_default(),
            line: item.get("line").and_then(|v| v.as_u64()).unwrap_or(1) as u32,
            severity: severity.into(),
            message: item
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("pylint issue")
                .to_string(),
        });
    }
    Ok(out)
}

fn run_flake8(root: &Path, files: &[(String, u32)]) -> Result<Vec<LintFinding>, String> {
    let flake8 = super::discover::resolve_which("flake8")
        .ok_or_else(|| "flake8 not found".to_string())?;
    let paths: Vec<String> = files
        .iter()
        .filter(|(p, _)| file_language(p) == Some(LanguageKind::Python))
        .map(|(p, _)| p.clone())
        .take(100)
        .collect();
    if paths.is_empty() {
        return Ok(vec![]);
    }

    let mut cmd = Command::new(&flake8);
    cmd.args(&paths).current_dir(root);
    let output = command_output_with_timeout(cmd, DEFAULT_LINTER_TIMEOUT)
        .map_err(|e| format!("flake8: {e}"))?;

    Ok(parse_flake8_lines(&output.stdout))
}

fn parse_flake8_lines(stdout: &[u8]) -> Vec<LintFinding> {
    let mut out = Vec::new();
    for line in String::from_utf8_lossy(stdout).lines() {
        let parts: Vec<&str> = line.splitn(4, ':').collect();
        if parts.len() < 4 {
            continue;
        }
        let line_no = parts[1].trim().parse().unwrap_or(1);
        out.push(LintFinding {
            path: parts[0].trim().to_string(),
            line: line_no,
            severity: "warning".into(),
            message: parts[3].trim().to_string(),
        });
    }
    out
}

fn run_golangci_lint(root: &Path) -> Result<Vec<LintFinding>, String> {
    let bin = super::discover::resolve_which("golangci-lint")
        .ok_or_else(|| "golangci-lint not found".to_string())?;
    let mut cmd = Command::new(&bin);
    cmd.args(["run", "--out-format", "json", "./..."])
        .current_dir(root);
    let output = command_output_with_timeout(cmd, Duration::from_secs(120))
        .map_err(|e| format!("golangci-lint: {e}"))?;

    parse_golangci_json(&output.stdout)
}

fn parse_golangci_json(stdout: &[u8]) -> Result<Vec<LintFinding>, String> {
    let text = String::from_utf8_lossy(stdout);
    if text.trim().is_empty() {
        return Ok(vec![]);
    }
    let value: Value = serde_json::from_str(&text).map_err(|e| format!("golangci JSON: {e}"))?;
    let issues = value
        .get("Issues")
        .and_then(|v| v.as_array())
        .or_else(|| value.get("issues").and_then(|v| v.as_array()));
    let Some(issues) = issues else {
        return Ok(vec![]);
    };
    let mut out = Vec::new();
    for issue in issues {
        out.push(LintFinding {
            path: issue
                .get("Pos")
                .and_then(|p| p.get("Filename"))
                .or_else(|| issue.get("filename"))
                .and_then(|v| v.as_str())
                .map(strip_root_prefix)
                .unwrap_or_default(),
            line: issue
                .get("Pos")
                .and_then(|p| p.get("Line"))
                .or_else(|| issue.get("line"))
                .and_then(|v| v.as_u64())
                .unwrap_or(1) as u32,
            severity: issue
                .get("Severity")
                .or_else(|| issue.get("severity"))
                .and_then(|v| v.as_str())
                .map(normalize_severity)
                .unwrap_or_else(|| "warning".into()),
            message: issue
                .get("Text")
                .or_else(|| issue.get("message"))
                .and_then(|v| v.as_str())
                .unwrap_or("lint issue")
                .to_string(),
        });
    }
    Ok(out)
}

fn run_staticcheck(root: &Path, files: &[(String, u32)]) -> Result<Vec<LintFinding>, String> {
    let bin = super::discover::resolve_which("staticcheck")
        .ok_or_else(|| "staticcheck not found".to_string())?;
    let paths: Vec<String> = files
        .iter()
        .filter(|(p, _)| file_language(p) == Some(LanguageKind::Go))
        .map(|(p, _)| p.clone())
        .take(100)
        .collect();
    if paths.is_empty() {
        return Ok(vec![]);
    }

    let mut cmd = Command::new(&bin);
    cmd.args(&paths).current_dir(root);
    let output = command_output_with_timeout(cmd, DEFAULT_LINTER_TIMEOUT)
        .map_err(|e| format!("staticcheck: {e}"))?;

    Ok(parse_staticcheck_lines(&output.stdout))
}

fn parse_staticcheck_lines(stdout: &[u8]) -> Vec<LintFinding> {
    let mut out = Vec::new();
    for line in String::from_utf8_lossy(stdout).lines() {
        let parts: Vec<&str> = line.splitn(4, ':').collect();
        if parts.len() < 4 {
            continue;
        }
        let line_no = parts[1].trim().parse().unwrap_or(1);
        out.push(LintFinding {
            path: parts[0].trim().to_string(),
            line: line_no,
            severity: "warning".into(),
            message: parts[3].trim().to_string(),
        });
    }
    out
}

fn extract_location(diag: &Value) -> (String, u32) {
    if let Some(span) = diag.get("span").or_else(|| diag.get("location")) {
        let path = span
            .get("path")
            .or_else(|| span.get("file"))
            .and_then(|v| v.as_str())
            .map(strip_root_prefix)
            .unwrap_or_default();
        let line = span
            .get("line")
            .or_else(|| span.get("start").and_then(|s| s.get("line")))
            .and_then(|v| v.as_u64())
            .unwrap_or(1) as u32;
        return (path, line);
    }
    (String::new(), 1)
}

fn normalize_severity(s: &str) -> String {
    match s.to_lowercase().as_str() {
        "err" | "error" | "fatal" => "error".into(),
        "warn" | "warning" => "warning".into(),
        _ => "info".into(),
    }
}

fn strip_root_prefix(path: &str) -> String {
    path.replace('\\', "/")
}
