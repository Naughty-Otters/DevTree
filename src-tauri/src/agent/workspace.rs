use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone)]
pub struct WorkspaceToolError(pub String);

impl std::fmt::Display for WorkspaceToolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for WorkspaceToolError {}

#[derive(Clone)]
pub struct ProjectWorkspace {
    pub root: PathBuf,
}

/// Optional 1-based inclusive line range from editor-style paths (`file.py:60-68`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LineRange {
    pub start: u32,
    pub end: u32,
}

impl ProjectWorkspace {
    pub fn new(root: PathBuf) -> Result<Self, WorkspaceToolError> {
        if !root.is_dir() {
            return Err(WorkspaceToolError(format!(
                "Project path is not a directory: {}",
                root.display()
            )));
        }
        Ok(Self { root })
    }

    pub fn resolve_relative(&self, relative: &str) -> Result<PathBuf, WorkspaceToolError> {
        let (clean, _) = split_path_and_location(relative);
        self.resolve_clean_relative(&clean)
    }

    /// Resolve a project-relative path, accepting optional `:line`, `:line:col`, or `:start-end`.
    pub fn resolve_relative_with_location(
        &self,
        relative: &str,
    ) -> Result<(PathBuf, Option<LineRange>), WorkspaceToolError> {
        let (clean, range) = split_path_and_location(relative);
        Ok((self.resolve_clean_relative(&clean)?, range))
    }

    fn resolve_clean_relative(&self, trimmed: &str) -> Result<PathBuf, WorkspaceToolError> {
        if trimmed.is_empty() {
            return Err(WorkspaceToolError("Path must not be empty".into()));
        }

        let rel = Path::new(trimmed.trim_start_matches('/'));
        if rel.is_absolute() {
            return Err(WorkspaceToolError("Absolute paths are not allowed".into()));
        }

        for component in rel.components() {
            if matches!(component, Component::ParentDir) {
                return Err(WorkspaceToolError(
                    "Parent directory traversal is not allowed".into(),
                ));
            }
        }

        let joined = self.root.join(rel);
        if !is_within_root(&self.root, &joined) {
            return Err(WorkspaceToolError("Path escapes project root".into()));
        }
        Ok(joined)
    }
}

/// Strip editor-style location suffixes commonly pasted by models.
///
/// Supports:
/// - `path:12`
/// - `path:12:3` (line:column — column ignored)
/// - `path:12-20` (inclusive line range)
pub fn split_path_and_location(input: &str) -> (String, Option<LineRange>) {
    let trimmed = strip_path_annotations(input.trim());
    if trimmed.is_empty() {
        return (String::new(), None);
    }

    // path:line:col
    if let Some((left, col)) = trimmed.rsplit_once(':') {
        if !col.is_empty() && col.chars().all(|c| c.is_ascii_digit()) {
            if let Some((path, line)) = left.rsplit_once(':') {
                if let Some(range) = parse_line_range(line) {
                    if !is_windows_drive_prefix(path) {
                        return (strip_path_annotations(path), Some(range));
                    }
                }
            }
        }
    }

    // path:line or path:start-end
    if let Some((path, rest)) = trimmed.rsplit_once(':') {
        if let Some(range) = parse_line_range(rest) {
            if !is_windows_drive_prefix(path) {
                return (strip_path_annotations(path), Some(range));
            }
        }
    }

    (trimmed.to_string(), None)
}

/// Strip model-added context suffixes such as "(parent repo)" from paths.
fn strip_path_annotations(path: &str) -> String {
    let mut cleaned = path.trim().to_string();
    loop {
        let Some(open) = cleaned.rfind(" (") else {
            break;
        };
        if !cleaned.ends_with(')') {
            break;
        }
        let inner = &cleaned[open + 2..cleaned.len() - 1];
        if inner.contains('/') || inner.contains(':') {
            break;
        }
        cleaned = cleaned[..open].trim_end().to_string();
    }
    cleaned
}

fn is_windows_drive_prefix(path: &str) -> bool {
    path.len() == 1 && path.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
}

fn parse_line_range(s: &str) -> Option<LineRange> {
    if s.is_empty() {
        return None;
    }
    if let Some((a, b)) = s.split_once('-') {
        if a.is_empty()
            || b.is_empty()
            || !a.chars().all(|c| c.is_ascii_digit())
            || !b.chars().all(|c| c.is_ascii_digit())
        {
            return None;
        }
        let start: u32 = a.parse().ok()?;
        let end: u32 = b.parse().ok()?;
        if start == 0 || end == 0 {
            return None;
        }
        let (start, end) = if start <= end {
            (start, end)
        } else {
            (end, start)
        };
        return Some(LineRange { start, end });
    }
    if !s.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let start: u32 = s.parse().ok()?;
    if start == 0 {
        return None;
    }
    Some(LineRange {
        start,
        end: start,
    })
}

/// Return 1-based inclusive line slice; if range is out of bounds, clamp.
pub fn slice_line_range(content: &str, range: LineRange) -> String {
    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() {
        return String::new();
    }
    let start = (range.start as usize)
        .saturating_sub(1)
        .min(lines.len().saturating_sub(1));
    let end = (range.end as usize).min(lines.len()).max(start + 1);
    lines[start..end].join("\n")
}

fn is_within_root(root: &Path, candidate: &Path) -> bool {
    if let (Ok(root), Ok(candidate)) = (root.canonicalize(), candidate.canonicalize()) {
        return candidate.starts_with(root);
    }
    candidate.starts_with(root)
}

pub fn should_skip_dir(name: &str) -> bool {
    matches!(
        name,
        ".git" | "node_modules" | "target" | "dist" | "build" | ".next" | "__pycache__"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_common_vendor_dirs() {
        assert!(should_skip_dir("node_modules"));
        assert!(!should_skip_dir("src"));
    }

    #[test]
    fn strips_line_and_range_suffixes() {
        assert_eq!(
            split_path_and_location("tests/test_gbm_engine.py:60-68"),
            (
                "tests/test_gbm_engine.py".into(),
                Some(LineRange {
                    start: 60,
                    end: 68
                })
            )
        );
        assert_eq!(
            split_path_and_location("src/main.rs:10"),
            ("src/main.rs".into(), Some(LineRange { start: 10, end: 10 }))
        );
        assert_eq!(
            split_path_and_location("src/main.rs:10:4"),
            ("src/main.rs".into(), Some(LineRange { start: 10, end: 10 }))
        );
        assert_eq!(
            split_path_and_location("src/main.rs"),
            ("src/main.rs".into(), None)
        );
        assert_eq!(
            split_path_and_location("tests/test_admin_console.py (parent repo)"),
            ("tests/test_admin_console.py".into(), None)
        );
    }

    #[test]
    fn slice_line_range_is_inclusive() {
        let content = "a\nb\nc\nd\ne\n";
        assert_eq!(
            slice_line_range(content, LineRange { start: 2, end: 4 }),
            "b\nc\nd"
        );
    }
}
