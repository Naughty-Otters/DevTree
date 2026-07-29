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
        let trimmed = relative.trim();
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
