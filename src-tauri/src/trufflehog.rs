use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::analysis::ValidationItem;
use crate::linter::resolve_which;

const TRUFFLEHOG_TIMEOUT: Duration = Duration::from_secs(300);
pub const INSTALL_HINT: &str =
    "brew install trufflehog  ·  or: go install github.com/trufflesecurity/trufflehog/v3@latest";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrufflehogStatus {
    /// "installed" | "missing"
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    pub install_hint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrufflehogInstallResult {
    pub ok: bool,
    pub message: String,
    pub status: TrufflehogStatus,
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
struct TrufflehogFinding {
    #[serde(default, rename = "DetectorName")]
    detector_name: String,
    #[serde(default, rename = "DetectorDescription")]
    detector_description: String,
    #[serde(default, rename = "Verified")]
    verified: bool,
    #[serde(default, rename = "SourceMetadata")]
    source_metadata: Option<SourceMetadata>,
}

#[derive(Debug, Clone, Deserialize)]
struct SourceMetadata {
    #[serde(default, rename = "Data")]
    data: Option<SourceMetadataData>,
}

#[derive(Debug, Clone, Deserialize)]
struct SourceMetadataData {
    #[serde(default, rename = "Filesystem")]
    filesystem: Option<FilesystemMeta>,
}

#[derive(Debug, Clone, Deserialize)]
struct FilesystemMeta {
    #[serde(default)]
    file: String,
    #[serde(default)]
    line: u32,
}

pub fn trufflehog_status() -> TrufflehogStatus {
    match probe_trufflehog() {
        Some(command) => TrufflehogStatus {
            status: "installed".into(),
            command: Some(command),
            install_hint: INSTALL_HINT.into(),
        },
        None => TrufflehogStatus {
            status: "missing".into(),
            command: None,
            install_hint: INSTALL_HINT.into(),
        },
    }
}

pub fn install_trufflehog() -> Result<TrufflehogInstallResult, String> {
    crate::linter::enrich_path();
    if probe_trufflehog().is_some() {
        return Ok(TrufflehogInstallResult {
            ok: true,
            message: "trufflehog is already installed.".into(),
            status: trufflehog_status(),
        });
    }

    let mut last_output = String::new();
    let mut attempted = false;

    if command_on_path("brew") {
        attempted = true;
        let (ok, output) = run_install("brew", &["install", "trufflehog"]);
        last_output = output;
        if ok && probe_trufflehog().is_some() {
            return Ok(TrufflehogInstallResult {
                ok: true,
                message: format!("Installed trufflehog with Homebrew.\n{last_output}"),
                status: trufflehog_status(),
            });
        }
    }

    if command_on_path("go") {
        attempted = true;
        let (ok, output) = run_install(
            "go",
            &["install", "github.com/trufflesecurity/trufflehog/v3@latest"],
        );
        if !last_output.is_empty() {
            last_output.push_str("\n\n");
        }
        last_output.push_str(&output);
        if ok && probe_trufflehog().is_some() {
            return Ok(TrufflehogInstallResult {
                ok: true,
                message: format!("Installed trufflehog with go install.\n{output}"),
                status: trufflehog_status(),
            });
        }
    }

    #[cfg(target_os = "windows")]
    if command_on_path("scoop") {
        attempted = true;
        let (ok, output) = run_install("scoop", &["install", "trufflehog"]);
        last_output = output;
        if ok && probe_trufflehog().is_some() {
            return Ok(TrufflehogInstallResult {
                ok: true,
                message: format!("Installed trufflehog with Scoop.\n{last_output}"),
                status: trufflehog_status(),
            });
        }
    }

    #[cfg(target_os = "windows")]
    if command_on_path("winget") {
        attempted = true;
        let (ok, output) = run_install(
            "winget",
            &[
                "install",
                "--id",
                "TruffleSecurity.TruffleHog",
                "-e",
                "--accept-package-agreements",
            ],
        );
        if !last_output.is_empty() {
            last_output.push_str("\n\n");
        }
        last_output.push_str(&output);
        if ok && probe_trufflehog().is_some() {
            return Ok(TrufflehogInstallResult {
                ok: true,
                message: format!("Installed trufflehog with winget.\n{output}"),
                status: trufflehog_status(),
            });
        }
    }

    let status = trufflehog_status();
    if status.status == "installed" {
        return Ok(TrufflehogInstallResult {
            ok: true,
            message: "trufflehog is now available on PATH.".into(),
            status,
        });
    }

    let message = if attempted {
        format!(
            "Install finished but trufflehog is still not on PATH. Restart DevTree or your shell, then try again.\n{last_output}"
        )
    } else {
        format!("No supported installer found. Install manually:\n{INSTALL_HINT}")
    };

    Ok(TrufflehogInstallResult {
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

pub fn probe_trufflehog() -> Option<String> {
    resolve_which("trufflehog")
}

pub fn run_trufflehog_check(
    root: &Path,
    cfg: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ValidationItem {
    let rule_name = "Secret Scan (TruffleHog)".to_string();
    if !cfg_bool(cfg, "enabled", true) {
        return ValidationItem {
            rule_id: "trufflehog".into(),
            rule_name,
            status: "pass".into(),
            message: "TruffleHog scan disabled in settings".into(),
            affected: vec![],
            cycle_groups: None,
        };
    }

    let Some(trufflehog) = probe_trufflehog() else {
        return ValidationItem {
            rule_id: "trufflehog".into(),
            rule_name,
            status: "warn".into(),
            message: "trufflehog is not installed. Install it from Settings → Rules → Secret Scan (TruffleHog).".into(),
            affected: vec![],
            cycle_groups: None,
        };
    };

    let sample_limit = cfg_u32(cfg, "sample_limit", 20) as usize;
    let verify = cfg_bool(cfg, "verify", false);
    let only_verified = cfg_bool(cfg, "only_verified", false);

    match scan_with_trufflehog(root, &trufflehog, verify) {
        Ok(mut findings) => {
            if only_verified {
                findings.retain(|f| f.verified);
            }
            build_validation_item(root, sample_limit, findings)
        }
        Err(err) => ValidationItem {
            rule_id: "trufflehog".into(),
            rule_name,
            status: "warn".into(),
            message: format!("TruffleHog scan failed: {err}"),
            affected: vec![],
            cycle_groups: None,
        },
    }
}

fn scan_with_trufflehog(
    root: &Path,
    trufflehog: &str,
    verify: bool,
) -> Result<Vec<TrufflehogFinding>, String> {
    let root_str = root
        .to_str()
        .ok_or_else(|| "project path is not valid UTF-8".to_string())?;
    let output = run_trufflehog_command(trufflehog, root_str, verify)?;
    parse_trufflehog_output(&output)
}

fn run_trufflehog_command(trufflehog: &str, root: &str, verify: bool) -> Result<Output, String> {
    let mut cmd = Command::new(trufflehog);
    cmd.current_dir(root).args(["filesystem", root, "--json", "--no-update"]);
    if !verify {
        cmd.arg("--no-verification");
    }
    command_output_with_timeout(cmd, TRUFFLEHOG_TIMEOUT)
}

fn command_output_with_timeout(mut cmd: Command, timeout: Duration) -> Result<Output, String> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let child = cmd
        .spawn()
        .map_err(|e| format!("failed to start trufflehog: {e}"))?;
    let pid = child.id();

    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(e)) => Err(format!("trufflehog wait failed: {e}")),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            kill_process(pid);
            Err(format!("trufflehog timed out after {}s", timeout.as_secs()))
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => Err("trufflehog process disconnected".into()),
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

fn parse_trufflehog_output(output: &Output) -> Result<Vec<TrufflehogFinding>, String> {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    // TruffleHog prints one JSON object per line; non-zero exit still can include findings.
    let findings = parse_trufflehog_ndjson(stdout.trim())?;

    if !output.status.success() && findings.is_empty() && !stderr.is_empty() {
        // Filter common progress noise; treat as error only when we have no findings.
        if !looks_like_progress_only(&stderr) {
            return Err(stderr);
        }
    }

    if !output.status.success()
        && findings.is_empty()
        && output.status.code().is_some_and(|c| c != 0 && c != 183)
    {
        return Err(if stderr.is_empty() {
            format!("trufflehog exited with {}", output.status)
        } else {
            stderr
        });
    }

    Ok(findings)
}

fn looks_like_progress_only(stderr: &str) -> bool {
    let lower = stderr.to_lowercase();
    lower.contains("🐷")
        || lower.contains("trufflehog")
        || lower.contains("scanning")
        || lower.contains("finished")
}

fn parse_trufflehog_ndjson(stdout: &str) -> Result<Vec<TrufflehogFinding>, String> {
    if stdout.is_empty() {
        return Ok(Vec::new());
    }

    // Accept either NDJSON or a JSON array.
    let trimmed = stdout.trim();
    if trimmed.starts_with('[') {
        return serde_json::from_str(trimmed)
            .map_err(|err| format!("failed to parse trufflehog JSON array: {err}"));
    }

    let mut findings = Vec::new();
    for (idx, line) in trimmed.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        match serde_json::from_str::<TrufflehogFinding>(line) {
            Ok(finding) => findings.push(finding),
            Err(err) => {
                // Skip non-JSON log lines if present.
                if line.starts_with('{') {
                    return Err(format!(
                        "failed to parse trufflehog JSON on line {}: {err}",
                        idx + 1
                    ));
                }
            }
        }
    }
    Ok(findings)
}

fn build_validation_item(
    root: &Path,
    sample_limit: usize,
    findings: Vec<TrufflehogFinding>,
) -> ValidationItem {
    let rule_name = "Secret Scan (TruffleHog)".to_string();
    if findings.is_empty() {
        return ValidationItem {
            rule_id: "trufflehog".into(),
            rule_name,
            status: "pass".into(),
            message: "No secrets detected by TruffleHog".into(),
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
    let verified = findings.iter().filter(|f| f.verified).count();

    ValidationItem {
        rule_id: "trufflehog".into(),
        rule_name,
        status: "fail".into(),
        message: format!(
            "{total} potential secret(s) detected by TruffleHog ({verified} verified; showing up to {sample_limit})"
        ),
        affected: sample,
        cycle_groups: None,
    }
}

fn format_affected(root: &Path, finding: &TrufflehogFinding) -> String {
    let (file, line) = filesystem_location(finding);
    let path = relativize_path(root, &file);
    let line = line.max(1);
    let detector = if finding.detector_name.trim().is_empty() {
        "secret".to_string()
    } else {
        finding.detector_name.trim().to_string()
    };
    let verified = if finding.verified { "verified" } else { "unverified" };
    let detail = if finding.detector_description.trim().is_empty() {
        format!("{detector} ({verified})")
    } else {
        format!(
            "{detector} ({verified}) — {}",
            finding.detector_description.trim()
        )
    };
    format!("{path}:{line} — {detail}")
}

fn filesystem_location(finding: &TrufflehogFinding) -> (String, u32) {
    finding
        .source_metadata
        .as_ref()
        .and_then(|m| m.data.as_ref())
        .and_then(|d| d.filesystem.as_ref())
        .map(|fs| (fs.file.clone(), fs.line))
        .unwrap_or_else(|| ("unknown".into(), 1))
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
    fn parses_trufflehog_ndjson_findings() {
        let ndjson = r#"{"DetectorName":"AWS","DetectorDescription":"Amazon Web Services","Verified":true,"SourceMetadata":{"Data":{"Filesystem":{"file":"src/config.ts","line":12}}}}
{"DetectorName":"Github","Verified":false,"SourceMetadata":{"Data":{"Filesystem":{"file":"/repo/services/auth.py","line":44}}}}"#;
        let findings = parse_trufflehog_ndjson(ndjson).expect("parse");
        assert_eq!(findings.len(), 2);
        assert_eq!(findings[0].detector_name, "AWS");
        assert!(findings[0].verified);
        assert_eq!(findings[1].detector_name, "Github");
    }

    #[test]
    fn formats_affected_entries_with_line_and_detector() {
        let root = Path::new("/repo");
        let finding = TrufflehogFinding {
            detector_name: "Github".into(),
            detector_description: "GitHub token".into(),
            verified: false,
            source_metadata: Some(SourceMetadata {
                data: Some(SourceMetadataData {
                    filesystem: Some(FilesystemMeta {
                        file: "/repo/services/auth.py".into(),
                        line: 44,
                    }),
                }),
            }),
        };
        assert_eq!(
            format_affected(root, &finding),
            "services/auth.py:44 — Github (unverified) — GitHub token"
        );
    }

    #[test]
    fn trufflehog_status_serializes_installed_or_missing() {
        let status = trufflehog_status();
        assert!(status.status == "installed" || status.status == "missing");
        assert!(!status.install_hint.is_empty());
    }
}
