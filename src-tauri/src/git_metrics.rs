//! Lightweight git history metrics (code churn) for module details.

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

fn normalize_rel(path: &str) -> String {
    path.trim()
        .trim_start_matches("./")
        .replace('\\', "/")
}

fn is_git_repo(root: &Path) -> bool {
    root.join(".git").exists()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_rel_strips_dot_slash() {
        assert_eq!(normalize_rel("./src/a.ts"), "src/a.ts");
        assert_eq!(normalize_rel("src\\a.ts"), "src/a.ts");
    }
}
