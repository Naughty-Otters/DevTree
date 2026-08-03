use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::analysis::ValidationItem;
use crate::linter::resolve_which;

const GITLEAKS_TIMEOUT: Duration = Duration::from_secs(180);
pub const INSTALL_HINT: &str =
    "brew install gitleaks  ·  or: go install github.com/gitleaks/gitleaks/v8@latest";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitleaksStatus {
    /// "installed" | "missing"
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    pub install_hint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitleaksInstallResult {
    pub ok: bool,
    pub message: String,
    pub status: GitleaksStatus,
}

fn cfg_bool(cfg: Option<&serde_json::Map<String, serde_json::Value>>, key: &str, default: bool) -> bool {
    cfg.and_then(|m| m.get(key))
        .and_then(|v| v.as_bool())
        .unwrap_or(default)
}

fn cfg_u32(cfg: Option<&serde_json::Map<String, serde_json::Value>>, key: &str, default: u32) -> u32 {
    cfg.and_then(|m| m.get(key))
        .and_then(|v| v.as_u64().or_else(|| v.as_f64().map(|f| f as u64)))
        .map(|n| n as u32)
        .unwrap_or(default)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct GitleaksFinding {
    file: String,
    #[serde(default)]
    start_line: u32,
    #[serde(default)]
    rule_id: String,
    #[serde(default)]
    description: String,
}

pub fn gitleaks_status() -> GitleaksStatus {
    match probe_gitleaks() {
        Some(command) => GitleaksStatus {
            status: "installed".into(),
            command: Some(command),
            install_hint: INSTALL_HINT.into(),
        },
        None => GitleaksStatus {
            status: "missing".into(),
            command: None,
            install_hint: INSTALL_HINT.into(),
        },
    }
}

pub fn install_gitleaks() -> Result<GitleaksInstallResult, String> {
    crate::linter::enrich_path();
    if probe_gitleaks().is_some() {
        return Ok(GitleaksInstallResult {
            ok: true,
            message: "gitleaks is already installed.".into(),
            status: gitleaks_status(),
        });
    }

    let mut last_output = String::new();
    let mut attempted = false;

    if command_on_path("brew") {
        attempted = true;
        let (ok, output) = run_install("brew", &["install", "gitleaks"]);
        last_output = output;
        if ok && probe_gitleaks().is_some() {
            return Ok(GitleaksInstallResult {
                ok: true,
                message: format!("Installed gitleaks with Homebrew.\n{last_output}"),
                status: gitleaks_status(),
            });
        }
    }

    if command_on_path("go") {
        attempted = true;
        let (ok, output) = run_install(
            "go",
            &["install", "github.com/gitleaks/gitleaks/v8@latest"],
        );
        if !last_output.is_empty() {
            last_output.push_str("\n\n");
        }
        last_output.push_str(&output);
        if ok && probe_gitleaks().is_some() {
            return Ok(GitleaksInstallResult {
                ok: true,
                message: format!("Installed gitleaks with go install.\n{output}"),
                status: gitleaks_status(),
            });
        }
    }

    #[cfg(target_os = "windows")]
    if command_on_path("scoop") {
        attempted = true;
        let (ok, output) = run_install("scoop", &["install", "gitleaks"]);
        last_output = output;
        if ok && probe_gitleaks().is_some() {
            return Ok(GitleaksInstallResult {
                ok: true,
                message: format!("Installed gitleaks with Scoop.\n{last_output}"),
                status: gitleaks_status(),
            });
        }
    }

    #[cfg(target_os = "windows")]
    if command_on_path("winget") {
        attempted = true;
        let (ok, output) = run_install(
            "winget",
            &["install", "--id", "Gitleaks.Gitleaks", "-e", "--accept-package-agreements"],
        );
        if !last_output.is_empty() {
            last_output.push_str("\n\n");
        }
        last_output.push_str(&output);
        if ok && probe_gitleaks().is_some() {
            return Ok(GitleaksInstallResult {
                ok: true,
                message: format!("Installed gitleaks with winget.\n{output}"),
                status: gitleaks_status(),
            });
        }
    }

    let status = gitleaks_status();
    if status.status == "installed" {
        return Ok(GitleaksInstallResult {
            ok: true,
            message: "gitleaks is now available on PATH.".into(),
            status,
        });
    }

    let message = if attempted {
        format!(
            "Install finished but gitleaks is still not on PATH. Restart DevTree or your shell, then try again.\n{last_output}"
        )
    } else {
        format!(
            "No supported installer found. Install manually:\n{INSTALL_HINT}"
        )
    };

    Ok(GitleaksInstallResult {
        ok: false,
        message: message.trim().to_string(),
        status,
    })
}

fn command_on_path(name: &str) -> bool {
    resolve_which(name).is_some()
}

fn run_install(program: &str, args: &[&str]) -> (bool, String) {
    let output = match Command::new(program).args(args).output() {
        Ok(output) => output,
        Err(err) => return (false, format!("Failed to run `{program}`: {err}")),
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

pub fn probe_gitleaks() -> Option<String> {
    resolve_which("gitleaks")
}

pub fn run_gitleaks_check(
    root: &Path,
    cfg: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ValidationItem {
    let rule_name = "Secret Scan (gitleaks)".to_string();
    if !cfg_bool(cfg, "enabled", true) {
        return ValidationItem {
            rule_id: "gitleaks".into(),
            rule_name,
            status: "pass".into(),
            message: "Gitleaks scan disabled in settings".into(),
            affected: vec![],
            cycle_groups: None,
        };
    }

    let Some(gitleaks) = probe_gitleaks() else {
        return ValidationItem {
            rule_id: "gitleaks".into(),
            rule_name,
            status: "warn".into(),
            message: "gitleaks is not installed. Install it from Settings → Rules → Secret Scan (gitleaks).".into(),
            affected: vec![],
            cycle_groups: None,
        };
    };

    let sample_limit = cfg_u32(cfg, "sample_limit", 20) as usize;
    match scan_with_gitleaks(root, &gitleaks) {
        Ok(findings) => build_validation_item(root, sample_limit, findings),
        Err(err) => ValidationItem {
            rule_id: "gitleaks".into(),
            rule_name,
            status: "warn".into(),
            message: format!("Gitleaks scan failed: {err}"),
            affected: vec![],
            cycle_groups: None,
        },
    }
}

fn scan_with_gitleaks(root: &Path, gitleaks: &str) -> Result<Vec<GitleaksFinding>, String> {
    let root_str = root
        .to_str()
        .ok_or_else(|| "project path is not valid UTF-8".to_string())?;

    let output = run_gitleaks_command(gitleaks, root_str)?;
    parse_gitleaks_output(root, &output)
}

fn run_gitleaks_command(gitleaks: &str, root: &str) -> Result<Output, String> {
    let mut cmd = Command::new(gitleaks);
    cmd.current_dir(root).args([
        "dir",
        root,
        "--report-format",
        "json",
        "--report-path",
        "-",
        "--no-banner",
        "--log-level",
        "error",
    ]);
    command_output_with_timeout(cmd, GITLEAKS_TIMEOUT)
}

fn command_output_with_timeout(mut cmd: Command, timeout: Duration) -> Result<Output, String> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let child = cmd
        .spawn()
        .map_err(|e| format!("failed to start gitleaks: {e}"))?;
    let pid = child.id();

    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(e)) => Err(format!("gitleaks wait failed: {e}")),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            kill_process(pid);
            Err(format!("gitleaks timed out after {}s", timeout.as_secs()))
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => Err("gitleaks process disconnected".into()),
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

fn parse_gitleaks_output(root: &Path, output: &Output) -> Result<Vec<GitleaksFinding>, String> {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if stdout.is_empty() {
        if output.status.success() || output.status.code() == Some(1) {
            return Ok(Vec::new());
        }
        return Err(if stderr.is_empty() {
            format!("gitleaks exited with {}", output.status)
        } else {
            stderr
        });
    }

    let findings = parse_gitleaks_json(&stdout).map_err(|err| {
        if stderr.is_empty() {
            err
        } else {
            format!("{err}; stderr: {stderr}")
        }
    })?;

    if !output.status.success() && output.status.code() != Some(1) && findings.is_empty() {
        return Err(if stderr.is_empty() {
            format!("gitleaks exited with {}", output.status)
        } else {
            stderr
        });
    }

    let _ = root;
    Ok(findings)
}

fn parse_gitleaks_json(stdout: &str) -> Result<Vec<GitleaksFinding>, String> {
    serde_json::from_str(stdout).map_err(|err| format!("failed to parse gitleaks JSON: {err}"))
}

fn build_validation_item(
    root: &Path,
    sample_limit: usize,
    findings: Vec<GitleaksFinding>,
) -> ValidationItem {
    let rule_name = "Secret Scan (gitleaks)".to_string();
    if findings.is_empty() {
        return ValidationItem {
            rule_id: "gitleaks".into(),
            rule_name,
            status: "pass".into(),
            message: "No secrets detected by gitleaks".into(),
            affected: vec![],
            cycle_groups: None,
        };
    }

    let mut affected: Vec<String> = findings
        .iter()
        .map(|finding| format_affected(root, finding))
        .collect();
    affected.sort();
    affected.dedup();
    let total = affected.len();
    let sample: Vec<String> = affected.into_iter().take(sample_limit).collect();

    ValidationItem {
        rule_id: "gitleaks".into(),
        rule_name,
        status: "fail".into(),
        message: format!(
            "{total} potential secret(s) detected by gitleaks (showing up to {sample_limit})"
        ),
        affected: sample,
        cycle_groups: None,
    }
}

fn format_affected(root: &Path, finding: &GitleaksFinding) -> String {
    let path = relativize_path(root, &finding.file);
    let line = finding.start_line.max(1);
    let detail = if finding.description.trim().is_empty() {
        finding.rule_id.clone()
    } else if finding.rule_id.trim().is_empty() {
        finding.description.trim().to_string()
    } else {
        format!("{} — {}", finding.rule_id, finding.description.trim())
    };
    format!("{path}:{line} — {detail}")
}

fn relativize_path(root: &Path, file: &str) -> String {
    let path = PathBuf::from(file);
    if path.is_absolute() {
        if let Ok(rel) = path.strip_prefix(root) {
            return rel.to_string_lossy().replace('\\', "/");
        }
        if let (Ok(root), Ok(candidate)) = (root.canonicalize(), path.canonicalize()) {
            if let Ok(rel) = candidate.strip_prefix(root) {
                return rel.to_string_lossy().replace('\\', "/");
            }
        }
    }
    file.replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_gitleaks_json_findings() {
        let json = r#"[
          {
            "Description": "AWS Access Key",
            "StartLine": 12,
            "RuleID": "aws-access-key",
            "File": "src/config.ts"
          }
        ]"#;
        let findings = parse_gitleaks_json(json).expect("parse");
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].file, "src/config.ts");
        assert_eq!(findings[0].start_line, 12);
    }

    #[test]
    fn formats_affected_entries_with_line_and_rule() {
        let root = Path::new("/repo");
        let finding = GitleaksFinding {
            file: "/repo/services/auth.py".into(),
            start_line: 44,
            rule_id: "generic-api-key".into(),
            description: "Generic API Key".into(),
        };
        assert_eq!(
            format_affected(root, &finding),
            "services/auth.py:44 — generic-api-key — Generic API Key"
        );
    }

    #[test]
    fn gitleaks_status_serializes_installed_or_missing() {
        let status = gitleaks_status();
        assert!(status.status == "installed" || status.status == "missing");
        assert!(!status.install_hint.is_empty());
    }
}
