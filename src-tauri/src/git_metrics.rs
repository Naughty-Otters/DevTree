//! Lightweight git history metrics (code churn + corrective commit probability).

use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChurn {
    pub path: String,
    pub lines_added: u64,
    pub lines_deleted: u64,
    pub commits: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChurnResult {
    pub available: bool,
    pub days: u32,
    pub files: Vec<FileChurn>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileCcp {
    pub path: String,
    pub commits: u64,
    pub corrective_commits: u64,
    /// 0–100 corrective commit probability.
    pub ccp: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCcpResult {
    pub available: bool,
    pub days: u32,
    /// Project-wide CCP 0–100.
    pub project_ccp: f64,
    pub files: Vec<FileCcp>,
    pub message: Option<String>,
}

fn normalize_rel(path: &str) -> String {
    path.trim()
        .trim_start_matches("./")
        .replace('\\', "/")
}

fn is_git_repo(root: &Path) -> bool {
    root.join(".git").exists()
}

/// Heuristic: commit subject looks like a bug-fix / corrective change.
/// Inspired by Amit & Feitelson Corrective Commit Probability keyword cues.
pub fn is_corrective_subject(subject: &str) -> bool {
    let s = subject.to_ascii_lowercase();
    const KEYWORDS: &[&str] = &[
        "fix", "bug", "defect", "hotfix", "regression", "crash", "error", "fail",
        "patch", "resolve", "correct", "workaround", "oops", "typo", "npe",
        "nullpointer", "segfault", "leak", "broken", "issue #", "fixes #", "closes #",
    ];
    KEYWORDS.iter().any(|k| s.contains(k))
}

/// Aggregate `git log --numstat` churn for files under `rel_path` (`.` = whole repo).
pub fn collect_git_churn(
    project_root: &Path,
    rel_path: &str,
    days: u32,
) -> GitChurnResult {
    let days = days.clamp(1, 3650);
    if !project_root.is_dir() {
        return GitChurnResult {
            available: false,
            days,
            files: vec![],
            message: Some("Project path not found".into()),
        };
    }
    if !is_git_repo(project_root) {
        return GitChurnResult {
            available: false,
            days,
            files: vec![],
            message: Some("Not a git repository".into()),
        };
    }

    let scope = normalize_rel(rel_path);
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(project_root)
        .arg("log")
        .arg(format!("--since={days}.days"))
        .arg("--numstat")
        .arg("--pretty=format:")
        .arg("--no-renames");
    if !scope.is_empty() && scope != "." {
        cmd.arg("--").arg(&scope);
    }

    let output = match cmd.output() {
        Ok(o) => o,
        Err(err) => {
            return GitChurnResult {
                available: false,
                days,
                files: vec![],
                message: Some(format!("git not available: {err}")),
            };
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return GitChurnResult {
            available: false,
            days,
            files: vec![],
            message: Some(if stderr.is_empty() {
                "git log failed".into()
            } else {
                stderr
            }),
        };
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut by_path: HashMap<String, FileChurn> = HashMap::new();

    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split_whitespace();
        let added_s = parts.next();
        let deleted_s = parts.next();
        let path = parts.collect::<Vec<_>>().join(" ");
        if added_s.is_none() || deleted_s.is_none() || path.is_empty() {
            continue;
        }
        // Binary files show '-' for numstat counts.
        let added = added_s.unwrap().parse::<u64>().unwrap_or(0);
        let deleted = deleted_s.unwrap().parse::<u64>().unwrap_or(0);
        let path = normalize_rel(&path);
        let entry = by_path.entry(path.clone()).or_insert(FileChurn {
            path,
            lines_added: 0,
            lines_deleted: 0,
            commits: 0,
        });
        entry.lines_added += added;
        entry.lines_deleted += deleted;
        entry.commits += 1;
    }

    let mut files: Vec<FileChurn> = by_path.into_values().collect();
    files.sort_by(|a, b| a.path.cmp(&b.path));

    GitChurnResult {
        available: true,
        days,
        files,
        message: None,
    }
}

/// Corrective Commit Probability from commit subjects + touched files.
pub fn collect_git_ccp(project_root: &Path, rel_path: &str, days: u32) -> GitCcpResult {
    let days = days.clamp(1, 3650);
    if !project_root.is_dir() {
        return GitCcpResult {
            available: false,
            days,
            project_ccp: 0.0,
            files: vec![],
            message: Some("Project path not found".into()),
        };
    }
    if !is_git_repo(project_root) {
        return GitCcpResult {
            available: false,
            days,
            project_ccp: 0.0,
            files: vec![],
            message: Some("Not a git repository".into()),
        };
    }

    let scope = normalize_rel(rel_path);
    // Null-separated subject, then name-only paths until blank line.
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(project_root)
        .arg("log")
        .arg(format!("--since={days}.days"))
        .arg("--pretty=format:%s")
        .arg("--name-only")
        .arg("--no-renames");
    if !scope.is_empty() && scope != "." {
        cmd.arg("--").arg(&scope);
    }

    let output = match cmd.output() {
        Ok(o) => o,
        Err(err) => {
            return GitCcpResult {
                available: false,
                days,
                project_ccp: 0.0,
                files: vec![],
                message: Some(format!("git not available: {err}")),
            };
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return GitCcpResult {
            available: false,
            days,
            project_ccp: 0.0,
            files: vec![],
            message: Some(if stderr.is_empty() {
                "git log failed".into()
            } else {
                stderr
            }),
        };
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut by_path: HashMap<String, (u64, u64)> = HashMap::new();
    let mut total_commits = 0u64;
    let mut total_corrective = 0u64;

    let mut current_subject: Option<String> = None;
    let mut current_paths: Vec<String> = Vec::new();
    let mut expecting_subject = true;

    let flush = |subject: &str,
                 paths: &[String],
                 by_path: &mut HashMap<String, (u64, u64)>,
                 total_commits: &mut u64,
                 total_corrective: &mut u64| {
        if paths.is_empty() {
            return;
        }
        *total_commits += 1;
        let corrective = is_corrective_subject(subject);
        if corrective {
            *total_corrective += 1;
        }
        for path in paths {
            let entry = by_path.entry(path.clone()).or_insert((0, 0));
            entry.0 += 1;
            if corrective {
                entry.1 += 1;
            }
        }
    };

    for line in stdout.lines() {
        let line = line.trim_end();
        if line.is_empty() {
            if let Some(subj) = current_subject.take() {
                flush(
                    &subj,
                    &current_paths,
                    &mut by_path,
                    &mut total_commits,
                    &mut total_corrective,
                );
                current_paths.clear();
            }
            expecting_subject = true;
            continue;
        }
        if expecting_subject {
            current_subject = Some(line.to_string());
            expecting_subject = false;
        } else {
            current_paths.push(normalize_rel(line));
        }
    }
    if let Some(subj) = current_subject.take() {
        flush(
            &subj,
            &current_paths,
            &mut by_path,
            &mut total_commits,
            &mut total_corrective,
        );
    }

    let project_ccp = if total_commits == 0 {
        0.0
    } else {
        (total_corrective as f64 / total_commits as f64) * 100.0
    };

    let mut files: Vec<FileCcp> = by_path
        .into_iter()
        .map(|(path, (commits, corrective))| FileCcp {
            path,
            commits,
            corrective_commits: corrective,
            ccp: if commits == 0 {
                0.0
            } else {
                (corrective as f64 / commits as f64) * 100.0
            },
        })
        .collect();
    files.sort_by(|a, b| a.path.cmp(&b.path));

    GitCcpResult {
        available: true,
        days,
        project_ccp,
        files,
        message: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_rel_strips_dot_slash() {
        assert_eq!(normalize_rel("./src/a.ts"), "src/a.ts");
        assert_eq!(normalize_rel("src\\a.ts"), "src/a.ts");
    }

    #[test]
    fn corrective_subject_detects_fix_keywords() {
        assert!(is_corrective_subject("fix: null pointer in parser"));
        assert!(is_corrective_subject("Hotfix login crash"));
        assert!(!is_corrective_subject("feat: add metrics panel"));
        assert!(!is_corrective_subject("docs: update README"));
    }
}
